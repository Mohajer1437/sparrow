export interface MutationFailureContract {
  readonly type: 'MUTATION_FAILURE';
  readonly id: string;
  readonly failedFiles: ReadonlyArray<string>;
  readonly attempts: number;
  readonly reason: string;
  readonly failureCodes: ReadonlyArray<string>;
  readonly createdAt: string;
}

export function buildMutationFailureContract(input: {
  readonly failedFiles: ReadonlyArray<string>;
  readonly attempts: number;
  readonly reason: string;
  readonly failureCodes?: ReadonlyArray<string>;
  readonly now?: string;
}): MutationFailureContract {
  const now = input.now ?? new Date().toISOString();
  return Object.freeze({
    type: 'MUTATION_FAILURE',
    id: `mutation-failure-${now.replace(/[:.]/g, '-')}`,
    failedFiles: Object.freeze([...input.failedFiles]),
    attempts: input.attempts,
    reason: input.reason,
    failureCodes: Object.freeze([...(input.failureCodes ?? [])]),
    createdAt: now,
  });
}