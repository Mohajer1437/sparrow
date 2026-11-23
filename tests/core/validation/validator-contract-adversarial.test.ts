import { TEST_ACTOR } from './test-actor';
import {
  ValidatorContract,
  createValidationOutcome,
} from '../../../src/domain/internal-validation';
import { ValidationRegistry } from '../../../src/core/validation/validation-registry';
import { InternalValidationRunner } from '../../../src/core/validation/internal-validation-runner';

/**
 * Builds a validator whose contract can be bent in any direction, including
 * into shapes the type system forbids, so runtime enforcement is exercised
 * rather than assumed.
 */
function fakeValidator(overrides: Record<string, unknown>): ValidatorContract {
  return {
    name: 'FakeValidator',
    type: 'TEST',
    deterministic: true,
    mutationPolicy: 'NONE',
    isolation: 'INTERNAL_VALIDATION_ONLY',
    capabilities: ['READ_INPUT'],
    executionMode: 'SYNC_ONLY',
    contractVersion: '1.0.0',
    inputSchema: { requiredFields: [] },
    validate: jest.fn().mockImplementation(() =>
      createValidationOutcome({ validator: String(overrides.name ?? 'FakeValidator'), status: 'ACCEPT' }),
    ),
    ...overrides,
  } as unknown as ValidatorContract;
}

const REQUEST = { validator: '', input: {} };

/**
 * Forces a validator past registration so the runner's own pre-dispatch check
 * is the thing under test, not the registry's.
 */
function runnerBypassingRegistry(validator: ValidatorContract): InternalValidationRunner {
  // A bare resolver is an unverified source and is refused outright unless the
  // bypass is asked for. These cases want the contract check itself, so they
  // opt in explicitly; nothing in the shipped pipeline does.
  return new InternalValidationRunner(() => validator, { allowUnverifiedSource: true });
}

describe('Adversarial validator contracts', () => {
  it('1) refuses a validator that declares a WRITE mutation policy', () => {
    const validator = fakeValidator({ name: 'FakeMutationValidator', mutationPolicy: 'WRITE' });
    const registry = new ValidationRegistry();

    const registration = registry.register(validator, TEST_ACTOR);
    expect(registration.ok).toBe(false);
    expect(registration.code).toBe('INVALID_VALIDATOR_CONTRACT');
    expect(registry.resolve('FakeMutationValidator')).toBeUndefined();

    // Even if it reaches the runner by another route, it is not dispatched.
    const outcome = runnerBypassingRegistry(validator).run({
      ...REQUEST,
      validator: 'FakeMutationValidator',
    });

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('INVALID_VALIDATOR_CONTRACT');
    expect(outcome.issues.join(' ')).toContain('mutationPolicy must be NONE');
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it('2) refuses a validator that does not promise determinism', () => {
    const validator = fakeValidator({ name: 'FakeNonDeterministicValidator', deterministic: false });
    const registry = new ValidationRegistry();

    const registration = registry.register(validator, TEST_ACTOR);
    expect(registration.ok).toBe(false);
    expect(registration.code).toBe('INVALID_VALIDATOR_CONTRACT');

    const outcome = runnerBypassingRegistry(validator).run({
      ...REQUEST,
      validator: 'FakeNonDeterministicValidator',
    });

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('INVALID_VALIDATOR_CONTRACT');
    expect(outcome.issues).toContain('deterministic must be true');
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it('3) refuses a validator that is not isolated to internal validation', () => {
    const validator = fakeValidator({ name: 'FakeExternalValidator', isolation: 'STANDARD' });
    const registry = new ValidationRegistry();

    const registration = registry.register(validator, TEST_ACTOR);
    expect(registration.ok).toBe(false);
    expect(registration.code).toBe('INVALID_VALIDATOR_CONTRACT');

    const outcome = runnerBypassingRegistry(validator).run({
      ...REQUEST,
      validator: 'FakeExternalValidator',
    });

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('INVALID_VALIDATOR_CONTRACT');
    expect(outcome.issues.join(' ')).toContain('isolation must be INTERNAL_VALIDATION_ONLY');
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it('4) dispatches to a custom validator whose contract holds', () => {
    const validator = fakeValidator({ name: 'FakeValidValidator' });
    const registry = new ValidationRegistry();

    expect(registry.register(validator, TEST_ACTOR).ok).toBe(true);

    const outcome = new InternalValidationRunner(registry).run({
      validator: 'FakeValidValidator',
      input: { anything: true },
    });

    expect(outcome.status).toBe('ACCEPT');
    expect(outcome.validator).toBe('FakeValidValidator');
    // Twice: the contract guard re-runs a validator that declares determinism
    // and compares the two answers before letting either one through.
    expect(validator.validate).toHaveBeenCalledTimes(2);
  });

  it('5) keeps registries isolated from one another', () => {
    const validator = fakeValidator({ name: 'FakeValidValidator' });
    const registryA = new ValidationRegistry();
    const registryB = new ValidationRegistry();

    expect(registryA.register(validator, TEST_ACTOR).ok).toBe(true);

    expect(registryA.resolve('FakeValidValidator')?.name).toBe('FakeValidValidator');
    expect(registryB.resolve('FakeValidValidator')).toBeUndefined();
    expect(registryB.names()).toEqual([]);

    // A runner bound to registry B cannot see registry A's validator.
    const outcome = new InternalValidationRunner(registryB).run({
      validator: 'FakeValidValidator',
      input: {},
    });

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('UNKNOWN_VALIDATOR');
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it('registering into a custom registry does not leak into the shared one', () => {
    const validator = fakeValidator({ name: 'FakeLeakProbeValidator' });
    const registry = new ValidationRegistry();
    registry.register(validator, TEST_ACTOR);

    // The default runner resolves through the module-level registry.
    const outcome = new InternalValidationRunner().run({
      validator: 'FakeLeakProbeValidator',
      input: {},
    });

    expect(outcome.reasonCode).toBe('UNKNOWN_VALIDATOR');
  });
});
