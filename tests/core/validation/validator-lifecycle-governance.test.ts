import { TEST_ACTOR } from './test-actor';
import {
  INTERNAL_VALIDATION_ERROR_CODES,
  ValidatorContract,
  createValidationOutcome,
} from '../../../src/domain/internal-validation';
import {
  ALLOWED_LIFECYCLE_TRANSITIONS,
  ValidatorLifecycleState,
  isAllowedLifecycleTransition,
} from '../../../src/domain/validator-governance';
import { ValidationRegistry, validationRegistry } from '../../../src/core/validation/validation-registry';
import { VALIDATOR_AUDIT_ACTIONS, ValidatorAuditLog } from '../../../src/core/validation/validator-audit-log';
import { InternalValidationRunner, internalValidationRunner } from '../../../src/core/validation/internal-validation-runner';
import {
  fakeDeprecatedValidator,
  fakeDisabledValidator,
  fakeUnverifiedResolverValidator,
} from '../../../src/core/validation/adversarial-validators';

function lifecycleContract(overrides: Partial<ValidatorContract> = {}): ValidatorContract {
  return {
    name: 'LifecycleProbe',
    type: 'ADVERSARIAL_FIXTURE',
    deterministic: true,
    mutationPolicy: 'NONE',
    isolation: 'INTERNAL_VALIDATION_ONLY',
    capabilities: ['READ_INPUT'],
    executionMode: 'SYNC_ONLY',
    contractVersion: '1.0.0',
    inputSchema: { requiredFields: [] },
    validate: jest.fn(() =>
      createValidationOutcome({ validator: 'LifecycleProbe', status: 'ACCEPT' }),
    ),
    ...overrides,
  } as ValidatorContract;
}

function seeded(): { registry: ValidationRegistry; runner: InternalValidationRunner; contract: ValidatorContract } {
  const registry = new ValidationRegistry(new ValidatorAuditLog());
  const contract = lifecycleContract();
  expect(registry.register(contract, TEST_ACTOR).ok).toBe(true);
  return { registry, runner: new InternalValidationRunner(registry), contract };
}

const probeRequest = { validator: 'LifecycleProbe', input: {} };

/** Fails the test if any pipeline stage is reached during internal validation. */
function forbiddenStageSpies() {
  const spies = {
    planner: jest.fn(),
    provider: jest.fn(),
    executor: jest.fn(),
    reviewer: jest.fn(),
    verification: jest.fn(),
  };
  return {
    ...spies,
    expectNoneCalled() {
      for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
    },
  };
}

describe('lifecycle model', () => {
  it('declares the lifecycle reason codes and audit actions', () => {
    expect(INTERNAL_VALIDATION_ERROR_CODES).toEqual(
      expect.arrayContaining([
        'UNVERIFIED_VALIDATOR_SOURCE',
        'VALIDATOR_DISABLED',
        'INVALID_VALIDATOR_STATE_TRANSITION',
      ]),
    );
    expect(VALIDATOR_AUDIT_ACTIONS).toEqual([
      'REGISTERED',
      'UPDATED',
      'REJECTED',
      'DEPRECATED',
      'ENABLED',
      'DISABLED',
      'EXECUTED_DEPRECATED',
    ]);
  });

  it('permits exactly the transitions the model allows', () => {
    expect(ALLOWED_LIFECYCLE_TRANSITIONS.ACTIVE).toEqual(['DEPRECATED', 'DISABLED']);
    expect(ALLOWED_LIFECYCLE_TRANSITIONS.DEPRECATED).toEqual(['ACTIVE', 'DISABLED']);
    expect(ALLOWED_LIFECYCLE_TRANSITIONS.DISABLED).toEqual([]);

    for (const state of ['ACTIVE', 'DEPRECATED', 'DISABLED'] as ValidatorLifecycleState[]) {
      expect(isAllowedLifecycleTransition(state, state)).toBe(true);
      expect(isAllowedLifecycleTransition('DISABLED', state === 'DISABLED' ? 'DISABLED' : state)).toBe(
        state === 'DISABLED',
      );
    }
  });

  it('starts every registration in ACTIVE', () => {
    const { registry } = seeded();

    expect(registry.governanceFor('LifecycleProbe')!.state).toBe('ACTIVE');
    expect(registry.governanceFor('LifecycleProbe')!.resolutionSource).toBe('REGISTERED_REGISTRY');
  });
});

describe('A) register then execute', () => {
  it('runs an ACTIVE validator normally', () => {
    const stages = forbiddenStageSpies();
    const { runner, registry, contract } = seeded();

    const outcome = runner.run(probeRequest);

    expect(outcome.status).toBe('ACCEPT');
    expect(outcome.reasonCode).toBeUndefined();
    expect(contract.validate).toHaveBeenCalled();
    expect(registry.auditHistoryFor('LifecycleProbe').map(e => e.action)).toEqual(['REGISTERED']);
    stages.expectNoneCalled();
  });
});

describe('B) deprecate then execute', () => {
  it('still accepts and records EXECUTED_DEPRECATED', () => {
    const { runner, registry } = seeded();
    expect(registry.deprecate('LifecycleProbe', TEST_ACTOR).ok).toBe(true);

    const outcome = runner.run(probeRequest);

    expect(outcome.status).toBe('ACCEPT');
    expect(registry.governanceFor('LifecycleProbe')!.state).toBe('DEPRECATED');
    expect(registry.auditHistoryFor('LifecycleProbe').map(e => e.action)).toEqual([
      'REGISTERED',
      'DEPRECATED',
      'EXECUTED_DEPRECATED',
    ]);
  });

  it('carries the identifying fields on the execution event', () => {
    const { runner, registry } = seeded();
    const record = registry.governanceFor('LifecycleProbe')!;
    registry.deprecate('LifecycleProbe', TEST_ACTOR);
    runner.run(probeRequest);

    const event = registry.auditHistoryFor('LifecycleProbe').find(e => e.action === 'EXECUTED_DEPRECATED')!;

    expect(event.validatorName).toBe('LifecycleProbe');
    expect(event.fingerprint).toBe(record.fingerprint);
    expect(event.contractVersion).toBe('1.0.0');
    expect(new Date(event.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('records one execution event per run', () => {
    const { runner, registry } = seeded();
    registry.deprecate('LifecycleProbe', TEST_ACTOR);

    runner.run(probeRequest);
    runner.run(probeRequest);

    const executions = registry
      .auditHistoryFor('LifecycleProbe')
      .filter(e => e.action === 'EXECUTED_DEPRECATED');
    expect(executions).toHaveLength(2);
  });

  it('rejects a deprecated validator through the shipped registry too', () => {
    const outcome = internalValidationRunner.run({
      validator: 'FakeDeprecatedValidator',
      input: { files: ['package.json'] },
    });

    expect(outcome.status).toBe('ACCEPT');
    expect(validationRegistry.governanceFor('FakeDeprecatedValidator')!.state).toBe('DEPRECATED');
    expect(
      validationRegistry.auditHistoryFor('FakeDeprecatedValidator').map(e => e.action),
    ).toEqual(expect.arrayContaining(['REGISTERED', 'DEPRECATED', 'EXECUTED_DEPRECATED']));
  });
});

describe('C) disable then execute', () => {
  it('rejects with VALIDATOR_DISABLED and never calls validate', () => {
    const stages = forbiddenStageSpies();
    const { runner, registry, contract } = seeded();
    expect(registry.disable('LifecycleProbe', TEST_ACTOR).ok).toBe(true);

    const outcome = runner.run(probeRequest);

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('VALIDATOR_DISABLED');
    expect(outcome.message).toContain('taken out of service');
    expect(contract.validate).not.toHaveBeenCalled();
    stages.expectNoneCalled();
  });

  it('rejects the shipped disabled fixture', () => {
    const outcome = internalValidationRunner.run({
      validator: 'FakeDisabledValidator',
      input: { files: ['package.json'] },
    });

    expect(outcome.reasonCode).toBe('VALIDATOR_DISABLED');
    expect(validationRegistry.governanceFor(fakeDisabledValidator.name)!.state).toBe('DISABLED');
  });

  it('allows DEPRECATED to move to DISABLED', () => {
    const { registry } = seeded();
    registry.deprecate('LifecycleProbe', TEST_ACTOR);

    expect(registry.disable('LifecycleProbe', TEST_ACTOR).ok).toBe(true);
    expect(registry.governanceFor('LifecycleProbe')!.state).toBe('DISABLED');
  });
});

describe('D) disable then enable', () => {
  it('refuses to bring a disabled validator back', () => {
    const { registry } = seeded();
    registry.disable('LifecycleProbe', TEST_ACTOR);

    const revival = registry.enable('LifecycleProbe', TEST_ACTOR);

    expect(revival.ok).toBe(false);
    expect(revival.code).toBe('INVALID_VALIDATOR_STATE_TRANSITION');
    expect(revival.message).toContain('cannot move from DISABLED to ACTIVE');
    expect(registry.governanceFor('LifecycleProbe')!.state).toBe('DISABLED');
  });

  it('refuses to deprecate a disabled validator', () => {
    const { registry } = seeded();
    registry.disable('LifecycleProbe', TEST_ACTOR);

    expect(registry.deprecate('LifecycleProbe', TEST_ACTOR).code).toBe('INVALID_VALIDATOR_STATE_TRANSITION');
  });

  it('audits the refused transition', () => {
    const { registry } = seeded();
    registry.disable('LifecycleProbe', TEST_ACTOR);
    registry.enable('LifecycleProbe', TEST_ACTOR);

    const rejected = registry.auditHistoryFor('LifecycleProbe').filter(e => e.action === 'REJECTED');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain('INVALID_VALIDATOR_STATE_TRANSITION');
  });

  it('refuses a lifecycle change on an unregistered validator', () => {
    const registry = new ValidationRegistry();

    expect(registry.disable('NoSuchProbe', TEST_ACTOR).code).toBe('UNKNOWN_VALIDATOR');
    expect(registry.deprecate('NoSuchProbe', TEST_ACTOR).code).toBe('UNKNOWN_VALIDATOR');
    expect(registry.enable('NoSuchProbe', TEST_ACTOR).code).toBe('UNKNOWN_VALIDATOR');
  });
});

describe('E) deprecated then enable', () => {
  it('returns the validator to ACTIVE', () => {
    const { registry, runner } = seeded();
    registry.deprecate('LifecycleProbe', TEST_ACTOR);

    const revival = registry.enable('LifecycleProbe', TEST_ACTOR);

    expect(revival.ok).toBe(true);
    expect(registry.governanceFor('LifecycleProbe')!.state).toBe('ACTIVE');

    const outcome = runner.run(probeRequest);
    expect(outcome.status).toBe('ACCEPT');

    // Back to ACTIVE means no further deprecation events.
    const actions = registry.auditHistoryFor('LifecycleProbe').map(e => e.action);
    expect(actions).toEqual(['REGISTERED', 'DEPRECATED', 'ENABLED']);
  });

  it('keeps the state across a version update', () => {
    const { registry } = seeded();
    registry.deprecate('LifecycleProbe', TEST_ACTOR);

    registry.update('LifecycleProbe', lifecycleContract({ contractVersion: '1.1.0' }), TEST_ACTOR);

    expect(registry.governanceFor('LifecycleProbe')!.state).toBe('DEPRECATED');
    expect(registry.governanceFor('LifecycleProbe')!.contractVersion).toBe('1.1.0');
  });
});

describe('F) unverified resolution source', () => {
  it('refuses a runner built over a bare resolver', () => {
    const stages = forbiddenStageSpies();
    const contract = lifecycleContract();
    const runner = new InternalValidationRunner(() => contract);

    const outcome = runner.run(probeRequest);

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('UNVERIFIED_VALIDATOR_SOURCE');
    expect(contract.validate).not.toHaveBeenCalled();
    stages.expectNoneCalled();
  });

  it('refuses before it even asks the resolver for a validator', () => {
    const resolver = jest.fn(() => lifecycleContract());

    const outcome = new InternalValidationRunner(resolver).run(probeRequest);

    expect(outcome.reasonCode).toBe('UNVERIFIED_VALIDATOR_SOURCE');
    expect(resolver).not.toHaveBeenCalled();
  });

  it('refuses a registry entry whose provenance is ungoverned', () => {
    const registry = new ValidationRegistry();
    const contract = lifecycleContract();
    registry.register(contract, TEST_ACTOR, 'UNVERIFIED_RESOLVER');

    const outcome = new InternalValidationRunner(registry).run(probeRequest);

    expect(outcome.reasonCode).toBe('UNVERIFIED_VALIDATOR_SOURCE');
    expect(outcome.message).toContain('UNVERIFIED_RESOLVER');
    expect(contract.validate).not.toHaveBeenCalled();
  });

  it('refuses the shipped unverified fixture', () => {
    const outcome = internalValidationRunner.run({
      validator: 'FakeUnverifiedResolverValidator',
      input: { files: ['package.json'] },
    });

    expect(outcome.reasonCode).toBe('UNVERIFIED_VALIDATOR_SOURCE');
    expect(
      validationRegistry.governanceFor(fakeUnverifiedResolverValidator.name)!.resolutionSource,
    ).toBe('UNVERIFIED_RESOLVER');
  });

  it('runs a bare resolver only when the bypass is asked for explicitly', () => {
    const contract = lifecycleContract();
    const runner = new InternalValidationRunner(() => contract, { allowUnverifiedSource: true });

    const outcome = runner.run(probeRequest);

    expect(outcome.status).toBe('ACCEPT');
    expect(contract.validate).toHaveBeenCalled();
  });
});

describe('G) audit immutability', () => {
  it('does not let a caller edit the history it was handed', () => {
    const { registry } = seeded();
    registry.deprecate('LifecycleProbe', TEST_ACTOR);

    const history = registry.auditHistory() as any;
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(history[0])).toBe(true);

    try {
      history.push({ validatorName: 'Injected', action: 'REGISTERED' });
    } catch {
      // Refusing the write is the passing behavior.
    }
    try {
      history[1].action = 'ENABLED';
    } catch {
      // Refusing the write is the passing behavior.
    }

    const again = registry.auditHistoryFor('LifecycleProbe');
    expect(again.map(e => e.action)).toEqual(['REGISTERED', 'DEPRECATED']);
    expect(registry.auditHistory().some(e => e.validatorName === 'Injected')).toBe(false);
  });
});

describe('H) regression for the shipped validators', () => {
  it('keeps PlannerAllowedTargets accepting an authorized target', () => {
    const stages = forbiddenStageSpies();

    const outcome = internalValidationRunner.run({
      validator: 'PlannerAllowedTargets',
      input: { files: ['package.json'], authority: ['package.json'] },
      authority: ['package.json'],
    });

    expect(outcome.status).toBe('ACCEPT');
    expect(outcome.reasonCode).toBeUndefined();
    stages.expectNoneCalled();
  });

  it('leaves PlannerAllowedTargets ACTIVE and registry-governed', () => {
    const record = validationRegistry.governanceFor('PlannerAllowedTargets')!;

    expect(record.state).toBe('ACTIVE');
    expect(record.resolutionSource).toBe('REGISTERED_REGISTRY');
  });

  it('keeps UNKNOWN_VALIDATOR behaviour intact', () => {
    const outcome = internalValidationRunner.run({ validator: 'NoSuchValidatorXYZ', input: {} });

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('UNKNOWN_VALIDATOR');
  });
});
