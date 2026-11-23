import { TEST_ACTOR } from './test-actor';
import {
  INTERNAL_VALIDATION_ERROR_CODES,
  InternalValidationRequest,
  ValidatorContract,
  createValidationOutcome,
} from '../../../src/domain/internal-validation';
import { ValidationRegistry } from '../../../src/core/validation/validation-registry';
import { InternalValidationRunner, internalValidationRunner } from '../../../src/core/validation/internal-validation-runner';
import {
  FORBIDDEN_EXECUTION_DEPENDENCIES,
  runWithContractGuard,
  validateWithContractGuard,
} from '../../../src/core/validation/validator-contract-guard';
import {
  fakeIsolationBreakingValidator,
  fakeMutatingValidator,
  fakeNonDeterministicValidator,
} from '../../../src/core/validation/adversarial-validators';

/**
 * Each fixture is registered into a throwaway registry so a test observes the
 * same frozen view the production registry hands out, without sharing state
 * with any other suite.
 */
function runnerFor(...validators: ValidatorContract[]): { runner: InternalValidationRunner; registry: ValidationRegistry } {
  const registry = new ValidationRegistry();
  for (const validator of validators) {
    expect(registry.register(validator, TEST_ACTOR).ok).toBe(true);
  }
  return { runner: new InternalValidationRunner(registry), registry };
}

/** Fails the test if any pipeline stage is reached during internal validation. */
function forbiddenStageSpies() {
  const planner = jest.fn();
  const provider = jest.fn();
  const executor = jest.fn();
  const reviewer = jest.fn();
  const verification = jest.fn();
  return {
    planner,
    provider,
    executor,
    reviewer,
    verification,
    expectNoneCalled() {
      expect(planner).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
      expect(executor).not.toHaveBeenCalled();
      expect(reviewer).not.toHaveBeenCalled();
      expect(verification).not.toHaveBeenCalled();
    },
  };
}

describe('validator contract guard: error codes', () => {
  it('declares the behavioral enforcement reason codes', () => {
    expect(INTERNAL_VALIDATION_ERROR_CODES).toEqual(
      expect.arrayContaining([
        'VALIDATOR_NON_DETERMINISTIC',
        'VALIDATOR_MUTATION_VIOLATION',
        'VALIDATOR_ISOLATION_VIOLATION',
      ]),
    );
  });
});

describe('Group A: determinism enforcement', () => {
  beforeEach(() => {
    (fakeNonDeterministicValidator as any).reset?.();
  });

  it('blocks a validator that declares determinism and diverges', () => {
    const stages = forbiddenStageSpies();
    const { runner } = runnerFor(fakeNonDeterministicValidator);

    const outcome = runner.run({ validator: 'FakeNonDeterministicValidator', input: { files: ['package.json'] } });

    expect(outcome.status).toBe('REJECT');
    expect(outcome.reasonCode).toBe('VALIDATOR_NON_DETERMINISTIC');
    expect(outcome.metadata?.validator).toBe('FakeNonDeterministicValidator');
    expect((outcome.metadata?.firstResult as any).status).toBe('ACCEPT');
    expect((outcome.metadata?.secondResult as any).status).toBe('REJECT');
    stages.expectNoneCalled();
  });

  it('calls the validator exactly twice for a deterministic contract', () => {
    const validate = jest.fn(() =>
      createValidationOutcome({ validator: 'StableValidator', status: 'ACCEPT', message: 'ok' }),
    );
    const stable: ValidatorContract = {
      name: 'StableValidator',
      type: 'ADVERSARIAL_FIXTURE',
      deterministic: true,
      mutationPolicy: 'NONE',
      isolation: 'INTERNAL_VALIDATION_ONLY',
      capabilities: ['READ_INPUT'],
      executionMode: 'SYNC_ONLY',
      contractVersion: '1.0.0',
      inputSchema: { requiredFields: [] },
      validate,
    };

    const result = runWithContractGuard(stable, { validator: 'StableValidator', input: {} });

    expect(result.executions).toBe(2);
    expect(validate).toHaveBeenCalledTimes(2);
    expect(result.outcome.status).toBe('ACCEPT');
  });

  it('runs a validator that does not claim determinism only once', () => {
    const validate = jest.fn(() =>
      createValidationOutcome({ validator: 'LooseValidator', status: 'ACCEPT' }),
    );
    const loose = {
      name: 'LooseValidator',
      type: 'ADVERSARIAL_FIXTURE',
      deterministic: false,
      mutationPolicy: 'NONE',
      isolation: 'INTERNAL_VALIDATION_ONLY',
      capabilities: ['READ_INPUT'],
      executionMode: 'SYNC_ONLY',
      contractVersion: '1.0.0',
      inputSchema: { requiredFields: [] },
      validate,
    } as unknown as ValidatorContract;

    const result = runWithContractGuard(loose, { validator: 'LooseValidator', input: {} });

    expect(result.executions).toBe(1);
    expect(result.outcome.status).toBe('ACCEPT');
  });
});

describe('Group B: mutation policy enforcement', () => {
  it('rejects a validator that mutates its request under mutationPolicy NONE', () => {
    const stages = forbiddenStageSpies();
    const { runner, registry } = runnerFor(fakeMutatingValidator);

    const request: InternalValidationRequest = {
      validator: 'FakeMutatingValidator',
      input: { files: ['package.json'] },
    };
    const outcome = runner.run(request);

    expect(outcome.status).toBe('REJECT');
    expect(outcome.reasonCode).toBe('VALIDATOR_MUTATION_VIOLATION');
    expect(outcome.metadata?.mutatedPaths).toEqual(
      expect.arrayContaining(['request.input.files.length', 'request.input.files[1]']),
    );

    // The caller's own request never reached the validator.
    expect((request.input as any).files).toEqual(['package.json']);
    expect((request.input as any).injected).toBeUndefined();

    // The registered contract is untouched by everything the fixture attempted.
    const resolved = registry.resolve('FakeMutatingValidator')!;
    expect(resolved.mutationPolicy).toBe('NONE');
    expect(resolved.inputSchema.requiredFields).toEqual([]);
    expect((resolved as any).metadata).toBeUndefined();
    stages.expectNoneCalled();
  });

  it('names every mutated path, including nested ones', () => {
    const nestedMutator: ValidatorContract = {
      name: 'NestedMutator',
      type: 'ADVERSARIAL_FIXTURE',
      deterministic: true,
      mutationPolicy: 'NONE',
      isolation: 'INTERNAL_VALIDATION_ONLY',
      capabilities: ['READ_INPUT'],
      executionMode: 'SYNC_ONLY',
      contractVersion: '1.0.0',
      inputSchema: { requiredFields: [] },
      validate(request: InternalValidationRequest) {
        (request.input as any).nested.flag = 'changed';
        return createValidationOutcome({ validator: 'NestedMutator', status: 'ACCEPT' });
      },
    };

    const outcome = validateWithContractGuard(nestedMutator, {
      validator: 'NestedMutator',
      input: { nested: { flag: 'original' } },
    });

    expect(outcome.reasonCode).toBe('VALIDATOR_MUTATION_VIOLATION');
    expect(outcome.metadata?.mutatedPaths).toEqual(['request.input.nested.flag']);
  });

  it('lets a read-only validator through untouched', () => {
    const readOnly: ValidatorContract = {
      name: 'ReadOnlyValidator',
      type: 'ADVERSARIAL_FIXTURE',
      deterministic: true,
      mutationPolicy: 'NONE',
      isolation: 'INTERNAL_VALIDATION_ONLY',
      capabilities: ['READ_INPUT'],
      executionMode: 'SYNC_ONLY',
      contractVersion: '1.0.0',
      inputSchema: { requiredFields: [] },
      validate(request: InternalValidationRequest) {
        const files = (request.input as any).files ?? [];
        return createValidationOutcome({
          validator: 'ReadOnlyValidator',
          status: 'ACCEPT',
          metadata: { count: files.length },
        });
      },
    };

    const outcome = validateWithContractGuard(readOnly, {
      validator: 'ReadOnlyValidator',
      input: { files: ['a.ts', 'b.ts'] },
    });

    expect(outcome.status).toBe('ACCEPT');
    expect(outcome.metadata?.count).toBe(2);
  });
});

describe('Group C: isolation enforcement', () => {
  it('rejects an isolation-breaking validator before its body runs', () => {
    const stages = forbiddenStageSpies();
    const { runner } = runnerFor(fakeIsolationBreakingValidator);
    const spy = jest.spyOn(fakeIsolationBreakingValidator, 'validate');

    const outcome = runner.run({
      validator: 'FakeIsolationBreakingValidator',
      input: { files: ['package.json'] },
    });

    expect(outcome.status).toBe('REJECT');
    expect(outcome.reasonCode).toBe('VALIDATOR_ISOLATION_VIOLATION');
    expect(outcome.metadata?.forbiddenDependencies).toEqual(
      expect.arrayContaining(['validator.executor', 'validator.provider']),
    );
    expect(spy).not.toHaveBeenCalled();
    stages.expectNoneCalled();

    spy.mockRestore();
  });

  it('reports zero executions when isolation fails', () => {
    const result = runWithContractGuard(fakeIsolationBreakingValidator, {
      validator: 'FakeIsolationBreakingValidator',
      input: { files: ['package.json'] },
    });

    expect(result.executions).toBe(0);
  });

  it('rejects a dependency injected alongside the request', () => {
    const clean: ValidatorContract = {
      name: 'CleanValidator',
      type: 'ADVERSARIAL_FIXTURE',
      deterministic: true,
      mutationPolicy: 'NONE',
      isolation: 'INTERNAL_VALIDATION_ONLY',
      capabilities: ['READ_INPUT'],
      executionMode: 'SYNC_ONLY',
      contractVersion: '1.0.0',
      inputSchema: { requiredFields: [] },
      validate: () => createValidationOutcome({ validator: 'CleanValidator', status: 'ACCEPT' }),
    };

    const result = runWithContractGuard(
      clean,
      { validator: 'CleanValidator', input: {} },
      { injected: { executor: {}, git: {} } },
    );

    expect(result.executions).toBe(0);
    expect(result.outcome.reasonCode).toBe('VALIDATOR_ISOLATION_VIOLATION');
    expect(result.outcome.metadata?.forbiddenDependencies).toEqual(
      expect.arrayContaining(['injected.executor', 'injected.git']),
    );
  });

  it('treats read-only context on the request as allowed', () => {
    const clean: ValidatorContract = {
      name: 'ContextReader',
      type: 'ADVERSARIAL_FIXTURE',
      deterministic: true,
      mutationPolicy: 'NONE',
      isolation: 'INTERNAL_VALIDATION_ONLY',
      capabilities: ['READ_INPUT'],
      executionMode: 'SYNC_ONLY',
      contractVersion: '1.0.0',
      inputSchema: { requiredFields: [] },
      validate: () => createValidationOutcome({ validator: 'ContextReader', status: 'ACCEPT' }),
    };

    const outcome = validateWithContractGuard(clean, {
      validator: 'ContextReader',
      input: {},
      context: ['docs/readme.md'],
      authority: ['src/a.ts'],
    });

    expect(outcome.status).toBe('ACCEPT');
  });

  it('names planner, provider, executor, reviewer, git and filesystem as forbidden', () => {
    expect(FORBIDDEN_EXECUTION_DEPENDENCIES).toEqual(
      expect.arrayContaining(['planner', 'provider', 'executor', 'reviewer', 'git', 'fileWriter', 'taskContext']),
    );
    expect(FORBIDDEN_EXECUTION_DEPENDENCIES).not.toContain('context');
  });
});

describe('Group D: regression under the guard', () => {
  it('still accepts PlannerAllowedTargets for an authorized target', () => {
    const stages = forbiddenStageSpies();

    const outcome = internalValidationRunner.run({
      validator: 'PlannerAllowedTargets',
      input: { files: ['package.json'], authority: ['package.json'] },
      authority: ['package.json'],
    });

    expect(outcome.status).toBe('ACCEPT');
    expect(outcome.reasonCode).toBeUndefined();
    expect(outcome.rejectedTargets).toEqual([]);
    stages.expectNoneCalled();
  });

  it('still rejects an unauthorized target with its own reason code', () => {
    const outcome = internalValidationRunner.run({
      validator: 'PlannerAllowedTargets',
      input: { files: ['src/secret.ts'] },
      authority: ['package.json'],
    });

    expect(outcome.status).toBe('REJECT');
    expect(outcome.reasonCode).not.toBe('VALIDATOR_NON_DETERMINISTIC');
    expect(outcome.rejectedTargets).toEqual(['src/secret.ts']);
  });

  it('leaves UNKNOWN_VALIDATOR behaviour intact', () => {
    const outcome = internalValidationRunner.run({ validator: 'NoSuchValidatorXYZ', input: {} });

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('UNKNOWN_VALIDATOR');
  });

  it('keeps the guard from swallowing a validator that throws', () => {
    const thrower: ValidatorContract = {
      name: 'ThrowingValidator',
      type: 'ADVERSARIAL_FIXTURE',
      deterministic: true,
      mutationPolicy: 'NONE',
      isolation: 'INTERNAL_VALIDATION_ONLY',
      capabilities: ['READ_INPUT'],
      executionMode: 'SYNC_ONLY',
      contractVersion: '1.0.0',
      inputSchema: { requiredFields: [] },
      validate() {
        throw new Error('boom');
      },
    };

    const outcome = validateWithContractGuard(thrower, { validator: 'ThrowingValidator', input: {} });

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('VALIDATOR_EXECUTION_ERROR');
    expect(outcome.message).toContain('boom');
  });
});
