import { AiContextDiscovery } from '../../../domain/ai-context';
import { SkillResolution } from '../../../contracts/skill-resolver';
import { SkillDomain } from '../../../domain/skill';
import { extractTaskSignals, pathMatchesSignal, TaskSignal } from './task-signals';

export interface AiFileSelection {
  readonly relativePath: string;
  readonly reason: string;
  readonly priority: number;
}

export function selectRelevantAiFiles(input: {
  readonly aiContext: AiContextDiscovery;
  readonly resolvedSkills: SkillResolution;
  readonly userTask: string;
  readonly productQaText?: string;
  readonly requestedDomains?: ReadonlyArray<SkillDomain>;
}): AiFileSelection[] {
  const domains = resolveDomains(input.resolvedSkills, input.requestedDomains);
  const skillIds = input.resolvedSkills.skills.map(skill => skill.id);
  const signals = extractTaskSignals(input.userTask, input.productQaText);
  const candidates = collectAiCandidates(input.aiContext);
  const selected: AiFileSelection[] = [];

  for (const candidate of candidates) {
    const decision = scoreAiFile(candidate.relativePath, domains, skillIds, signals);
    if (decision) {
      selected.push(decision);
    }
  }

  selected.sort((a, b) => a.priority - b.priority || a.relativePath.localeCompare(b.relativePath));
  return selected;
}

function collectAiCandidates(aiContext: AiContextDiscovery): Array<{ relativePath: string }> {
  const paths = new Map<string, { relativePath: string }>();
  for (const file of aiContext.files) {
    if (file.exists && !file.isDirectory) {
      paths.set(normalizeAiPath(file.relativePath), { relativePath: normalizeAiPath(file.relativePath) });
    }
  }
  for (const file of aiContext.discoveredFiles ?? []) {
    if (file.exists && !file.isDirectory) {
      paths.set(normalizeAiPath(file.relativePath), { relativePath: normalizeAiPath(file.relativePath) });
    }
  }
  return [...paths.values()];
}

function scoreAiFile(
  relativePath: string,
  domains: ReadonlyArray<SkillDomain | 'fullstack'>,
  skillIds: ReadonlyArray<string>,
  signals: ReadonlyArray<TaskSignal>,
): AiFileSelection | undefined {
  const posix = normalizeAiPath(relativePath);
  const lower = posix.toLowerCase();
  const reasons: string[] = [];
  let priority = 5;

  if (isUnrelatedNoise(lower, domains, signals)) {
    return undefined;
  }

  const pathDomain = inferPathDomain(lower);
  if (pathDomain === 'backend' && !domains.includes('backend') && !domains.includes('fullstack')) {
    return undefined;
  }
  if (pathDomain === 'frontend' && !domains.includes('frontend') && !domains.includes('fullstack')) {
    return undefined;
  }

  if (pathDomain && (domains.includes(pathDomain) || domains.includes('fullstack'))) {
    reasons.push(`domain=${pathDomain}`);
    priority = Math.min(priority, 2);
  }

  for (const skillId of skillIds) {
    const skillDomain = skillId.split('.')[0];
    if (skillDomain && (lower.includes(`/${skillDomain}/`) || lower.includes(`/${skillDomain}.`) || lower.endsWith(`/${skillDomain}`) || lower.includes(`.ai/${skillDomain}`))) {
      reasons.push(`skill=${skillId}`);
      priority = Math.min(priority, 2);
    }
    if (skillId.endsWith('.core') && (lower.includes('/project/') || /(?:^|\/)project(?:\.|$)/.test(lower) || lower.includes('architecture'))) {
      reasons.push(`skill=${skillId}`);
      priority = Math.min(priority, 3);
    }
  }

  const matchedSignals = signals.filter(signal => pathMatchesSignal(lower, [signal]));
  if (matchedSignals.length > 0) {
    const signal = matchedSignals[0];
    reasons.push(`task signal=${signal}`);
    const base = posix.split('/').pop() ?? posix;
    if (base.toLowerCase().includes(signal) || lower.includes(`/${signal}`)) {
      reasons.push(`filename signal=${signal.replace('authentication', 'auth')}`);
    }
    priority = Math.min(priority, 1);
  }

  if (lower.includes('architecture') || lower.includes('conventions') || /(?:^|\/)project(?:\.|\/|$)/.test(lower)) {
    reasons.push('project architecture/conventions');
    priority = Math.min(priority, 3);
  }

  if (reasons.length === 0) {
    return undefined;
  }

  return {
    relativePath: posix,
    reason: `selected because: ${reasons.join('; ')}`,
    priority,
  };
}

function inferPathDomain(lower: string): SkillDomain | undefined {
  if (lower.includes('/backend/') || /(?:^|\/)backend(?:\.|$)/.test(lower) || lower.includes('.ai/backend')) {
    return 'backend';
  }
  if (lower.includes('/frontend/') || /(?:^|\/)frontend(?:\.|$)/.test(lower) || lower.includes('.ai/frontend')) {
    return 'frontend';
  }
  return undefined;
}

function isUnrelatedNoise(
  lower: string,
  domains: ReadonlyArray<SkillDomain | 'fullstack'>,
  signals: ReadonlyArray<TaskSignal>,
): boolean {
  if (lower.includes('/history/') || lower.includes('random-note')) {
    return !pathMatchesSignal(lower, signals);
  }
  if (lower.includes('unrelated')) {
    return true;
  }
  if (lower.includes('unrelated-ui') && !domains.includes('frontend')) {
    return true;
  }
  return false;
}

function resolveDomains(
  resolvedSkills: SkillResolution,
  requested?: ReadonlyArray<SkillDomain>,
): Array<SkillDomain | 'fullstack'> {
  const domains = new Set<SkillDomain | 'fullstack'>();
  for (const skill of resolvedSkills.skills) {
    domains.add(skill.domain);
  }
  for (const domain of requested ?? []) {
    domains.add(domain);
  }
  if (domains.has('frontend') && domains.has('backend')) {
    domains.add('fullstack');
  }
  return [...domains];
}

function normalizeAiPath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
}
