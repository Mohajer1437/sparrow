import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ExecutionMode } from '../../../domain/execution-mode';
import {
  EMPTY_DIFF_SUMMARY,
  MutationDecision,
  MutationFailureCode,
  MutationFinding,
  MutationOperation,
  MutationResult,
  MutationStatus,
  MutationUnitResult,
  assessDiffSuspicion,
  decideMutation,
  expectedChangeSatisfied,
  isPathInScope,
  normalizeMutationPath,
  summarizeDiff,
} from '../../../domain/execution/mutation-safety';
import { SourceSyntaxValidator, isSyntaxCheckable } from './source-syntax-validator';

/**
 * Reliability Hardening R2 — the canonical mutation boundary (R2.2).
 *
 * Every file-mutating tool call passes through this guard, so `write_file`,
 * `create_file`, `apply_patch` and `delete_file` all obey one safety policy
 * instead of each carrying its own. The guard wraps the real tool rather than
 * replacing it: the tools keep their existing behaviour and the guard owns
 * scope, pre-write state, validation and rollback around them.
 *
 * The strongest check is the cheapest one: when the candidate content is
 * available in the tool arguments it is parsed *before* the tool runs, so a
 * malformed candidate is refused without ever touching the target file. The
 * post-write pass then re-reads from disk, which is what catches a truncated
 * or partially written result that the candidate check could not have seen.
 */

/** Everything the guard needs to know that it cannot discover from disk. */
export interface MutationGuardContext {
  readonly workspaceRoot: string;
  readonly executionMode: ExecutionMode;
  /** Files the current todo permits touching (R2.3). Empty means no declared scope. */
  readonly todoScope: ReadonlyArray<string>;
  /** Contract-level scope, intersected with the todo scope when both exist. */
  readonly contractScope: ReadonlyArray<string>;
  /** Literal markers the todo declared, if any (R2.10). */
  readonly expectedMarkers: ReadonlyArray<string>;
}

export interface GuardedMutationOutcome<T> {
  readonly unit: MutationUnitResult;
  /** Present only when the tool was actually invoked. */
  readonly toolOutcome?: T;
}

interface MutationTarget {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly operation: MutationOperation;
  /** Full candidate content when the tool argument carries it. */
  readonly candidate: string | null;
  readonly traversal: boolean;
}

interface PreState {
  readonly exists: boolean;
  readonly content: string | null;
  readonly hash: string;
  readonly binary: boolean;
}

/** Files above this size are still guarded, but not held in memory for rollback. */
const MAX_ROLLBACK_BYTES = 4 * 1024 * 1024;

export class MutationGuard {
  constructor(
    private readonly syntaxValidator: SourceSyntaxValidator = new SourceSyntaxValidator(),
  ) {}

  /** True when this tool call mutates files and therefore needs guarding. */
  static describesFileMutation(toolName: string, args: Record<string, unknown>): boolean {
    return extractTargets(toolName, args, '.').length > 0;
  }

  /**
   * Runs `invoke` inside the safety boundary.
   *
   * `invoke` must resolve to `{ failed }` so the guard can tell a tool-level
   * failure from a success; the guard never inspects tool prose for meaning.
   */
  async guard<T extends { readonly failed: boolean }>(
    input: {
      readonly toolName: string;
      readonly args: Record<string, unknown>;
      readonly context: MutationGuardContext;
    },
    invoke: () => Promise<T>,
  ): Promise<GuardedMutationOutcome<T>> {
    const { toolName, args, context } = input;
    const targets = extractTargets(toolName, args, context.workspaceRoot);

    if (targets.length === 0) {
      // Not a recognizable file mutation; nothing for the guard to protect.
      const toolOutcome = await invoke();
      return {
        unit: emptyUnit(toolName, toolOutcome.failed ? 'FAILED' : 'APPLIED'),
        toolOutcome,
      };
    }

    // ---- LEVEL 1: scope, traversal and creation policy, before any write ----
    const scope = effectiveScope(context);
    const blocking: MutationResult[] = [];
    for (const target of targets) {
      const preExists = await fileExists(target.absolutePath);
      const verdict = this.evaluateScope(target, scope, context, preExists);
      if (verdict) blocking.push(verdict);
    }

    if (blocking.length > 0) {
      // R2.13/R2.14: the unit is the tool call. If one target is out of scope
      // the whole call is refused, so a valid file cannot be written as a
      // side effect of a call that also targeted a forbidden one.
      const results = blocking.length === targets.length
        ? blocking
        : [...blocking, ...targets
          .filter(t => !blocking.some(b => b.path === t.relativePath))
          .map(t => notAttempted(t, toolName, 'BLOCKED', blocking[0].findings[0]))];
      return { unit: buildUnit(toolName, 'BLOCKED', results, true) };
    }

    // ---- LEVEL 3a: parse the candidate before it reaches the file ----
    const candidateRejections: MutationResult[] = [];
    for (const target of targets) {
      if (target.candidate === null || !isSyntaxCheckable(target.relativePath)) continue;
      const syntax = this.syntaxValidator.validate(target.relativePath, target.candidate);
      if (syntax.valid === false) {
        candidateRejections.push(Object.freeze({
          ...notAttempted(target, toolName, 'REJECTED', {
            level: 'LEVEL_3_SYNTAX' as const,
            code: 'SYNTAX_INVALID' as const,
            detail: `candidate content rejected before write: ${syntax.detail}`,
          }),
          syntaxValid: false,
          syntaxDetail: syntax.detail,
          decision: 'BLOCK' as const,
        }));
      }
    }

    if (candidateRejections.length > 0) {
      const results = [...candidateRejections, ...targets
        .filter(t => !candidateRejections.some(r => r.path === t.relativePath))
        .map(t => notAttempted(t, toolName, 'REJECTED', candidateRejections[0].findings[0]))];
      return { unit: buildUnit(toolName, 'REJECTED', results, true) };
    }

    // ---- LEVEL 2: pre-write state, captured immediately before the write ----
    const preStates = new Map<string, PreState>();
    for (const target of targets) {
      preStates.set(target.relativePath, await capturePreState(target.absolutePath));
    }

    // ---- the actual mutation ----
    const toolOutcome = await invoke();

    // ---- LEVEL 2-4: read back, syntax, expected change, diff ----
    const assessments = await Promise.all(targets.map(target =>
      this.assessTarget(target, preStates.get(target.relativePath)!, context, toolOutcome.failed)));

    // R2.14: a unit is only clean when every file in it is clean.
    const needsRollback = assessments.some(a => a.decision === 'ROLLBACK');
    const results: MutationResult[] = [];
    for (const assessment of assessments) {
      if (!needsRollback) {
        results.push(assessment.toResult('APPLIED', false, null, undefined));
        continue;
      }
      const rollback = await this.rollback(assessment.target, preStates.get(assessment.target.relativePath)!);
      results.push(assessment.toResult(
        rollback.verified === false ? 'FAILED' : 'ROLLED_BACK',
        true,
        rollback.verified,
        rollback.hash,
        rollback.failure,
      ));
    }

    const status: MutationStatus = !needsRollback
      ? (toolOutcome.failed ? 'FAILED' : 'APPLIED')
      : results.some(r => r.status === 'FAILED') ? 'FAILED' : 'ROLLED_BACK';

    return { unit: buildUnit(toolName, status, results, false), toolOutcome };
  }

  /** R2.3/R2.4/R2.24: returns a blocking result, or null when the target is allowed. */
  private evaluateScope(
    target: MutationTarget,
    scope: ReadonlyArray<string>,
    context: MutationGuardContext,
    preExists: boolean,
  ): MutationResult | null {
    const readOnly = context.executionMode === 'READ_ONLY';
    const outOfScope = !target.traversal && scope.length > 0 && !isPathInScope(target.relativePath, scope);
    // R2.4: creating a file is a bigger claim than editing one, so it needs
    // the todo to have named the path. Prose is never treated as permission.
    const creationNotPermitted = !target.traversal
      && !outOfScope
      && !preExists
      && target.operation !== 'delete'
      && scope.length > 0
      && !scopeNamesFileExplicitly(target.relativePath, scope);

    const outcome = decideMutation({
      readOnly,
      pathTraversal: target.traversal,
      outOfScope,
      creationNotPermitted,
      writeFailed: false,
      readBackFailed: false,
      contentDestroyed: false,
      syntaxValid: null,
      expectedChangePresent: null,
      suspicion: { suspicious: false, reasons: [], markerScoped: false, destructive: false },
    });

    if (outcome.decision !== 'BLOCK') return null;
    return notAttempted(target, '', 'BLOCKED', {
      level: 'LEVEL_1_SCOPE',
      code: outcome.primaryCode!,
      detail: `${outcome.reason} (target: ${target.relativePath}${scope.length > 0 ? `, scope: ${scope.join(', ')}` : ''})`,
    });
  }

  private async assessTarget(
    target: MutationTarget,
    pre: PreState,
    context: MutationGuardContext,
    toolFailed: boolean,
  ) {
    const post = await capturePreState(target.absolutePath);
    const findings: MutationFinding[] = [];

    const expectDeleted = target.operation === 'delete';
    const readBackFailed = !toolFailed && (expectDeleted ? post.exists : !post.exists);

    // R2.12: a source file reduced to nothing parses cleanly and looks like a
    // large diff, so it needs its own rule or it slips through as a warning.
    //
    // R3: "reduced to nothing" also has to cover the file that was replaced by
    // a stub. A live run rewrote a five-line component as `// test`, which is
    // seven bytes rather than zero, so the emptiness check missed it, the
    // syntax check passed, and the destructive write was applied with only a
    // warning. Losing every executable line is the same destruction whether or
    // not a comment is left behind.
    const preCode = countCodeLines(pre.content);
    const postCode = countCodeLines(post.content);
    const emptied = post.exists && (post.content ?? '').trim().length === 0;
    const gutted = post.exists && preCode > 0 && postCode === 0;
    const contentDestroyed = !expectDeleted
      && pre.exists
      && (pre.content ?? '').trim().length > 0
      && (emptied || gutted);
    if (contentDestroyed) {
      findings.push({
        level: 'LEVEL_4_DIFF',
        code: 'CONTENT_DESTROYED',
        detail: emptied
          ? `write emptied ${target.relativePath}, which previously held ${pre.content?.length ?? 0} characters`
          : `write removed every code line from ${target.relativePath}`
          + ` (${preCode} code line(s) before, none after; only comments remain)`,
      });
    }

    let syntaxValid: boolean | null = null;
    let syntaxDetail: string | undefined;
    if (post.exists && post.content !== null && isSyntaxCheckable(target.relativePath)) {
      const syntax = this.syntaxValidator.validate(target.relativePath, post.content);
      syntaxValid = syntax.valid;
      syntaxDetail = syntax.detail;
      if (syntax.valid === false) {
        findings.push({ level: 'LEVEL_3_SYNTAX', code: 'SYNTAX_INVALID', detail: syntax.detail ?? 'invalid syntax' });
      }
    }

    const diff = pre.binary || post.binary
      ? EMPTY_DIFF_SUMMARY
      : summarizeDiff(pre.exists ? pre.content ?? '' : null, post.exists ? post.content ?? '' : null);
    const changed = pre.hash !== post.hash;

    // R2.10: only enforced when the todo pinned the change to one named file
    // and one literal marker, which is the only unambiguous case.
    const enforceMarkers = context.expectedMarkers.length > 0
      && singleScopedFile(context) !== null
      && isPathInScope(target.relativePath, [singleScopedFile(context)!]);
    const expectedChangePresent = enforceMarkers && post.content !== null
      ? expectedChangeSatisfied(post.content, context.expectedMarkers)
      : null;
    if (expectedChangePresent === false) {
      findings.push({
        level: 'LEVEL_4_DIFF',
        code: 'EXPECTED_CHANGE_MISSING',
        detail: `expected marker(s) not present after write: ${context.expectedMarkers.join(', ')}`,
      });
    }

    const suspicion = assessDiffSuspicion({
      diff,
      operation: target.operation,
      markerScoped: enforceMarkers,
    });
    if (suspicion.suspicious) {
      findings.push({ level: 'LEVEL_4_DIFF', code: 'DIFF_SUSPICIOUS', detail: suspicion.reasons.join('; ') });
    }
    if (toolFailed) {
      findings.push({ level: 'LEVEL_2_STATE', code: 'WRITE_FAILED', detail: 'mutation tool reported failure' });
    }
    if (readBackFailed) {
      findings.push({
        level: 'LEVEL_2_STATE',
        code: 'READBACK_FAILED',
        detail: expectDeleted
          ? 'delete reported success but the file is still present'
          : 'write reported success but the target file could not be read back',
      });
    }

    const outcome = decideMutation({
      readOnly: false,
      pathTraversal: false,
      outOfScope: false,
      creationNotPermitted: false,
      writeFailed: toolFailed,
      readBackFailed,
      contentDestroyed,
      syntaxValid,
      expectedChangePresent,
      suspicion,
    });

    const target_ = target;
    return {
      target: target_,
      decision: outcome.decision as MutationDecision,
      toResult: (
        status: MutationStatus,
        rolledBack: boolean,
        rollbackVerified: boolean | null,
        afterRollbackHash: string | undefined,
        rollbackFailure?: string,
      ): MutationResult => {
        const allFindings = [...findings];
        if (rollbackFailure) {
          allFindings.push({ level: 'LEVEL_2_STATE', code: 'ROLLBACK_FAILED', detail: rollbackFailure });
        }
        return Object.freeze({
          path: target_.relativePath,
          operation: target_.operation,
          toolName: '',
          status,
          beforeState: pre.exists ? 'PRESENT' : 'ABSENT',
          afterState: post.exists ? 'PRESENT' : 'ABSENT',
          beforeHash: pre.hash,
          afterHash: post.hash,
          changed,
          syntaxValid,
          syntaxDetail,
          expectedChangePresent,
          expectedMarkers: Object.freeze([...context.expectedMarkers]),
          diffSummary: diff,
          suspicious: suspicion.suspicious,
          rolledBack,
          rollbackVerified,
          afterRollbackHash,
          decision: outcome.decision,
          findings: Object.freeze(allFindings),
        });
      },
    };
  }

  /**
   * R2.15/R2.16/R2.26: restores exactly the bytes captured immediately before
   * this write, and nothing else. No git command is involved, so a file that
   * was already dirty before the run is untouched unless it was itself the
   * mutation target.
   */
  private async rollback(
    target: MutationTarget,
    pre: PreState,
  ): Promise<{ verified: boolean | null; hash?: string; failure?: string }> {
    try {
      if (!pre.exists) {
        // R2.16: a rejected new file is removed, not left behind as debris.
        await fs.rm(target.absolutePath, { force: true });
        const stillThere = await fileExists(target.absolutePath);
        return stillThere
          ? { verified: false, failure: `created file could not be removed: ${target.relativePath}` }
          : { verified: true, hash: '' };
      }

      if (pre.content === null) {
        return {
          verified: false,
          failure: `pre-write content for ${target.relativePath} was not captured (file too large or unreadable); cannot restore`,
        };
      }

      await fs.writeFile(target.absolutePath, pre.content, 'utf8');
      const restored = await capturePreState(target.absolutePath);
      if (restored.hash !== pre.hash) {
        return {
          verified: false,
          hash: restored.hash,
          failure: `rollback hash mismatch for ${target.relativePath}: expected ${pre.hash.slice(0, 12)}, got ${restored.hash.slice(0, 12)}`,
        };
      }
      return { verified: true, hash: restored.hash };
    } catch (error: any) {
      return { verified: false, failure: `rollback threw for ${target.relativePath}: ${error?.message ?? error}` };
    }
  }
}

/* ---------------------------------------------------------------- helpers */

/**
 * R2.3: the todo scope is authoritative (R2.21). When a contract scope also
 * exists the two are intersected, so a contract can narrow the todo but never
 * widen it.
 */
function effectiveScope(context: MutationGuardContext): ReadonlyArray<string> {
  const todo = context.todoScope.map(normalizeMutationPath).filter(Boolean);
  const contract = context.contractScope.map(normalizeMutationPath).filter(Boolean);
  if (todo.length === 0) return contract;
  if (contract.length === 0) return todo;
  const narrowed = todo.filter(file => isPathInScope(file, contract));
  return narrowed.length > 0 ? narrowed : todo;
}

function singleScopedFile(context: MutationGuardContext): string | null {
  const files = context.todoScope.map(normalizeMutationPath).filter(Boolean);
  return files.length === 1 ? files[0] : null;
}

/** R2.4: directory scopes authorize creation beneath them; file scopes do not. */
function scopeNamesFileExplicitly(candidate: string, scope: ReadonlyArray<string>): boolean {
  const target = normalizeMutationPath(candidate).toLowerCase();
  return scope.some(entry => {
    const allowed = normalizeMutationPath(entry).toLowerCase();
    if (!allowed) return false;
    if (target === allowed) return true;
    if (target.endsWith('/' + allowed) || allowed.endsWith('/' + target)) return true;
    return !allowed.includes('.') && target.startsWith(allowed + '/');
  });
}

function extractTargets(
  toolName: string,
  args: Record<string, unknown>,
  workspaceRoot: string,
): MutationTarget[] {
  const name = (toolName ?? '').trim().toLowerCase();
  const targets: MutationTarget[] = [];

  const push = (rawPath: unknown, operation: MutationOperation, candidate: unknown) => {
    if (typeof rawPath !== 'string' || !rawPath.trim()) return;
    const built = buildTarget(rawPath, operation, typeof candidate === 'string' ? candidate : null, workspaceRoot);
    if (built) targets.push(built);
  };

  if (name === 'write_file' || name === 'edit_file') {
    // write_file creates when missing, so the operation is resolved against
    // the filesystem later; `modify` here only labels the intent.
    push(args.path ?? args.filePath, 'modify', args.content);
  } else if (name === 'create_file') {
    push(args.path ?? args.filePath, 'create', args.content);
  } else if (name === 'delete_file') {
    push(args.path ?? args.filePath, 'delete', null);
  } else if (name === 'apply_patch') {
    const operations = Array.isArray(args.operations) ? args.operations : [];
    for (const raw of operations) {
      if (!raw || typeof raw !== 'object') continue;
      const operation = (raw as any).operation;
      const normalized: MutationOperation = operation === 'create'
        ? 'create'
        : operation === 'delete' ? 'delete' : 'modify';
      push((raw as any).path, normalized, (raw as any).newContent);
    }
  }

  return targets;
}

function buildTarget(
  rawPath: string,
  operation: MutationOperation,
  candidate: string | null,
  workspaceRoot: string,
): MutationTarget | null {
  const root = path.resolve(workspaceRoot);
  const absolute = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(root, rawPath);
  const relative = path.relative(root, absolute);
  // R2.3: anything resolving outside the workspace root is a traversal, and
  // an absolute path is only accepted when it lands back inside the root.
  const traversal = relative.startsWith('..') || path.isAbsolute(relative);
  return {
    relativePath: traversal ? normalizeMutationPath(rawPath) : normalizeMutationPath(relative),
    absolutePath: absolute,
    operation,
    candidate,
    traversal,
  };
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(absolutePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/** R2.5: path, existence, size and hash for one target — never the whole repo. */
async function capturePreState(absolutePath: string): Promise<PreState> {
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) return { exists: false, content: null, hash: '', binary: false };
    const buffer = await fs.readFile(absolutePath);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const binary = buffer.includes(0);
    const holdContent = !binary && buffer.byteLength <= MAX_ROLLBACK_BYTES;
    return {
      exists: true,
      content: holdContent ? buffer.toString('utf8') : null,
      hash,
      binary,
    };
  } catch {
    return { exists: false, content: null, hash: '', binary: false };
  }
}

function notAttempted(
  target: MutationTarget,
  toolName: string,
  status: MutationStatus,
  finding: MutationFinding,
): MutationResult {
  return Object.freeze({
    path: target.relativePath,
    operation: target.operation,
    toolName,
    status,
    beforeState: 'ABSENT' as const,
    afterState: 'ABSENT' as const,
    beforeHash: '',
    afterHash: '',
    changed: false,
    syntaxValid: null,
    expectedChangePresent: null,
    expectedMarkers: Object.freeze([]),
    diffSummary: EMPTY_DIFF_SUMMARY,
    suspicious: false,
    rolledBack: false,
    rollbackVerified: null,
    decision: (status === 'BLOCKED' ? 'BLOCK' : 'ROLLBACK') as MutationDecision,
    findings: Object.freeze([finding]),
  });
}

function buildUnit(
  toolName: string,
  status: MutationStatus,
  results: ReadonlyArray<MutationResult>,
  blockedBeforeWrite: boolean,
): MutationUnitResult {
  const stamped = results.map(result => Object.freeze({ ...result, toolName }));
  return Object.freeze({
    toolName,
    status,
    results: Object.freeze(stamped),
    findings: Object.freeze(stamped.flatMap(result => result.findings)),
    blockedBeforeWrite,
  });
}

function emptyUnit(toolName: string, status: MutationStatus): MutationUnitResult {
  return Object.freeze({
    toolName,
    status,
    results: Object.freeze([]),
    findings: Object.freeze([]),
    blockedBeforeWrite: false,
  });
}

/**
 * Lines that do something, as opposed to blank lines and comments. Used only
 * to tell a file that still contains code from one that has been reduced to a
 * placeholder, so the comment forms recognised here are deliberately the
 * common ones rather than a full lexer.
 */
function countCodeLines(content: string | null | undefined): number {
  if (!content) return 0;
  let count = 0;
  let inBlockComment = false;
  for (const raw of content.split(/\r?\n/)) {
    let line = raw.trim();
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      line = line.slice(end + 2).trim();
      inBlockComment = false;
    }
    while (line.startsWith('/*')) {
      const end = line.indexOf('*/', 2);
      if (end === -1) {
        inBlockComment = true;
        line = '';
        break;
      }
      line = line.slice(end + 2).trim();
    }
    if (!line || line.startsWith('//') || line.startsWith('*')) continue;
    count += 1;
  }
  return count;
}

export const __mutationGuardInternals = {
  extractTargets,
  effectiveScope,
  scopeNamesFileExplicitly,
  countCodeLines,
};

export type { MutationFailureCode };
