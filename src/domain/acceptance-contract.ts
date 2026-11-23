/**
 * Single structured Acceptance Contract derived from Product QA.
 * Planner, coder, local guard, and V&V all consume this object — not a second copy of intent.
 */

export interface AcceptanceObservable {
  readonly kind: 'testid' | 'exact-text';
  readonly value: string;
}

export interface PreserveSnapshot {
  readonly testIds: ReadonlyArray<string>;
  readonly exactTexts: ReadonlyArray<string>;
}

export interface AcceptanceContract {
  readonly criteria: ReadonlyArray<string>;
  readonly assumptions: ReadonlyArray<string>;
  readonly constraints: ReadonlyArray<string>;
  readonly requiredTestIds: ReadonlyArray<string>;
  readonly requiredExactTexts: ReadonlyArray<string>;
  readonly preserve: PreserveSnapshot;
}

export function emptyPreserveSnapshot(): PreserveSnapshot {
  return { testIds: [], exactTexts: [] };
}

export function formatAcceptanceContract(contract: AcceptanceContract): string {
  const lines: string[] = [
    'ACCEPTANCE CONTRACT (IMMUTABLE)',
    'Do not rewrite, drop, or treat as optional. Implementation and repair must keep every item true.',
    'CRITERIA:',
    ...(contract.criteria.length ? contract.criteria.map(item => '- ' + item) : ['- (none)']),
    'ASSUMPTIONS:',
    ...(contract.assumptions.length ? contract.assumptions.map(item => '- ' + item) : ['- (none)']),
    'CONSTRAINTS:',
    ...(contract.constraints.length ? contract.constraints.map(item => '- ' + item) : ['- (none)']),
    'REQUIRED TEST IDS: ' + (contract.requiredTestIds.join(', ') || '(none)'),
    'REQUIRED EXACT TEXTS: ' + (contract.requiredExactTexts.map(item => JSON.stringify(item)).join(', ') || '(none)'),
  ];
  if (contract.preserve.testIds.length > 0 || contract.preserve.exactTexts.length > 0) {
    lines.push('MUST PRESERVE (already satisfied — do not delete while repairing):');
    for (const id of contract.preserve.testIds) lines.push('- data-testid=' + id);
    for (const text of contract.preserve.exactTexts) lines.push('- exact text ' + JSON.stringify(text));
  }
  return lines.join('\n');
}

export function mergePreserveSnapshots(
  a: PreserveSnapshot,
  b: PreserveSnapshot,
): PreserveSnapshot {
  return {
    testIds: unique(a.testIds.concat(b.testIds)),
    exactTexts: unique(a.exactTexts.concat(b.exactTexts)),
  };
}

function unique(items: ReadonlyArray<string>): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}
