import { TEST_ACTOR } from './test-actor';
import { ValidatorContract, createValidationOutcome } from '../../../src/domain/internal-validation';
import {
  ValidatorGovernanceActor,
  isGovernanceActor,
} from '../../../src/domain/validator-governance';
import {
  ValidationRegistry,
  ValidatorRegistryState,
} from '../../../src/core/validation/validation-registry';
import { ValidatorAuditLog } from '../../../src/core/validation/validator-audit-log';
import { ValidatorExecutionAuditLog } from '../../../src/core/validation/validator-execution-audit-log';
import { InternalValidationRunner } from '../../../src/core/validation/internal-validation-runner';
import { fakeMutatingValidator } from '../../../src/core/validation/adversarial-validators';

function probeContract(overrides: Partial<ValidatorContract> = {}): ValidatorContract {
  return {
    name: 'EvidenceProbe',
    type: 'ADVERSARIAL_FIXTURE',
    deterministic: true,
    mutationPolicy: 'NONE',
    isolation: 'INTERNAL_VALIDATION_ONLY',
    capabilities: ['READ_INPUT'],
    executionMode: 'SYNC_ONLY',
    contractVersion: '1.0.0',
    inputSchema: { requiredFields: [] },
    validate: () => createValidationOutcome({ validator: 'EvidenceProbe', status: 'ACCEPT' }),
    ...overrides,
  } as ValidatorContract;
}

/** A clock that advances a fixed step per read, so evidence intervals are deterministic. */
function steppingClock(startMs = 1_700_000_000_000, stepMs = 5) {
  let current = startMs;
  return () => {
    const now = new Date(current);
    current += stepMs;
    return now;
  };
}

function seeded(contract: ValidatorContract = probeContract()) {
  const executionLog = new ValidatorExecutionAuditLog(steppingClock());
  const registry = new ValidationRegistry(new ValidatorAuditLog(), executionLog);
  expect(registry.register(contract, TEST_ACTOR).ok).toBe(true);
  return { registry, executionLog, runner: new InternalValidationRunner(registry), contract };
}

describe('A) governance actor is required', () => {
  const anonymous = [undefined, null, '', 'registry', {}, { id: 'x' }, { id: 'x', type: 'ROBOT', name: 'x' }];

  it.each(anonymous.map((value, index) => [index, value] as const))(
    'refuses register with actor candidate %i',
    (_index, value) => {
      const registry = new ValidationRegistry();
      const registration = registry.register(probeContract(), value as ValidatorGovernanceActor);

      expect(registration.ok).toBe(false);
      expect(registration.code).toBe('MISSING_GOVERNANCE_ACTOR');
      expect(registry.resolve('EvidenceProbe')).toBeUndefined();
    },
  );

  it('refuses every lifecycle mutation without an actor', () => {
    const { registry } = seeded();
    const missing = undefined as unknown as ValidatorGovernanceActor;

    for (const result of [
      registry.update('EvidenceProbe', probeContract({ contractVersion: '1.1.0' }), missing),
      registry.deprecate('EvidenceProbe', missing),
      registry.disable('EvidenceProbe', missing),
      registry.enable('EvidenceProbe', missing),
      registry.importState(registry.exportState(), missing),
    ]) {
      expect(result.ok).toBe(false);
      expect(result.code).toBe('MISSING_GOVERNANCE_ACTOR');
    }

    expect(registry.governanceFor('EvidenceProbe')!.state).toBe('ACTIVE');
  });

  it('recognises only well formed actors', () => {
    expect(isGovernanceActor(TEST_ACTOR)).toBe(true);
    expect(isGovernanceActor({ id: ' ', type: 'USER', name: 'x' })).toBe(false);
    expect(isGovernanceActor({ id: 'x', type: 'USER', name: '' })).toBe(false);
  });
});

describe('B) registration audit carries the actor', () => {
  it('attributes REGISTERED to the actor that asked for it', () => {
    const { registry } = seeded();
    const [event] = registry.auditHistoryFor('EvidenceProbe');

    expect(event.action).toBe('REGISTERED');
    expect(event.actor).toEqual(TEST_ACTOR);
    expect(event.actor.type).toBe('TEST');
    expect(event.source).toBe(TEST_ACTOR.id);
  });

  it('attributes a rejection to the actor as well', () => {
    const registry = new ValidationRegistry();
    const actor: ValidatorGovernanceActor = { id: 'user:ada', type: 'USER', name: 'Ada' };
    registry.register(probeContract({ contractVersion: 'latest' }), actor);

    const [event] = registry.auditHistoryFor('EvidenceProbe');
    expect(event.action).toBe('REJECTED');
    expect(event.actor).toEqual(actor);
  });
});

describe('C) lifecycle audit carries the actor', () => {
  it('attributes DISABLED to the actor that disabled it', () => {
    const { registry } = seeded();
    const operator: ValidatorGovernanceActor = { id: 'user:operator', type: 'USER', name: 'Operator' };

    expect(registry.disable('EvidenceProbe', operator).ok).toBe(true);

    const disabled = registry.auditHistoryFor('EvidenceProbe').find(e => e.action === 'DISABLED');
    expect(disabled).toBeDefined();
    expect(disabled!.actor).toEqual(operator);
    expect(registry.governanceFor('EvidenceProbe')!.state).toBe('DISABLED');
  });

  it('attributes DEPRECATED and ENABLED to their actors', () => {
    const { registry } = seeded();
    const a: ValidatorGovernanceActor = { id: 'user:a', type: 'USER', name: 'A' };
    const b: ValidatorGovernanceActor = { id: 'system:b', type: 'SYSTEM', name: 'B' };

    expect(registry.deprecate('EvidenceProbe', a).ok).toBe(true);
    expect(registry.enable('EvidenceProbe', b).ok).toBe(true);

    const history = registry.auditHistoryFor('EvidenceProbe');
    expect(history.find(e => e.action === 'DEPRECATED')!.actor).toEqual(a);
    expect(history.find(e => e.action === 'ENABLED')!.actor).toEqual(b);
  });
});

describe('D) successful execution produces SUCCESS evidence', () => {
  it('records one piece of evidence per run', () => {
    const { runner, registry, executionLog } = seeded();

    const outcome = runner.run({ validator: 'EvidenceProbe', input: {} });
    expect(outcome.status).toBe('ACCEPT');

    const history = executionLog.historyForValidator('EvidenceProbe');
    expect(history).toHaveLength(1);

    const evidence = history[0];
    const record = registry.governanceFor('EvidenceProbe')!;
    expect(evidence.result).toBe('SUCCESS');
    expect(evidence.errorCode).toBeUndefined();
    expect(evidence.fingerprint).toBe(record.fingerprint);
    expect(evidence.contractVersion).toBe('1.0.0');
    expect(evidence.lifecycleState).toBe('ACTIVE');
    expect(evidence.actor.type).toBe('SYSTEM');
    expect(new Date(evidence.startedAt).getTime()).toBeLessThanOrEqual(
      new Date(evidence.completedAt).getTime(),
    );
  });

  it('appends one record per execution', () => {
    const { runner, executionLog } = seeded();
    runner.run({ validator: 'EvidenceProbe', input: {} });
    runner.run({ validator: 'EvidenceProbe', input: {} });

    expect(executionLog.historyForValidator('EvidenceProbe')).toHaveLength(2);
  });
});

describe('E) a validator that breaks its contract produces FAILED evidence', () => {
  it('records FAILED with the guard error code', () => {
    const { runner, executionLog } = seeded(fakeMutatingValidator);

    const outcome = runner.run({ validator: fakeMutatingValidator.name, input: { files: ['a.ts'] } });
    expect(outcome.status).not.toBe('ACCEPT');

    const [evidence] = executionLog.history();
    expect(evidence.result).toBe('FAILED');
    expect(evidence.errorCode).toBe('VALIDATOR_MUTATION_VIOLATION');
    expect(evidence.errorCode).toBe(outcome.reasonCode);
  });
});

describe('F) a disabled validator produces REJECTED evidence', () => {
  it('records REJECTED with VALIDATOR_DISABLED', () => {
    const { runner, registry, executionLog } = seeded();
    expect(registry.disable('EvidenceProbe', TEST_ACTOR).ok).toBe(true);

    const outcome = runner.run({ validator: 'EvidenceProbe', input: {} });
    expect(outcome.reasonCode).toBe('VALIDATOR_DISABLED');

    const [evidence] = executionLog.history();
    expect(evidence.result).toBe('REJECTED');
    expect(evidence.errorCode).toBe('VALIDATOR_DISABLED');
    expect(evidence.lifecycleState).toBe('DISABLED');
  });

  it('records REJECTED for a validator that was never registered', () => {
    const { runner, executionLog } = seeded();

    const outcome = runner.run({ validator: 'NoSuchValidator', input: {} });
    expect(outcome.reasonCode).toBe('UNKNOWN_VALIDATOR');

    const [evidence] = executionLog.history();
    expect(evidence.result).toBe('REJECTED');
    expect(evidence.errorCode).toBe('UNKNOWN_VALIDATOR');
  });
});

describe('G) execution history is immutable', () => {
  it('ignores mutation of the returned history and of its records', () => {
    const { runner, executionLog } = seeded();
    runner.run({ validator: 'EvidenceProbe', input: {} });

    const history = executionLog.history();
    expect(Object.isFrozen(history)).toBe(true);
    expect(() => (history as unknown as ValidatorExecutionRecordLike[]).push({} as never)).toThrow();

    const record = history[0] as { result: string; errorCode?: string };
    try {
      record.result = 'SUCCESS_FORGED';
      record.errorCode = 'FORGED';
    } catch {
      // Frozen in strict mode; either refusal is acceptable.
    }

    const reread = executionLog.history();
    expect(reread[0].result).toBe('SUCCESS');
    expect(reread[0].errorCode).toBeUndefined();
    expect(reread).toHaveLength(1);
  });

  it('does not expose the backing array through historyForValidator', () => {
    const { runner, executionLog } = seeded();
    runner.run({ validator: 'EvidenceProbe', input: {} });

    const filtered = executionLog.historyForValidator('EvidenceProbe');
    expect(Object.isFrozen(filtered)).toBe(true);
    expect(executionLog.size()).toBe(1);
  });
});

type ValidatorExecutionRecordLike = { result: string };

describe('H) export and import round trip', () => {
  it('carries fingerprints, versions, and lifecycle states across', () => {
    const source = seeded();
    expect(source.registry.deprecate('EvidenceProbe', TEST_ACTOR).ok).toBe(true);

    const state = source.registry.exportState();
    expect(Object.isFrozen(state)).toBe(true);

    const target = new ValidationRegistry();
    expect(target.register(probeContract(), TEST_ACTOR).ok).toBe(true);
    expect(target.importState(state, TEST_ACTOR).ok).toBe(true);

    const before = source.registry.governanceFor('EvidenceProbe')!;
    const after = target.governanceFor('EvidenceProbe')!;
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.contractVersion).toBe(before.contractVersion);
    expect(after.state).toBe('DEPRECATED');
  });

  it('records the import against the importing actor', () => {
    const source = seeded();
    source.registry.disable('EvidenceProbe', TEST_ACTOR);

    const importer: ValidatorGovernanceActor = { id: 'system:restore', type: 'SYSTEM', name: 'restore' };
    const target = new ValidationRegistry();
    target.register(probeContract(), TEST_ACTOR);
    expect(target.importState(source.registry.exportState(), importer).ok).toBe(true);

    const disabled = target.auditHistoryFor('EvidenceProbe').find(e => e.action === 'DISABLED');
    expect(disabled!.actor).toEqual(importer);
  });
});

describe('I) a disabled validator stays disabled across an import', () => {
  it('still refuses to execute after the state is restored', () => {
    const source = seeded();
    source.registry.disable('EvidenceProbe', TEST_ACTOR);

    const executionLog = new ValidatorExecutionAuditLog(steppingClock());
    const target = new ValidationRegistry(new ValidatorAuditLog(), executionLog);
    target.register(probeContract(), TEST_ACTOR);
    expect(target.importState(source.registry.exportState(), TEST_ACTOR).ok).toBe(true);

    const outcome = new InternalValidationRunner(target).run({
      validator: 'EvidenceProbe',
      input: {},
    });

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('VALIDATOR_DISABLED');
    expect(executionLog.history()[0].result).toBe('REJECTED');
  });
});

describe('J) a corrupted import is refused', () => {
  function corrupt(state: ValidatorRegistryState, patch: Record<string, unknown>): ValidatorRegistryState {
    return {
      version: 1,
      records: state.records.map(record => ({ ...record, ...patch })),
    } as ValidatorRegistryState;
  }

  it('refuses a record whose fingerprint does not match the registered contract', () => {
    const source = seeded();
    source.registry.disable('EvidenceProbe', TEST_ACTOR);

    const target = new ValidationRegistry();
    target.register(probeContract(), TEST_ACTOR);

    const tampered = corrupt(source.registry.exportState(), { fingerprint: 'f'.repeat(64) });
    const result = target.importState(tampered, TEST_ACTOR);

    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMPORT_CONTRACT_DRIFT');
    // Refused wholesale: no lifecycle change leaked through.
    expect(target.governanceFor('EvidenceProbe')!.state).toBe('ACTIVE');
  });

  it('refuses a record carrying a non semantic version', () => {
    const source = seeded();
    const target = new ValidationRegistry();
    target.register(probeContract(), TEST_ACTOR);

    const tampered = corrupt(source.registry.exportState(), { contractVersion: 'latest' });
    const result = target.importState(tampered, TEST_ACTOR);

    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMPORT_INVALID_VERSION');
  });

  it('refuses state that carries no records at all', () => {
    const target = new ValidationRegistry();
    const result = target.importState({ version: 1 } as ValidatorRegistryState, TEST_ACTOR);

    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID_VALIDATOR_CONTRACT');
  });

  it('ignores records for validators this registry does not hold', () => {
    const source = seeded();
    const target = new ValidationRegistry();

    expect(target.importState(source.registry.exportState(), TEST_ACTOR).ok).toBe(true);
    expect(target.governanceFor('EvidenceProbe')).toBeUndefined();
  });
});
