export {
  INCIDENTAL_RANK_MIN,
  prioritizeFailures,
  type PrioritizedFailure,
} from '../vv/failure-contract-builder';

export function primaryFailureOf(
  prioritized: ReadonlyArray<import('../vv/failure-contract-builder').PrioritizedFailure>,
): import('../vv/failure-contract-builder').PrioritizedFailure | undefined {
  return prioritized.find(item => item.classification === 'PRIMARY');
}

export function secondaryFailuresOf(
  prioritized: ReadonlyArray<import('../vv/failure-contract-builder').PrioritizedFailure>,
): ReadonlyArray<import('../vv/failure-contract-builder').PrioritizedFailure> {
  return Object.freeze(prioritized.filter(item => item.classification === 'SECONDARY'));
}

export function incidentalFailuresOf(
  prioritized: ReadonlyArray<import('../vv/failure-contract-builder').PrioritizedFailure>,
): ReadonlyArray<import('../vv/failure-contract-builder').PrioritizedFailure> {
  return Object.freeze(prioritized.filter(item => item.classification === 'INCIDENTAL'));
}
