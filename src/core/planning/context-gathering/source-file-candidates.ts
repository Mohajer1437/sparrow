import { FailureContract } from '../../../domain/failure-contract';
import { ProductQaContext } from '../../../domain/planner-context';
import { ProjectProfile } from '../../../domain/project-profile';
import { SkillResolution } from '../../../contracts/skill-resolver';
import { extractDirectoryMentions, extractPathMentions } from './path-mentions';
import { extractTaskSignals, pathMatchesSignal } from './task-signals';
import { WorkspaceContextReader } from './workspace-context-reader';

export type SourceCandidateOrigin =
  | 'TASK'
  | 'PRODUCT_QA'
  | 'FAILURE_PRIMARY'
  | 'FAILURE_SECONDARY'
  | 'AI_CONTEXT'
  | 'CONVENTION'
  | 'RELATED_TEST'
  | 'REPAIR_EXPANSION';

export interface SourceFileCandidate {
  readonly relativePath: string;
  readonly priority: number;
  readonly reason: string;
  readonly origin: SourceCandidateOrigin;
  readonly directoryListing?: boolean;
}

const ORIGIN_PRIORITY: Record<SourceCandidateOrigin, number> = {
  TASK: 1,
  PRODUCT_QA: 2,
  FAILURE_PRIMARY: 3,
  FAILURE_SECONDARY: 4,
  AI_CONTEXT: 5,
  CONVENTION: 6,
  RELATED_TEST: 7,
  REPAIR_EXPANSION: 3,
};

const SOURCE_FILE_EXTENSIONS = /\.(tsx|ts|jsx|js|mjs|cjs|md|json|css)$/i;
const MAX_DIR_FILES = 8;

export function discoverSourceFileCandidates(input: {
  readonly reader: WorkspaceContextReader;
  readonly userTask: string;
  readonly productQa?: ProductQaContext;
  readonly failureContract?: FailureContract;
  readonly projectProfile: ProjectProfile;
  readonly resolvedSkills: SkillResolution;
  readonly selectedAiContents: ReadonlyArray<{ relativePath: string; content: string }>;
  readonly extraCandidates?: ReadonlyArray<string>;
}): SourceFileCandidate[] {
  const ranked = new Map<string, SourceFileCandidate>();

  const add = (relativePath: string, origin: SourceCandidateOrigin, reason: string) => {
    const posix = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!posix) return;
    const existing = ranked.get(posix);
    const candidate: SourceFileCandidate = {
      relativePath: posix,
      priority: ORIGIN_PRIORITY[origin],
      reason,
      origin,
    };
    if (existing && candidate.priority >= existing.priority) {
      return;
    }
    ranked.set(posix, candidate);
  };

  for (const mentioned of extractPathMentions(input.userTask)) {
    add(mentioned, 'TASK', 'explicitly referenced by task');
  }

  const qaText = productQaText(input.productQa);
  if (qaText) {
    for (const mentioned of extractPathMentions(qaText)) {
      add(mentioned, 'PRODUCT_QA', 'explicitly referenced by Product QA');
    }
  }

  if (input.failureContract) {
    addFailureTargets(input.failureContract, add);
  }

  for (const extra of input.extraCandidates ?? []) {
    add(extra, 'REPAIR_EXPANSION', 'deterministic repair context expansion');
  }

  for (const ai of input.selectedAiContents) {
    for (const mentioned of extractPathMentions(ai.content)) {
      if (mentioned.startsWith('.ai/')) continue;
      add(mentioned, 'AI_CONTEXT', `referenced by selected .ai document ${ai.relativePath}`);
    }
  }

  addConventionalCandidates(input, add);

  expandDirectories(input.reader, ranked, add);
  addRelatedTests(input.reader, ranked, add);

  return [...ranked.values()].sort(
    (a, b) => a.priority - b.priority || a.relativePath.localeCompare(b.relativePath),
  );
}

function addFailureTargets(
  contract: FailureContract,
  add: (relativePath: string, origin: SourceCandidateOrigin, reason: string) => void,
): void {
  const incidentalIds = new Set((contract.incidentalFailures ?? []).map(item => item.check.id));
  const primaryId = contract.primaryFailure?.check.id;

  const primaryTexts: string[] = [];
  if (contract.location?.file) {
    add(contract.location.file, 'FAILURE_PRIMARY', 'referenced by primary failure location');
  }
  for (const file of contract.implicatedFiles ?? []) {
    add(file, 'FAILURE_PRIMARY', 'implicated by primary failure contract');
  }
  if (contract.primaryFailure) {
    primaryTexts.push(
      contract.primaryFailure.expectedBehavior,
      contract.primaryFailure.actualBehavior,
      contract.primaryFailure.requiredOutcome,
    );
  }
  if (contract.repairInstructions) primaryTexts.push(contract.repairInstructions);
  if (contract.summary) primaryTexts.push(contract.summary);
  for (const mentioned of extractPathMentions(primaryTexts.join('\n'))) {
    add(mentioned, 'FAILURE_PRIMARY', 'referenced by primary failure contract');
  }

  for (const check of contract.failedChecks) {
    if (check.id === primaryId || incidentalIds.has(check.id)) continue;
    const text = [check.evidence, check.name, check.acceptanceCriterion].filter(Boolean).join('\n');
    for (const mentioned of extractPathMentions(text)) {
      add(mentioned, 'FAILURE_SECONDARY', `referenced by relevant secondary failure ${check.id}`);
    }
  }
}

function addConventionalCandidates(
  input: {
    readonly reader: WorkspaceContextReader;
    readonly userTask: string;
    readonly productQa?: ProductQaContext;
    readonly projectProfile: ProjectProfile;
    readonly resolvedSkills: SkillResolution;
  },
  add: (relativePath: string, origin: SourceCandidateOrigin, reason: string) => void,
): void {
  const qaText = productQaText(input.productQa);
  const signals = extractTaskSignals(input.userTask, qaText);
  const domains = new Set(input.resolvedSkills.skills.map(skill => skill.domain));
  for (const domain of input.projectProfile.detectedDomains) {
    domains.add(domain);
  }
  const frameworks = input.projectProfile.detectedFrameworks.map(value => value.toLowerCase());
  const isNext = frameworks.includes('nextjs') || frameworks.includes('next');
  const isNest = frameworks.includes('nestjs') || frameworks.includes('nest');

  const maybe = (relativePath: string, requiredSignals: string[], reason: string) => {
    if (requiredSignals.length > 0 && !pathMatchesSignal(relativePath, signals) && !requiredSignals.some(signal => signals.includes(signal as never))) {
      if (!requiredSignals.some(signal => signals.some(found => found === signal || found.includes(signal)))) {
        return;
      }
    }
    try {
      if (input.reader.exists(relativePath)) {
        add(relativePath, 'CONVENTION', reason);
      }
    } catch {
      // invalid path — ignore conventional candidate
    }
  };

  if (domains.has('frontend') || isNext) {
    if (signals.some(signal => ['auth', 'authentication', 'login', 'middleware'].includes(signal))) {
      maybe('middleware.ts', ['auth', 'authentication', 'login', 'middleware'], 'domain conventional location matching auth/middleware signal');
      maybe('middleware.js', ['auth', 'authentication', 'login', 'middleware'], 'domain conventional location matching auth/middleware signal');
      maybe('src/middleware.ts', ['auth', 'authentication', 'login', 'middleware'], 'domain conventional location matching auth/middleware signal');
      maybe('src/auth', ['auth', 'authentication', 'login'], 'domain conventional location matching auth signal');
      maybe('app/login', ['auth', 'authentication', 'login'], 'domain conventional location matching login signal');
      maybe('app/api/auth', ['auth', 'authentication', 'login', 'api'], 'domain conventional location matching auth signal');
    }
    if (signals.some(signal => ['loading', 'spinner', 'page', 'login'].includes(signal))) {
      maybe('app/page.tsx', ['page', 'loading', 'login'], 'domain conventional Next.js page matching task signal');
      maybe('app/layout.tsx', ['page'], 'domain conventional Next.js layout matching task signal');
    }
  }

  if (domains.has('backend') || isNest) {
    if (signals.some(signal => ['auth', 'authentication', 'api', 'database'].includes(signal))) {
      maybe('src/auth', ['auth', 'authentication'], 'domain conventional backend auth location');
      maybe('src/modules/auth', ['auth', 'authentication'], 'domain conventional backend auth module');
    }
  }

  for (const mentionedDir of extractDirectoryMentions(input.userTask)) {
    try {
      if (input.reader.exists(mentionedDir)) {
        add(mentionedDir, 'TASK', `directory mentioned by task: ${mentionedDir}`);
      }
    } catch {
      // ignore invalid directory mentions
    }
  }
  if (qaText) {
    for (const mentionedDir of extractDirectoryMentions(qaText)) {
      try {
        if (input.reader.exists(mentionedDir)) {
          add(mentionedDir, 'PRODUCT_QA', `directory mentioned by Product QA: ${mentionedDir}`);
        }
      } catch {
        // ignore invalid directory mentions
      }
    }
  }
}

function expandDirectories(
  reader: WorkspaceContextReader,
  ranked: Map<string, SourceFileCandidate>,
  add: (relativePath: string, origin: SourceCandidateOrigin, reason: string) => void,
): void {
  const directories = [...ranked.values()].filter(candidate => {
    try {
      const stat = reader.stat(candidate.relativePath);
      return stat.exists && stat.isDirectory;
    } catch {
      return false;
    }
  });

  for (const directory of directories) {
    let listed: string[] = [];
    try {
      listed = reader.listFiles(directory.relativePath);
    } catch {
      continue;
    }
    const files = listed
      .filter(file => SOURCE_FILE_EXTENSIONS.test(file))
      .slice(0, MAX_DIR_FILES);
    for (const file of files) {
      if (ranked.has(file) && ranked.get(file)!.origin !== 'CONVENTION') {
        continue;
      }
      add(file, directory.origin, `${directory.reason} (directory listing)`);
    }
  }
}

function addRelatedTests(
  reader: WorkspaceContextReader,
  ranked: Map<string, SourceFileCandidate>,
  add: (relativePath: string, origin: SourceCandidateOrigin, reason: string) => void,
): void {
  const collected = [...ranked.values()].filter(candidate => candidate.origin !== 'RELATED_TEST');
  for (const candidate of collected) {
    if (!SOURCE_FILE_EXTENSIONS.test(candidate.relativePath)) continue;
    const withoutExt = candidate.relativePath.replace(/\.[^.]+$/, '');
    const dir = withoutExt.includes('/') ? withoutExt.slice(0, withoutExt.lastIndexOf('/')) : '';
    const base = withoutExt.split('/').pop() ?? withoutExt;
    const guesses = [
      `${withoutExt}.test.ts`,
      `${withoutExt}.spec.ts`,
      `${withoutExt}.test.tsx`,
      dir ? `${dir}/${base}.test.ts` : `${base}.test.ts`,
    ];
    for (const guess of guesses) {
      try {
        const stat = reader.stat(guess);
        if (stat.exists && !stat.isDirectory) {
          add(guess, 'RELATED_TEST', `related test for ${candidate.relativePath}`);
        }
      } catch {
        continue;
      }
    }
  }
}

function productQaText(productQa?: ProductQaContext): string | undefined {
  if (!productQa) return undefined;
  return [
    productQa.objective,
    ...productQa.acceptanceCriteria,
    ...productQa.verificationRequirements,
  ].join('\n');
}
