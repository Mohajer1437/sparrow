import { promises as fs } from 'fs';
import * as path from 'path';
import {
  AcceptanceContract,
  emptyPreserveSnapshot,
  PreserveSnapshot,
} from '../../domain/acceptance-contract';
import { ProductAnalysis } from '../../domain/product-analysis';
import { ExecutionPlan } from '../../domain/execution-plan';
import { VerificationCheck } from '../../domain/verification-check';
import { extractExactTexts, extractTestIds } from './product-intent-extract';

const TESTID_IN_SOURCE = /data-testid\s*=\s*['"]([A-Za-z0-9:_-]+)['"]/g;

export function toAcceptanceContract(
  analysis: ProductAnalysis | undefined,
  task?: string,
  preserve?: PreserveSnapshot,
): AcceptanceContract | undefined {
  if (!analysis) return undefined;
  const blobs = [
    task || '',
    analysis.objective,
    analysis.intent?.userGoal || '',
    ...(analysis.acceptanceCriteria || []),
    ...(analysis.intent?.expectedOutcomes || []),
  ].join('\n');
  return Object.freeze({
    criteria: Object.freeze((analysis.acceptanceCriteria || []).slice()),
    assumptions: Object.freeze((analysis.assumptions || []).slice()),
    constraints: Object.freeze((analysis.intent?.importantConstraints || []).slice()),
    requiredTestIds: Object.freeze(extractTestIds(blobs)),
    requiredExactTexts: Object.freeze(extractExactTexts(blobs)),
    preserve: Object.freeze(preserve || emptyPreserveSnapshot()),
  });
}

export function bindAcceptanceContract(
  plan: ExecutionPlan,
  contract: AcceptanceContract,
): ExecutionPlan {
  const mention = observableMention(contract);
  const steps = plan.steps.map(step => {
    if (step.type !== 'modify' || !mention) return step;
    const already = /REQUIRED ACCEPTANCE/i.test(step.description);
    const description = already ? step.description : (step.description + '\n' + mention);
    const criteria = unique([...(step.validationCriteria || []), ...contract.criteria]);
    return Object.freeze({
      ...step,
      description,
      validationCriteria: Object.freeze(criteria),
      expectedOutcome: step.expectedOutcome || contract.criteria[0] || step.expectedOutcome,
    });
  });
  return Object.freeze({
    ...plan,
    steps: Object.freeze(steps),
    acceptanceContract: contract,
    validationStrategy: Object.freeze({
      requiredTests: plan.validationStrategy?.requiredTests || [],
      successCriteria: contract.criteria.length
        ? contract.criteria
        : (plan.validationStrategy?.successCriteria || []),
    }),
  });
}

export function observableMention(contract: AcceptanceContract): string {
  const parts: string[] = [];
  if (contract.requiredTestIds.length) {
    parts.push('required data-testid values: ' + contract.requiredTestIds.join(', '));
  }
  if (contract.requiredExactTexts.length) {
    parts.push('required exact visible text: ' + contract.requiredExactTexts.map(item => JSON.stringify(item)).join(', '));
  }
  if (contract.preserve.testIds.length || contract.preserve.exactTexts.length) {
    parts.push(
      'must preserve already-present: '
      + [...contract.preserve.testIds.map(id => 'data-testid=' + id), ...contract.preserve.exactTexts.map(t => JSON.stringify(t))].join(', '),
    );
  }
  if (parts.length === 0) return '';
  return 'REQUIRED ACCEPTANCE (do not drop any item): ' + parts.join('; ') + '.';
}

export function findTestIdsInText(text: string): string[] {
  const found: string[] = [];
  const re = new RegExp(TESTID_IN_SOURCE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) found.push(match[1]);
  return unique(found);
}

export function snapshotFromContents(
  contents: Readonly<Record<string, string>>,
  contract?: AcceptanceContract,
): PreserveSnapshot {
  const testIds: string[] = [];
  const exactTexts: string[] = [];
  const joined = Object.values(contents).join('\n');
  testIds.push(...findTestIdsInText(joined));
  for (const text of contract?.requiredExactTexts || []) {
    if (text && joined.includes(text)) exactTexts.push(text);
  }
  return {
    testIds: unique(testIds),
    exactTexts: unique(exactTexts),
  };
}

export function missingRequiredObservables(
  contents: Readonly<Record<string, string>>,
  contract: AcceptanceContract,
): PreserveSnapshot {
  const joined = Object.values(contents).join('\n');
  const presentIds = new Set(findTestIdsInText(joined));
  return {
    testIds: contract.requiredTestIds.filter(id => !presentIds.has(id)),
    exactTexts: contract.requiredExactTexts.filter(text => text && !joined.includes(text)),
  };
}

export function removedPreservedObservables(
  contents: Readonly<Record<string, string>>,
  preserve: PreserveSnapshot,
  allowedToChange?: PreserveSnapshot,
): PreserveSnapshot {
  const joined = Object.values(contents).join('\n');
  const presentIds = new Set(findTestIdsInText(joined));
  const allowIds = new Set(allowedToChange?.testIds || []);
  const allowTexts = new Set(allowedToChange?.exactTexts || []);
  return {
    testIds: preserve.testIds.filter(id => !presentIds.has(id) && !allowIds.has(id)),
    exactTexts: preserve.exactTexts.filter(text => text && !joined.includes(text) && !allowTexts.has(text)),
  };
}

export async function readScopedFiles(
  workspacePath: string,
  files: ReadonlyArray<string>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/').replace(/^\.?\//, '');
    try {
      out[normalized] = await fs.readFile(path.join(workspacePath, normalized), 'utf8');
    } catch {
      out[normalized] = '';
    }
  }
  return out;
}

export function evaluateAcceptanceContract(input: {
  readonly contents: Readonly<Record<string, string>>;
  readonly contract: AcceptanceContract;
  readonly preserve?: PreserveSnapshot;
  readonly allowedToChange?: PreserveSnapshot;
}): ReadonlyArray<VerificationCheck> {
  const checks: VerificationCheck[] = [];
  const missing = missingRequiredObservables(input.contents, input.contract);
  for (const id of missing.testIds) {
    checks.push(checkFor(
      'acceptance-missing-testid-' + id,
      false,
      'Required data-testid="' + id + '" is missing from implementation files',
      'Element with data-testid="' + id + '" must be present',
    ));
  }
  for (const text of missing.exactTexts) {
    checks.push(checkFor(
      'acceptance-missing-text-' + slug(text),
      false,
      'Required exact text ' + JSON.stringify(text) + ' is missing from implementation files',
      'Exact visible text ' + JSON.stringify(text) + ' must be present',
    ));
  }
  const preserve = input.preserve || input.contract.preserve;
  const removed = removedPreservedObservables(input.contents, preserve, input.allowedToChange);
  for (const id of removed.testIds) {
    checks.push(checkFor(
      'acceptance-removed-testid-' + id,
      false,
      'Repair removed previously satisfied data-testid="' + id + '"',
      'Previously satisfied data-testid="' + id + '" must be preserved',
    ));
  }
  for (const text of removed.exactTexts) {
    checks.push(checkFor(
      'acceptance-removed-text-' + slug(text),
      false,
      'Repair removed previously satisfied exact text ' + JSON.stringify(text),
      'Previously satisfied exact text ' + JSON.stringify(text) + ' must be preserved',
    ));
  }
  if (checks.length === 0 && (input.contract.requiredTestIds.length > 0 || input.contract.requiredExactTexts.length > 0)) {
    checks.push(checkFor(
      'acceptance-contract-local',
      true,
      'Required test ids and exact texts are present in scoped files; source: '
        + Object.keys(input.contents).join(', '),
      'Acceptance contract observables are present',
    ));
  }
  return Object.freeze(checks.map(item => {
    if (item.passed) return item;
    const sources = Object.keys(input.contents).join(', ');
    return Object.freeze({
      ...item,
      evidence: item.evidence + (sources ? '; source: ' + sources : ''),
    });
  }));
}

export function contractHasUnsatisfiedObservables(
  contents: Readonly<Record<string, string>>,
  contract: AcceptanceContract | undefined,
): boolean {
  if (!contract) return false;
  const missing = missingRequiredObservables(contents, contract);
  return missing.testIds.length > 0 || missing.exactTexts.length > 0;
}

export function allowedChangeFromFailure(failure?: {
  readonly location?: { readonly testId?: string };
  readonly expectation?: { readonly expectedBehavior?: string };
}): PreserveSnapshot {
  const testIds = failure?.location?.testId ? [failure.location.testId] : [];
  const expected = failure?.expectation?.expectedBehavior || '';
  const exactTexts = extractExactTexts(expected);
  return { testIds, exactTexts };
}

function checkFor(id: string, passed: boolean, evidence: string, acceptanceCriterion: string): VerificationCheck {
  return Object.freeze({
    id,
    category: 'deterministic' as const,
    name: id,
    passed,
    severity: (passed ? 'LOW' : 'HIGH') as 'LOW' | 'HIGH',
    evidence,
    acceptanceCriterion,
  });
}

function slug(text: string): string {
  return text.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'text';
}

function unique(items: ReadonlyArray<string>): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}
