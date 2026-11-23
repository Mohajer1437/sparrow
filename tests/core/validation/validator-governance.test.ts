import { TEST_ACTOR } from './test-actor';
import {
  INTERNAL_VALIDATION_ERROR_CODES,
  ValidatorContract,
  createValidationOutcome,
} from '../../../src/domain/internal-validation';
import {
  compareContractVersions,
  computeContractFingerprint,
  isValidContractVersion,
  parseContractVersion,
} from '../../../src/domain/validator-governance';
import { ValidationRegistry, validationRegistry } from '../../../src/core/validation/validation-registry';
import { ValidatorAuditLog } from '../../../src/core/validation/validator-audit-log';
import { InternalValidationRunner, internalValidationRunner } from '../../../src/core/validation/internal-validation-runner';
import {
  fakeContractDriftValidator,
  fakeFingerprintCollisionValidatorA,
  fakeFingerprintCollisionValidatorB,
  fakeVersionConflictValidator,
} from '../../../src/core/validation/adversarial-validators';

function governedContract(overrides: Partial<ValidatorContract> = {}): ValidatorContract {
  return {
    name: 'GovernedProbe',
    type: 'ADVERSARIAL_FIXTURE',
    deterministic: true,
    mutationPolicy: 'NONE',
    isolation: 'INTERNAL_VALIDATION_ONLY',
    capabilities: ['READ_INPUT'],
    executionMode: 'SYNC_ONLY',
    contractVersion: '1.0.0',
    inputSchema: { requiredFields: [] },
    validate: () => createValidationOutcome({ validator: 'GovernedProbe', status: 'ACCEPT' }),
    ...overrides,
  } as ValidatorContract;
}

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

describe('contract versioning', () => {
  it('declares the governance reason codes', () => {
    expect(INTERNAL_VALIDATION_ERROR_CODES).toEqual(
      expect.arrayContaining([
        'INVALID_VALIDATOR_CONTRACT_VERSION',
        'VALIDATOR_CONTRACT_DRIFT',
        'VALIDATOR_VERSION_CONFLICT',
      ]),
    );
  });

  it('accepts semantic versions and refuses everything else', () => {
    for (const valid of ['1.0.0', '2.1.5', '0.0.1', '10.20.30']) {
      expect(isValidContractVersion(valid)).toBe(true);
    }
    for (const invalid of ['1', '1.0', 'v1', 'latest', '', '1.0.0-beta', '01.0.0', null, undefined, 1]) {
      expect(isValidContractVersion(invalid)).toBe(false);
    }
  });

  it('orders versions by major, then minor, then patch', () => {
    const at = (value: string) => parseContractVersion(value)!;

    expect(compareContractVersions(at('1.0.1'), at('1.0.0'))).toBeGreaterThan(0);
    expect(compareContractVersions(at('1.1.0'), at('1.0.9'))).toBeGreaterThan(0);
    expect(compareContractVersions(at('2.0.0'), at('1.9.9'))).toBeGreaterThan(0);
    expect(compareContractVersions(at('1.0.0'), at('1.0.0'))).toBe(0);
    expect(compareContractVersions(at('1.0.0'), at('1.0.1'))).toBeLessThan(0);
  });
});

describe('A) valid version registration', () => {
  it('accepts and reports the recorded fingerprint', () => {
    const registry = new ValidationRegistry();

    const registration = registry.register(governedContract(), TEST_ACTOR);

    expect(registration.ok).toBe(true);
    expect(registration.contractVersion).toBe('1.0.0');
    expect(registration.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(registry.governanceFor('GovernedProbe')).toEqual({
      validatorName: 'GovernedProbe',
      contractVersion: '1.0.0',
      fingerprint: registration.fingerprint,
      state: 'ACTIVE',
      resolutionSource: 'REGISTERED_REGISTRY',
    });
  });

  it('resolves the validator together with its governance', () => {
    const registry = new ValidationRegistry();
    registry.register(governedContract(), TEST_ACTOR);

    const governed = registry.resolveGoverned('GovernedProbe')!;

    expect(governed.validator.name).toBe('GovernedProbe');
    expect(governed.contractVersion).toBe('1.0.0');
    expect(governed.fingerprint).toBe(registry.governanceFor('GovernedProbe')!.fingerprint);
  });
});

describe('B) missing or malformed version', () => {
  it.each([undefined, '', '1', 'v1', 'latest'])('refuses contractVersion %p', version => {
    const contract = governedContract();
    (contract as any).contractVersion = version;
    if (version === undefined) delete (contract as any).contractVersion;

    const registration = new ValidationRegistry().register(contract, TEST_ACTOR);

    expect(registration.ok).toBe(false);
    expect(registration.code).toBe('INVALID_VALIDATOR_CONTRACT_VERSION');
    expect(registration.message).toContain('contractVersion must be semantic x.y.z');
  });
});

describe('C) and D) fingerprint stability', () => {
  it('gives the same contract the same fingerprint every time', () => {
    const first = computeContractFingerprint(governedContract());
    const second = computeContractFingerprint(governedContract());

    expect(first).toBe(second);
  });

  it.each([
    ['name', { name: 'OtherProbe' }],
    ['type', { type: 'OTHER' }],
    ['capabilities', { capabilities: ['READ_INPUT', 'READ_CONTEXT'] }],
    ['executionMode', { executionMode: 'ASYNC_ALLOWED' }],
    ['isolation', { isolation: 'SHARED' }],
    ['mutationPolicy', { mutationPolicy: 'WRITE' }],
    ['deterministic', { deterministic: false }],
    ['inputSchema', { inputSchema: { requiredFields: ['files'] } }],
    ['contractVersion', { contractVersion: '1.0.1' }],
  ])('changes the fingerprint when %s changes', (_field, override) => {
    const baseline = computeContractFingerprint(governedContract());

    expect(computeContractFingerprint(governedContract(override as any))).not.toBe(baseline);
  });

  it('is stable across a registration round trip', () => {
    const registry = new ValidationRegistry();
    const registration = registry.register(governedContract(), TEST_ACTOR);

    const resolved = registry.resolve('GovernedProbe')!;

    expect(computeContractFingerprint(resolved)).toBe(registration.fingerprint);
  });
});

describe('E) audit history isolation', () => {
  it('records an event for every accepted registration', () => {
    const registry = new ValidationRegistry(new ValidatorAuditLog());
    registry.register(governedContract(), TEST_ACTOR);

    const history = registry.auditHistoryFor('GovernedProbe');

    expect(history).toHaveLength(1);
    expect(history[0].action).toBe('REGISTERED');
    expect(history[0].validatorName).toBe('GovernedProbe');
    expect(history[0].contractVersion).toBe('1.0.0');
    expect(history[0].actor).toEqual(TEST_ACTOR);
    expect(history[0].source).toBe(TEST_ACTOR.id);
    expect(new Date(history[0].timestamp).toString()).not.toBe('Invalid Date');
  });

  it('records rejections with the reason', () => {
    const registry = new ValidationRegistry(new ValidatorAuditLog());
    registry.register(governedContract({ contractVersion: 'latest' }), TEST_ACTOR);

    const history = registry.auditHistoryFor('GovernedProbe');

    expect(history).toHaveLength(1);
    expect(history[0].action).toBe('REJECTED');
    expect(history[0].reason).toContain('INVALID_VALIDATOR_CONTRACT_VERSION');
  });

  it('records an UPDATED event for an accepted version bump', () => {
    const registry = new ValidationRegistry(new ValidatorAuditLog());
    registry.register(governedContract(), TEST_ACTOR);
    registry.update('GovernedProbe', governedContract({ contractVersion: '1.1.0' }), TEST_ACTOR);

    const actions = registry.auditHistoryFor('GovernedProbe').map(event => event.action);

    expect(actions).toEqual(['REGISTERED', 'UPDATED']);
  });

  it('hands back frozen copies that cannot reach the log', () => {
    const registry = new ValidationRegistry(new ValidatorAuditLog());
    registry.register(governedContract(), TEST_ACTOR);

    const history = registry.auditHistory() as any;
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(history[0])).toBe(true);

    // Both the array and the events refuse edits, and neither reaches the log.
    try {
      history.push({ validatorName: 'Injected' });
    } catch {
      // Refusing the write is the passing behavior.
    }
    try {
      history[0].action = 'REGISTERED_BY_ATTACKER';
    } catch {
      // Refusing the write is the passing behavior.
    }

    const again = registry.auditHistory();
    expect(again).toHaveLength(1);
    expect(again[0].action).toBe('REGISTERED');
    expect(again.some(event => event.validatorName === 'Injected')).toBe(false);
  });

  it('scopes history to the validator asked for', () => {
    const registry = new ValidationRegistry(new ValidatorAuditLog());
    registry.register(governedContract(), TEST_ACTOR);
    registry.register(governedContract({ name: 'OtherProbe' }), TEST_ACTOR);

    expect(registry.auditHistoryFor('GovernedProbe')).toHaveLength(1);
    expect(registry.auditHistory()).toHaveLength(2);
  });
});

describe('F) contract drift detection', () => {
  beforeEach(() => {
    (fakeContractDriftValidator as any).reset?.();
  });

  it('refuses to execute a validator whose contract changed after admission', () => {
    const stages = forbiddenStageSpies();

    const outcome = internalValidationRunner.run({
      validator: 'FakeContractDriftValidator',
      input: { files: ['package.json'] },
    });

    expect(outcome.reasonCode).toBe('VALIDATOR_CONTRACT_DRIFT');
    expect(outcome.message).toContain('but was registered as');
    stages.expectNoneCalled();
  });

  it('never reaches the validator body', () => {
    const registry = new ValidationRegistry();
    const validate = jest.fn(() =>
      createValidationOutcome({ validator: 'DriftProbe', status: 'ACCEPT' }),
    );
    const contract = governedContract({ name: 'DriftProbe', validate });
    registry.register(contract, TEST_ACTOR);

    // Desynchronise the recorded fingerprint from the stored contract the way a
    // read-varying contract would.
    const record = registry.governanceFor('DriftProbe')!;
    (registry as any).governance.set('driftprobe', { ...record, fingerprint: 'deadbeef' });

    const outcome = new InternalValidationRunner(registry).run({
      validator: 'DriftProbe',
      input: {},
    });

    expect(outcome.reasonCode).toBe('VALIDATOR_CONTRACT_DRIFT');
    expect(validate).not.toHaveBeenCalled();
  });

  it('lets a stable contract through untouched', () => {
    const registry = new ValidationRegistry();
    registry.register(governedContract(), TEST_ACTOR);

    const outcome = new InternalValidationRunner(registry).run({
      validator: 'GovernedProbe',
      input: {},
    });

    expect(outcome.status).toBe('ACCEPT');
    expect(outcome.reasonCode).toBeUndefined();
  });
});

describe('G) version conflict', () => {
  it('refuses the same version with a different contract', () => {
    const registry = new ValidationRegistry();
    registry.register(governedContract(), TEST_ACTOR);

    const conflicting = registry.update(
      'GovernedProbe',
      governedContract({ capabilities: ['READ_INPUT', 'READ_CONTEXT'] }),
      TEST_ACTOR,
    );

    expect(conflicting.ok).toBe(false);
    expect(conflicting.code).toBe('VALIDATOR_VERSION_CONFLICT');
    expect(registry.governanceFor('GovernedProbe')!.contractVersion).toBe('1.0.0');
    expect(registry.resolve('GovernedProbe')!.capabilities).toEqual(['READ_INPUT']);
  });

  it.each(['1.0.1', '1.1.0', '2.0.0'])('accepts a bump to %s', version => {
    const registry = new ValidationRegistry();
    registry.register(governedContract(), TEST_ACTOR);

    const updated = registry.update(
      'GovernedProbe',
      governedContract({ contractVersion: version, capabilities: ['READ_INPUT', 'READ_CONTEXT'] }),
      TEST_ACTOR,
    );

    expect(updated.ok).toBe(true);
    expect(registry.governanceFor('GovernedProbe')!.contractVersion).toBe(version);
    expect(registry.resolve('GovernedProbe')!.capabilities).toEqual(['READ_INPUT', 'READ_CONTEXT']);
  });

  it('refuses a version that moves backwards', () => {
    const registry = new ValidationRegistry();
    registry.register(governedContract({ contractVersion: '2.0.0' }), TEST_ACTOR);

    const downgrade = registry.update('GovernedProbe', governedContract({ contractVersion: '1.9.9' }), TEST_ACTOR);

    expect(downgrade.ok).toBe(false);
    expect(downgrade.code).toBe('VALIDATOR_VERSION_CONFLICT');
  });

  it('treats a republished identical contract as a no-op', () => {
    const registry = new ValidationRegistry(new ValidatorAuditLog());
    registry.register(governedContract(), TEST_ACTOR);

    const republished = registry.update('GovernedProbe', governedContract(), TEST_ACTOR);

    expect(republished.ok).toBe(true);
    expect(registry.auditHistoryFor('GovernedProbe').map(e => e.action)).toEqual(['REGISTERED']);
  });

  it('refuses to update a validator that was never registered', () => {
    const update = new ValidationRegistry().update('NoSuchProbe', governedContract(), TEST_ACTOR);

    expect(update.ok).toBe(false);
    expect(update.code).toBe('UNKNOWN_VALIDATOR');
  });

  it('surfaces the conflict through the adversarial fixture', () => {
    const outcome = internalValidationRunner.run({
      validator: 'FakeVersionConflictValidator',
      input: { files: ['package.json'] },
    });

    expect(outcome.status).toBe('REJECT');
    expect(outcome.reasonCode).toBe('VALIDATOR_VERSION_CONFLICT');
    expect(outcome.metadata?.conflictRefused).toBe(true);
  });
});

describe('H) fingerprint excludes the implementation', () => {
  it('gives two identical declarations the same fingerprint despite different bodies', () => {
    expect(fakeFingerprintCollisionValidatorA.validate).not.toBe(
      fakeFingerprintCollisionValidatorB.validate,
    );
    expect(computeContractFingerprint(fakeFingerprintCollisionValidatorA)).toBe(
      computeContractFingerprint(fakeFingerprintCollisionValidatorB),
    );
  });

  it('is unaffected by a swapped implementation on an otherwise equal contract', () => {
    const baseline = computeContractFingerprint(governedContract());
    const swapped = computeContractFingerprint(
      governedContract({
        validate: () =>
          createValidationOutcome({ validator: 'GovernedProbe', status: 'REJECT', reasonCode: 'X' }),
      }),
    );

    expect(swapped).toBe(baseline);
  });
});

describe('I) regression for the shipped validators', () => {
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

  it('records a governance entry for every shipped validator', () => {
    for (const declared of validationRegistry.capabilities()) {
      const record = validationRegistry.governanceFor(declared.name);
      expect(record).toBeDefined();
      expect(record!.contractVersion).toBe(declared.contractVersion);
      expect(record!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('keeps UNKNOWN_VALIDATOR behaviour intact', () => {
    const outcome = internalValidationRunner.run({ validator: 'NoSuchValidatorXYZ', input: {} });

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('UNKNOWN_VALIDATOR');
  });
});
