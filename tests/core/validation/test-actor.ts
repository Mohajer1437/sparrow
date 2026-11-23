import { ValidatorGovernanceActor } from '../../../src/domain/validator-governance';

/** The actor tests attribute governance changes to. */
export const TEST_ACTOR: ValidatorGovernanceActor = Object.freeze({
  id: 'test:suite',
  type: 'TEST',
  name: 'validation test suite',
});
