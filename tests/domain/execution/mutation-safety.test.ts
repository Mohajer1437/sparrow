import {
  DEFAULT_SUSPICION_THRESHOLDS,
  MutationUnitResult,
  assessDiffSuspicion,
  buildMutationLedger,
  decideMutation,
  expectedChangeSatisfied,
  extractExpectedChangeMarkers,
  isPathInScope,
  summarizeDiff,
} from '../../../src/domain/execution/mutation-safety';

const noSuspicion = { suspicious: false, reasons: [] as string[], markerScoped: false, destructive: false };

const baseDecision = {
  outOfScope: false,
  pathTraversal: false,
  creationNotPermitted: false,
  readOnly: false,
  writeFailed: false,
  readBackFailed: false,
  contentDestroyed: false,
  syntaxValid: null as boolean | null,
  expectedChangePresent: null as boolean | null,
  suspicion: noSuspicion,
};

describe('R2 diff summary (R2.11)', () => {
  it('counts a single inserted line', () => {
    const diff = summarizeDiff('a\nb\nc', 'a\nb\nNEW\nc');
    expect(diff.linesAdded).toBe(1);
    expect(diff.linesRemoved).toBe(0);
    expect(diff.linesBefore).toBe(3);
    expect(diff.linesAfter).toBe(4);
  });

  it('counts a deletion', () => {
    const diff = summarizeDiff('a\nb\nc', 'a\nc');
    expect(diff.linesRemoved).toBe(1);
    expect(diff.linesAdded).toBe(0);
  });

  it('counts a replacement as both added and removed', () => {
    const diff = summarizeDiff('a\nb\nc', 'a\nB\nc');
    expect(diff.linesAdded).toBe(1);
    expect(diff.linesRemoved).toBe(1);
  });

  it('reports no change for an identical write', () => {
    const diff = summarizeDiff('a\nb', 'a\nb');
    expect(diff.linesAdded).toBe(0);
    expect(diff.linesRemoved).toBe(0);
  });

  it('treats a created file as pure addition and a deleted file as pure removal', () => {
    expect(summarizeDiff(null, 'a\nb').linesAdded).toBe(2);
    expect(summarizeDiff(null, 'a\nb').bytesBefore).toBe(0);
    expect(summarizeDiff('a\nb', null).linesRemoved).toBe(2);
    expect(summarizeDiff('a\nb', null).bytesAfter).toBe(0);
  });

  it('records byte sizes on both sides', () => {
    const diff = summarizeDiff('abc', 'abcdef');
    expect(diff.bytesBefore).toBe(3);
    expect(diff.bytesAfter).toBe(6);
  });

  describe('Fix B: newline normalization (CRLF / LF equivalence)', () => {
    it('CRLF -> LF representation produces zero false line changes', () => {
      const crlf = 'line 1\r\nline 2\r\nline 3\r\n';
      const lf = 'line 1\nline 2\nline 3\n';
      const diff = summarizeDiff(crlf, lf);
      expect(diff.linesAdded).toBe(0);
      expect(diff.linesRemoved).toBe(0);
      expect(diff.linesBefore).toBe(4);
      expect(diff.linesAfter).toBe(4);
    });

    it('LF -> CRLF representation produces zero false line changes', () => {
      const lf = 'alpha\nbeta\ngamma\n';
      const crlf = 'alpha\r\nbeta\r\ngamma\r\n';
      const diff = summarizeDiff(lf, crlf);
      expect(diff.linesAdded).toBe(0);
      expect(diff.linesRemoved).toBe(0);
    });

    it('a CRLF file with one inserted line reports approximately one logical insertion, not full-file replacement', () => {
      const beforeCRLF = 'line 1\r\nline 2\r\nline 3\r\nline 4\r\nline 5\r\n';
      const afterLF = 'line 1\nline 2\nINSERTED\nline 3\nline 4\nline 5\n';
      const diff = summarizeDiff(beforeCRLF, afterLF);
      expect(diff.linesAdded).toBe(1);
      expect(diff.linesRemoved).toBe(0);
    });

    it('existing real multi-line changes are still detected correctly across different line endings', () => {
      const beforeCRLF = 'a\r\nb\r\nc\r\nd\r\ne\r\n';
      const afterLF = 'a\nx\ny\nz\ne\n';
      const diff = summarizeDiff(beforeCRLF, afterLF);
      expect(diff.linesRemoved).toBe(3); // b, c, d
      expect(diff.linesAdded).toBe(3); // x, y, z
    });

    it('reproduces TaskCard CRLF vs K6A LF: diff must NOT report 36 removed lines and must not be destructive', () => {
      const taskCardCRLF = [
        "import type { Task, TaskStatus } from '../types/domain';",
        "import { StatusBadge } from './StatusBadge';",
        "",
        "export interface TaskCardProps {",
        "  task: Task;",
        "}",
        "",
        "function formatDate(iso: string): string {",
        "  const d = new Date(iso);",
        "  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;",
        "}",
        "",
        "const STATUS_LABEL: Record<TaskStatus, string> = {",
        "  todo: 'To do',",
        "  in_progress: 'In progress',",
        "  done: 'Done',",
        "};",
        "",
        "export function TaskCard({ task }: TaskCardProps) {",
        "  return (",
        "    <article className=\"task-card\">",
        "      <div className=\"task-card__head\">",
        "        <h3 className=\"task-card__title\">{task.title}</h3>",
        "        <StatusBadge status={task.status} label={STATUS_LABEL[task.status]} />",
        "      </div>",
        "      <p className=\"task-card__body\">{task.description}</p>",
        "      <footer className=\"task-card__foot\">",
        "        <span>{task.projectId}</span>",
        "        <span>Updated {formatDate(task.updatedAt)}</span>",
        "      </footer>",
        "    </article>",
        "  );",
        "}",
      ].join('\r\n');

      const taskCardWithK6A_LF = taskCardCRLF
        .replace(/\r\n/g, '\n')
        .replace(
          '<article className="task-card">',
          '<article className="task-card">\n      {/* K6A */}'
        );

      const diff = summarizeDiff(taskCardCRLF, taskCardWithK6A_LF);
      expect(diff.linesRemoved).toBe(0);
      expect(diff.linesAdded).toBe(1);

      const assessment = assessDiffSuspicion({
        diff,
        operation: 'modify',
        markerScoped: true,
      });

      expect(assessment.suspicious).toBe(false);
      expect(assessment.destructive).toBe(false);
    });
  });
});

describe('R2 suspicion policy (R2.12)', () => {
  it('accepts a small change against a marker-scoped todo', () => {
    const assessment = assessDiffSuspicion({
      diff: summarizeDiff('a\nb\nc', 'a\n{/* m */}\nb\nc'),
      operation: 'modify',
      markerScoped: true,
    });
    expect(assessment.suspicious).toBe(false);
  });

  it('flags a large change against a marker-scoped todo', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const after = Array.from({ length: 40 }, (_, i) => `changed ${i}`).join('\n');
    const assessment = assessDiffSuspicion({
      diff: summarizeDiff(before, after),
      operation: 'modify',
      markerScoped: true,
    });
    expect(assessment.suspicious).toBe(true);
    expect(assessment.reasons.join(' ')).toMatch(/expected marker/);
  });

  it('does not flag a large change when the todo declared no marker, beyond the removal limit', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const after = before + '\n' + Array.from({ length: 40 }, (_, i) => `added ${i}`).join('\n');
    const assessment = assessDiffSuspicion({ diff: summarizeDiff(before, after), operation: 'modify', markerScoped: false });
    expect(assessment.suspicious).toBe(false);
  });

  it('flags a mass deletion even without a marker', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const assessment = assessDiffSuspicion({
      diff: summarizeDiff(before, 'line 0'),
      operation: 'modify',
      markerScoped: false,
    });
    expect(assessment.suspicious).toBe(true);
    expect(assessment.destructive).toBe(true);
    expect(assessment.reasons.join(' ')).toMatch(/removal limit/);
  });

  it('treats an oversized but non-destructive marker-scoped change as soft evidence only', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const after = before + '\n' + Array.from({ length: 25 }, (_, i) => `added ${i}`).join('\n');
    const assessment = assessDiffSuspicion({ diff: summarizeDiff(before, after), operation: 'modify', markerScoped: true });
    expect(assessment.suspicious).toBe(true);
    expect(assessment.destructive).toBe(false);
  });

  it('never treats a declared delete as suspicious', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const assessment = assessDiffSuspicion({ diff: summarizeDiff(before, null), operation: 'delete', markerScoped: true });
    expect(assessment.suspicious).toBe(false);
  });

  it('ignores ratio reasoning on files below the minimum line count', () => {
    expect(DEFAULT_SUSPICION_THRESHOLDS.minLinesForRatio).toBeGreaterThan(1);
    const assessment = assessDiffSuspicion({
      diff: summarizeDiff('a\nb\nc', 'a'),
      operation: 'modify',
      markerScoped: false,
    });
    expect(assessment.suspicious).toBe(false);
  });
});

describe('R2 mutation policy (R2.30)', () => {
  it('blocks READ_ONLY ahead of everything else', () => {
    const outcome = decideMutation({ ...baseDecision, readOnly: true, outOfScope: true });
    expect(outcome.decision).toBe('BLOCK');
    expect(outcome.primaryCode).toBe('READ_ONLY');
  });

  it('blocks traversal', () => {
    expect(decideMutation({ ...baseDecision, pathTraversal: true }).primaryCode).toBe('PATH_TRAVERSAL');
  });

  it('blocks an out-of-scope target', () => {
    const outcome = decideMutation({ ...baseDecision, outOfScope: true });
    expect(outcome.decision).toBe('BLOCK');
    expect(outcome.primaryCode).toBe('TARGET_OUT_OF_SCOPE');
  });

  it('blocks unpermitted file creation', () => {
    const outcome = decideMutation({ ...baseDecision, creationNotPermitted: true });
    expect(outcome.decision).toBe('BLOCK');
    expect(outcome.primaryCode).toBe('FILE_CREATION_NOT_PERMITTED');
  });

  it('rolls back on read-back failure', () => {
    const outcome = decideMutation({ ...baseDecision, readBackFailed: true });
    expect(outcome.decision).toBe('ROLLBACK');
    expect(outcome.primaryCode).toBe('READBACK_FAILED');
  });

  it('rolls back when an existing file is emptied, which parses but is destruction', () => {
    const outcome = decideMutation({ ...baseDecision, contentDestroyed: true, syntaxValid: true });
    expect(outcome.decision).toBe('ROLLBACK');
    expect(outcome.primaryCode).toBe('CONTENT_DESTROYED');
  });

  it('rolls back on invalid syntax', () => {
    const outcome = decideMutation({ ...baseDecision, syntaxValid: false });
    expect(outcome.decision).toBe('ROLLBACK');
    expect(outcome.primaryCode).toBe('SYNTAX_INVALID');
  });

  it('rolls back when a declared expected change is missing', () => {
    const outcome = decideMutation({ ...baseDecision, expectedChangePresent: false });
    expect(outcome.decision).toBe('ROLLBACK');
    expect(outcome.primaryCode).toBe('EXPECTED_CHANGE_MISSING');
  });

  it('only warns about a suspicious diff when the todo declared no marker', () => {
    const outcome = decideMutation({
      ...baseDecision,
      suspicion: { suspicious: true, reasons: ['big'], markerScoped: false, destructive: false },
    });
    expect(outcome.decision).toBe('WARN');
    expect(outcome.primaryCode).toBe('DIFF_SUSPICIOUS');
  });

  it('escalates an oversized diff to rollback when the expected marker cannot be confirmed', () => {
    const outcome = decideMutation({
      ...baseDecision,
      expectedChangePresent: null,
      suspicion: { suspicious: true, reasons: ['big'], markerScoped: true, destructive: false },
    });
    expect(outcome.decision).toBe('ROLLBACK');
  });

  // A real E2E run rolled back a correct +13/-12 edit that had valid syntax
  // and the requested marker. Direct evidence outranks the size heuristic.
  it('only warns about an oversized diff once the expected marker is confirmed present', () => {
    const outcome = decideMutation({
      ...baseDecision,
      syntaxValid: true,
      expectedChangePresent: true,
      suspicion: { suspicious: true, reasons: ['big'], markerScoped: true, destructive: false },
    });
    expect(outcome.decision).toBe('WARN');
    expect(outcome.primaryCode).toBe('DIFF_SUSPICIOUS');
  });

  it('rolls back a destructive diff inside a marker-scoped todo even when the marker is present', () => {
    const outcome = decideMutation({
      ...baseDecision,
      syntaxValid: true,
      expectedChangePresent: true,
      suspicion: { suspicious: true, reasons: ['removal limit'], markerScoped: true, destructive: true },
    });
    expect(outcome.decision).toBe('ROLLBACK');
    expect(outcome.primaryCode).toBe('DIFF_SUSPICIOUS');
  });

  it('allows a clean mutation', () => {
    expect(decideMutation({ ...baseDecision, syntaxValid: true }).decision).toBe('ALLOW');
  });

  it('is a pure function of its input', () => {
    const input = { ...baseDecision, syntaxValid: false };
    expect(decideMutation(input)).toEqual(decideMutation(input));
  });
});

describe('R2 expected change markers (R2.10, R2.21)', () => {
  it('extracts a JSX comment marker', () => {
    expect(extractExpectedChangeMarkers('Add a JSX comment {/* r2-write-e2e */} to app/page.tsx'))
      .toEqual(['r2-write-e2e']);
  });

  it('extracts a data-testid marker', () => {
    expect(extractExpectedChangeMarkers('render <div data-testid="cart-total" />')).toEqual(['cart-total']);
  });

  it('extracts nothing from prose, so vague wording cannot trigger a rollback', () => {
    expect(extractExpectedChangeMarkers('Add a helpful comment to the page component')).toEqual([]);
    expect(extractExpectedChangeMarkers('modify app/page.tsx and improve readability')).toEqual([]);
  });

  it('returns no verdict when no marker was declared', () => {
    expect(expectedChangeSatisfied('anything', [])).toBeNull();
  });

  it('requires every declared marker to be literally present', () => {
    expect(expectedChangeSatisfied('has a and b', ['a', 'b'])).toBe(true);
    expect(expectedChangeSatisfied('has a only', ['a', 'b'])).toBe(false);
  });
});

describe('R2 scope membership (R2.3, R2.24)', () => {
  it('accepts the exact declared file', () => {
    expect(isPathInScope('app/page.tsx', ['app/page.tsx'])).toBe(true);
  });

  it('rejects a sibling of the declared file', () => {
    expect(isPathInScope('app/layout.tsx', ['app/page.tsx'])).toBe(false);
  });

  it('accepts a file beneath a declared directory', () => {
    expect(isPathInScope('src/lib/util.ts', ['src/lib'])).toBe(true);
  });

  it('normalizes windows separators and leading ./', () => {
    expect(isPathInScope('app\\page.tsx', ['./app/page.tsx'])).toBe(true);
  });

  it('treats an empty scope as no declared restriction', () => {
    expect(isPathInScope('anything.ts', [])).toBe(true);
  });
});

describe('R2 mutation ledger (R2.23)', () => {
  const result = (over: Record<string, unknown>) => ({
    path: 'app/page.tsx',
    operation: 'modify' as const,
    toolName: 'write_file',
    status: 'APPLIED' as const,
    beforeState: 'PRESENT' as const,
    afterState: 'PRESENT' as const,
    beforeHash: 'a',
    afterHash: 'b',
    changed: true,
    syntaxValid: true,
    expectedChangePresent: null,
    expectedMarkers: [],
    diffSummary: summarizeDiff('a', 'b'),
    suspicious: false,
    rolledBack: false,
    rollbackVerified: null,
    decision: 'ALLOW' as const,
    findings: [],
    ...over,
  });

  it('counts one attempt per target file, not per tool call', () => {
    const units: MutationUnitResult[] = [{
      toolName: 'apply_patch',
      status: 'APPLIED',
      blockedBeforeWrite: false,
      findings: [],
      results: [result({ path: 'a.ts' }), result({ path: 'b.ts' }), result({ path: 'c.ts' })] as never,
    }];
    expect(buildMutationLedger(units).mutationAttempts).toBe(3);
    expect(buildMutationLedger(units).successfulMutations).toBe(3);
  });

  it('counts rollback, syntax, scope and suspicion outcomes separately', () => {
    const units: MutationUnitResult[] = [{
      toolName: 'write_file',
      status: 'ROLLED_BACK',
      blockedBeforeWrite: false,
      findings: [],
      results: [
        result({
          status: 'ROLLED_BACK',
          rolledBack: true,
          findings: [{ level: 'LEVEL_3_SYNTAX', code: 'SYNTAX_INVALID', detail: 'bad' }],
        }),
        result({
          status: 'BLOCKED',
          findings: [{ level: 'LEVEL_1_SCOPE', code: 'TARGET_OUT_OF_SCOPE', detail: 'nope' }],
        }),
        result({ suspicious: true }),
        result({
          status: 'FAILED',
          findings: [{ level: 'LEVEL_2_STATE', code: 'ROLLBACK_FAILED', detail: 'stuck' }],
        }),
      ] as never,
    }];
    const ledger = buildMutationLedger(units);
    expect(ledger.rolledBackMutations).toBe(1);
    expect(ledger.syntaxFailures).toBe(1);
    expect(ledger.blockedMutations).toBe(1);
    expect(ledger.outOfScopeAttempts).toBe(1);
    expect(ledger.unexpectedDiffs).toBe(1);
    expect(ledger.rollbackFailures).toBe(1);
    expect(ledger.failedMutations).toBe(1);
  });

  it('produces an empty ledger for no units', () => {
    expect(buildMutationLedger([]).mutationAttempts).toBe(0);
  });
});
