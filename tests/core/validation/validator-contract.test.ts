import { TEST_ACTOR } from './test-actor';
import {
  ValidatorContract,
  createValidationOutcome,
  validateValidatorContract,
} from '../../../src/domain/internal-validation';
import { ValidationRegistry } from '../../../src/core/validation/validation-registry';
import { InternalValidationRunner } from '../../../src/core/validation/internal-validation-runner';
import { plannerAllowedTargetsValidator } from '../../../src/core/validation/planner-allowed-targets-validator';

function makeValidator(overrides: Partial<ValidatorContract> = {}): ValidatorContract {
  return {
    name: 'Sample',
    type: 'SAMPLE',
    deterministic: true,
    mutationPolicy: 'NONE',
    isolation: 'INTERNAL_VALIDATION_ONLY',
    capabilities: ['READ_INPUT'],
    executionMode: 'SYNC_ONLY',
    contractVersion: '1.0.0',
    inputSchema: { requiredFields: [] },
    validate: jest.fn().mockReturnValue(
      createValidationOutcome({ validator: 'Sample', status: 'ACCEPT' }),
    ),
    ...overrides,
  } as ValidatorContract;
}

describe('A) Validator contract validation', () => {
  it('accepts the shipped PlannerAllowedTargets contract', () => {
    const check = validateValidatorContract(plannerAllowedTargetsValidator);
    expect(check.valid).toBe(true);
    expect(check.violations).toEqual([]);
    expect(plannerAllowedTargetsValidator.mutationPolicy).toBe('NONE');
    expect(plannerAllowedTargetsValidator.isolation).toBe('INTERNAL_VALIDATION_ONLY');
    expect(plannerAllowedTargetsValidator.deterministic).toBe(true);
  });

  it('rejects a validator with no name', () => {
    const check = validateValidatorContract(makeValidator({ name: '' }));
    expect(check.valid).toBe(false);
    expect(check.violations).toContain('missing name');
  });

  it('rejects a validator that declares a write mutation policy', () => {
    const check = validateValidatorContract(makeValidator({ mutationPolicy: 'WRITE' }));
    expect(check.valid).toBe(false);
    expect(check.violations.join(' ')).toContain('mutationPolicy must be NONE');
  });

  it('rejects a non-deterministic validator', () => {
    const check = validateValidatorContract(makeValidator({ deterministic: false }));
    expect(check.valid).toBe(false);
    expect(check.violations).toContain('deterministic must be true');
  });

  it('rejects a validator that is not isolated to internal validation', () => {
    const check = validateValidatorContract(makeValidator({ isolation: 'SHARED' }));
    expect(check.valid).toBe(false);
    expect(check.violations.join(' ')).toContain('isolation must be INTERNAL_VALIDATION_ONLY');
  });

  it.each([
    ['missing name', makeValidator({ name: '' })],
    ['write mutation policy', makeValidator({ mutationPolicy: 'WRITE' })],
    ['non-deterministic', makeValidator({ deterministic: false })],
  ])('the runner refuses to dispatch to a validator with %s', (_label, validator) => {
    // The contract check is what is under test here, so the unverified-source
    // refusal is opted out of deliberately.
    const runner = new InternalValidationRunner(() => validator, { allowUnverifiedSource: true });

    const outcome = runner.run({ validator: 'Sample', input: { files: [] } });

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('INVALID_VALIDATOR_CONTRACT');
    expect(validator.validate).not.toHaveBeenCalled();
  });
});

describe('B) Validation registry', () => {
  it('registers a valid validator and resolves it by every accepted spelling', () => {
    const registry = new ValidationRegistry();
    expect(registry.register(plannerAllowedTargetsValidator, TEST_ACTOR).ok).toBe(true);

    expect(registry.resolve('PlannerAllowedTargets')?.name).toBe('PlannerAllowedTargets');
    expect(registry.resolve('plannerallowedtargets')?.name).toBe('PlannerAllowedTargets');
    expect(registry.resolve('PlannerAllowedTargetsValidator')?.name).toBe('PlannerAllowedTargets');
    expect(registry.names()).toEqual(['PlannerAllowedTargets']);
  });

  it('refuses a duplicate validator name', () => {
    const registry = new ValidationRegistry();
    registry.register(plannerAllowedTargetsValidator, TEST_ACTOR);

    const second = registry.register(plannerAllowedTargetsValidator, TEST_ACTOR);

    expect(second.ok).toBe(false);
    expect(second.code).toBe('DUPLICATE_VALIDATOR');
    expect(registry.names()).toHaveLength(1);
  });

  it('refuses a validator whose contract does not hold', () => {
    const registry = new ValidationRegistry();

    const registration = registry.register(makeValidator({ mutationPolicy: 'WRITE' }), TEST_ACTOR);

    expect(registration.ok).toBe(false);
    expect(registration.code).toBe('INVALID_VALIDATOR_CONTRACT');
    expect(registry.names()).toEqual([]);
  });

  it('exposes validator capabilities without the implementation', () => {
    const registry = new ValidationRegistry();
    registry.register(plannerAllowedTargetsValidator, TEST_ACTOR);

    const capabilities = registry.capabilitiesOf('PlannerAllowedTargets');

    expect(capabilities).toEqual({
      name: 'PlannerAllowedTargets',
      type: 'EXECUTION_AUTHORITY',
      deterministic: true,
      mutationPolicy: 'NONE',
      isolation: 'INTERNAL_VALIDATION_ONLY',
      capabilities: ['READ_INPUT', 'READ_CONTEXT'],
      executionMode: 'SYNC_ONLY',
      contractVersion: '1.0.0',
      inputSchema: plannerAllowedTargetsValidator.inputSchema,
    });
    expect((capabilities as any).validate).toBeUndefined();
  });

  it('reports an unknown validator', () => {
    const runner = new InternalValidationRunner(new ValidationRegistry());

    const outcome = runner.run({ validator: 'NoSuchValidator', input: {} });

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('UNKNOWN_VALIDATOR');
  });
});

describe('Input schema enforcement', () => {
  it('rejects input that satisfies none of the required alternatives', () => {
    const runner = new InternalValidationRunner();

    const outcome = runner.run({
      validator: 'PlannerAllowedTargets',
      input: { goal: 'no targets declared' },
      authority: ['package.json'],
    });

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('INVALID_VALIDATION_REQUEST');
    expect(outcome.issues.join(' ')).toContain('files, affectedFiles');
  });

  it('still standardizes the accept outcome shape', () => {
    const runner = new InternalValidationRunner();

    const outcome = runner.run({
      validator: 'PlannerAllowedTargets',
      input: { files: ['package.json'] },
      authority: ['package.json'],
    });

    expect(outcome.status).toBe('ACCEPT');
    expect(outcome.result).toBe(outcome.status);
    expect(outcome.rejectedTargets).toEqual([]);
    expect(outcome.metadata).toEqual({
      declaredTargetCount: 1,
      declaredReferenceCount: 0,
      authorizedPaths: ['package.json'],
    });
  });
});
