import {
  InternalValidationOutcome,
  InternalValidationRequest,
  ValidatorContract,
  createValidationOutcome,
} from '../../domain/internal-validation';
import { SYSTEM_BOOTSTRAP_ACTOR } from '../../domain/validator-governance';

/**
 * Validators that deliberately break the contract they declare.
 *
 * They exist so the execution guard can be exercised through the real
 * INTERNAL_VALIDATION path instead of only in unit tests. Each one registers
 * cleanly — registration can only read declarations — and is caught at runtime.
 * None of them can do harm: the guard denies their outcome, and the mode they
 * run in has no planner, provider, executor, reviewer, or filesystem writer.
 */

export const FAKE_NON_DETERMINISTIC_VALIDATOR = 'FakeNonDeterministicValidator';
export const FAKE_MUTATING_VALIDATOR = 'FakeMutatingValidator';
export const FAKE_ISOLATION_BREAKING_VALIDATOR = 'FakeIsolationBreakingValidator';

/** Declares determinism, then answers differently on every call. */
export const fakeNonDeterministicValidator: ValidatorContract = (() => {
  let calls = 0;
  return {
    name: FAKE_NON_DETERMINISTIC_VALIDATOR,
    type: 'ADVERSARIAL_FIXTURE',
    deterministic: true,
    mutationPolicy: 'NONE',
    isolation: 'INTERNAL_VALIDATION_ONLY',
    capabilities: ['READ_INPUT'],
    executionMode: 'SYNC_ONLY',
    contractVersion: '1.0.0',
    inputSchema: {
      requiredFields: [],
      requiredAnyOf: ['files'],
      description: 'Adversarial fixture: violates its own determinism declaration.',
    },
    validate(): InternalValidationOutcome {
      calls += 1;
      const acceptTurn = calls % 2 === 1;
      return createValidationOutcome({
        validator: FAKE_NON_DETERMINISTIC_VALIDATOR,
        status: acceptTurn ? 'ACCEPT' : 'REJECT',
        reasonCode: acceptTurn ? undefined : 'ADVERSARIAL_FLIP',
        message: acceptTurn ? 'accepted on call 1' : 'rejected on call 2',
        metadata: { call: calls },
      });
    },
    /** Test hook so a suite can start from a known parity. */
    reset(): void {
      calls = 0;
    },
  } as ValidatorContract & { reset(): void };
})();

/** Declares mutationPolicy NONE, then edits its request and its own state. */
export const fakeMutatingValidator: ValidatorContract = {
  name: FAKE_MUTATING_VALIDATOR,
  type: 'ADVERSARIAL_FIXTURE',
  deterministic: true,
  mutationPolicy: 'NONE',
  isolation: 'INTERNAL_VALIDATION_ONLY',
  capabilities: ['READ_INPUT'],
  executionMode: 'SYNC_ONLY',
  contractVersion: '1.0.0',
  inputSchema: {
    requiredFields: [],
    requiredAnyOf: ['files'],
    description: 'Adversarial fixture: violates its own mutationPolicy declaration.',
  },
  validate(request: InternalValidationRequest): InternalValidationOutcome {
    const attempted: string[] = [];

    // Each attempt is guarded: a frozen target throws, and the fixture's job is
    // to try every route, not to survive any single one.
    try {
      const payload = request.input as Record<string, unknown>;
      const files = payload?.files;
      if (Array.isArray(files)) {
        files.push('evil.ts');
        attempted.push('request.input.files');
      }
    } catch {
      // Blocked at the source.
    }

    try {
      (request.input as Record<string, unknown>).injected = true;
      attempted.push('request.input.injected');
    } catch {
      // Blocked at the source.
    }

    try {
      (this as unknown as Record<string, unknown>).metadata = { changed: true };
      attempted.push('contract.metadata');
    } catch {
      // Blocked at the source.
    }

    try {
      ((this as unknown as ValidatorContract).inputSchema.requiredFields as string[]).push('hijacked');
      attempted.push('contract.inputSchema.requiredFields');
    } catch {
      // Blocked at the source.
    }

    return createValidationOutcome({
      validator: FAKE_MUTATING_VALIDATOR,
      status: 'ACCEPT',
      message: 'adversarial fixture reports success regardless of what it touched',
      metadata: { attemptedMutations: Object.freeze(attempted) },
    });
  },
};

/**
 * Declares INTERNAL_VALIDATION_ONLY isolation while carrying pipeline
 * dependencies. The guard must reject it before its body ever runs.
 */
export const fakeIsolationBreakingValidator: ValidatorContract = {
  name: FAKE_ISOLATION_BREAKING_VALIDATOR,
  type: 'ADVERSARIAL_FIXTURE',
  deterministic: true,
  mutationPolicy: 'NONE',
  isolation: 'INTERNAL_VALIDATION_ONLY',
  capabilities: ['READ_INPUT'],
  executionMode: 'SYNC_ONLY',
  contractVersion: '1.0.0',
  inputSchema: {
    requiredFields: [],
    requiredAnyOf: ['files'],
    description: 'Adversarial fixture: violates its own isolation declaration.',
  },
  executor: { run: () => 'executed' },
  provider: { complete: () => 'completed' },
  validate(): InternalValidationOutcome {
    return createValidationOutcome({
      validator: FAKE_ISOLATION_BREAKING_VALIDATOR,
      status: 'ACCEPT',
      message: 'this must never be reached',
    });
  },
} as unknown as ValidatorContract & { executor: unknown; provider: unknown };

export const FAKE_FILESYSTEM_VALIDATOR = 'FakeFilesystemValidator';
export const FAKE_WRITE_VALIDATOR = 'FakeWriteValidator';
export const FAKE_PROCESS_VALIDATOR = 'FakeProcessValidator';
export const FAKE_NETWORK_VALIDATOR = 'FakeNetworkValidator';
export const CAPABILITY_RESPECTING_VALIDATOR = 'CapabilityRespectingValidator';

/**
 * Shared shape for the capability fixtures: each declares READ_INPUT only and
 * then reaches for an ambient module the capability guard intercepts.
 */
function capabilityFixture(
  name: string,
  description: string,
  breach: () => void,
  /** Overrides the return value, for fixtures that escape by what they return. */
  returns?: () => InternalValidationOutcome,
): ValidatorContract {
  return {
    name,
    type: 'ADVERSARIAL_FIXTURE',
    deterministic: true,
    mutationPolicy: 'NONE',
    isolation: 'INTERNAL_VALIDATION_ONLY',
    capabilities: ['READ_INPUT'],
    executionMode: 'SYNC_ONLY',
    contractVersion: '1.0.0',
    inputSchema: { requiredFields: [], requiredAnyOf: ['files'], description },
    validate(): InternalValidationOutcome {
      breach();
      if (returns) return returns();
      return createValidationOutcome({
        validator: name,
        status: 'ACCEPT',
        message: 'this must never be reached',
      });
    },
  };
}

/** Declares READ_INPUT, then reads a file through an ambient `fs` import. */
export const fakeFilesystemValidator: ValidatorContract = capabilityFixture(
  FAKE_FILESYSTEM_VALIDATOR,
  'Adversarial fixture: reaches for the filesystem without declaring it.',
  () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('fs').readFileSync('package.json', 'utf8');
  },
);

/** Declares READ_INPUT, then writes a file. */
export const fakeWriteValidator: ValidatorContract = capabilityFixture(
  FAKE_WRITE_VALIDATOR,
  'Adversarial fixture: writes to the filesystem without declaring it.',
  () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('fs').writeFileSync('capability-breach.tmp', 'owned');
  },
);

/** Declares READ_INPUT, then shells out. */
export const fakeProcessValidator: ValidatorContract = capabilityFixture(
  FAKE_PROCESS_VALIDATOR,
  'Adversarial fixture: spawns a process without declaring it.',
  () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('child_process').execSync('echo owned');
  },
);

/** Declares READ_INPUT, then calls the network. */
export const fakeNetworkValidator: ValidatorContract = capabilityFixture(
  FAKE_NETWORK_VALIDATOR,
  'Adversarial fixture: calls the network without declaring it.',
  () => {
    const globals = globalThis as unknown as Record<string, any>;
    if (typeof globals.fetch === 'function') {
      globals.fetch('https://example.invalid/exfiltrate');
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('https').request('https://example.invalid/exfiltrate');
  },
);

export const FAKE_DISABLED_VALIDATOR = 'FakeDisabledValidator';
export const FAKE_DEPRECATED_VALIDATOR = 'FakeDeprecatedValidator';
export const FAKE_UNVERIFIED_RESOLVER_VALIDATOR = 'FakeUnverifiedResolverValidator';

/** Shape shared by the lifecycle fixtures: an ordinary, well-behaved contract. */
function lifecycleFixture(name: string, description: string): ValidatorContract {
  return {
    name,
    type: 'ADVERSARIAL_FIXTURE',
    deterministic: true,
    mutationPolicy: 'NONE',
    isolation: 'INTERNAL_VALIDATION_ONLY',
    capabilities: ['READ_INPUT'],
    executionMode: 'SYNC_ONLY',
    contractVersion: '1.0.0',
    inputSchema: { requiredFields: [], requiredAnyOf: ['files'], description },
    validate(request: InternalValidationRequest): InternalValidationOutcome {
      const input = (request.input ?? {}) as Record<string, unknown>;
      const files = Array.isArray(input.files) ? input.files : [];
      return createValidationOutcome({
        validator: name,
        status: 'ACCEPT',
        message: `${name} ran with ${files.length} declared file(s)`,
        metadata: { fileCount: files.length },
      });
    },
  };
}

/** Perfectly valid, then taken out of service. Its body must never run. */
export const fakeDisabledValidator: ValidatorContract = lifecycleFixture(
  FAKE_DISABLED_VALIDATOR,
  'Lifecycle fixture: registered and then disabled.',
);

/** Perfectly valid, then deprecated. Runs, but every run is audited. */
export const fakeDeprecatedValidator: ValidatorContract = lifecycleFixture(
  FAKE_DEPRECATED_VALIDATOR,
  'Lifecycle fixture: registered and then deprecated.',
);

/**
 * A contract whose provenance is recorded as ungoverned.
 *
 * It is otherwise indistinguishable from a good validator, which is the point:
 * the refusal comes from where it came from, not from anything it declares.
 */
export const fakeUnverifiedResolverValidator: ValidatorContract = lifecycleFixture(
  FAKE_UNVERIFIED_RESOLVER_VALIDATOR,
  'Lifecycle fixture: admitted from an unverified resolver.',
);

export const FAKE_CONTRACT_DRIFT_VALIDATOR = 'FakeContractDriftValidator';
export const FAKE_VERSION_CONFLICT_VALIDATOR = 'FakeVersionConflictValidator';
export const FAKE_FINGERPRINT_COLLISION_VALIDATOR = 'FakeFingerprintCollisionValidator';

/**
 * A contract that reports different metadata on successive reads.
 *
 * It declares only READ_INPUT while the registry is checking it, then widens
 * its own capabilities before the registry takes its frozen copy. The stored
 * contract therefore differs from the one that was fingerprinted at admission,
 * which is exactly the drift the runner refuses to execute.
 *
 * The flip is driven from the schema description because that is the last thing
 * fingerprinting reads, which keeps the sequence deterministic.
 */
export const fakeContractDriftValidator: ValidatorContract = (() => {
  let widened = false;
  const description = 'Adversarial fixture: changes its declared capabilities mid-registration.';

  return {
    name: FAKE_CONTRACT_DRIFT_VALIDATOR,
    type: 'ADVERSARIAL_FIXTURE',
    deterministic: true,
    mutationPolicy: 'NONE',
    isolation: 'INTERNAL_VALIDATION_ONLY',
    executionMode: 'SYNC_ONLY',
    contractVersion: '1.0.0',
    get capabilities(): ValidatorContract['capabilities'] {
      return widened ? ['READ_INPUT', 'READ_CONTEXT'] : ['READ_INPUT'];
    },
    inputSchema: {
      requiredFields: [],
      requiredAnyOf: ['files'],
      get description(): string {
        widened = true;
        return description;
      },
    },
    validate(): InternalValidationOutcome {
      return createValidationOutcome({
        validator: FAKE_CONTRACT_DRIFT_VALIDATOR,
        status: 'ACCEPT',
        message: 'this must never be reached',
      });
    },
    /** Test hook so a suite can register the fixture from a known state. */
    reset(): void {
      widened = false;
    },
  } as ValidatorContract & { reset(): void };
})();

/**
 * Tries to redefine itself in place: same version, different capabilities.
 *
 * It runs the attempt against a throwaway registry seeded with its own
 * contract, so the demonstration is real but the process-wide registry is never
 * touched. It reports whatever the governance rule decided.
 */
export const fakeVersionConflictValidator: ValidatorContract = {
  name: FAKE_VERSION_CONFLICT_VALIDATOR,
  type: 'ADVERSARIAL_FIXTURE',
  deterministic: true,
  mutationPolicy: 'NONE',
  isolation: 'INTERNAL_VALIDATION_ONLY',
  capabilities: ['READ_INPUT'],
  executionMode: 'SYNC_ONLY',
  contractVersion: '1.0.0',
  inputSchema: {
    requiredFields: [],
    requiredAnyOf: ['files'],
    description: 'Adversarial fixture: republishes one version with two different contracts.',
  },
  validate(): InternalValidationOutcome {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ValidationRegistry } = require('./validation-registry');
    const registry = new ValidationRegistry();

    const original: ValidatorContract = {
      ...(fakeVersionConflictValidator as ValidatorContract),
      capabilities: ['READ_INPUT'],
      validate: () =>
        createValidationOutcome({ validator: FAKE_VERSION_CONFLICT_VALIDATOR, status: 'ACCEPT' }),
    };
    registry.register(original, SYSTEM_BOOTSTRAP_ACTOR);

    const conflicting: ValidatorContract = {
      ...original,
      // Same version, wider capabilities: the declaration changed but the
      // version did not, so the registry has no way to tell them apart.
      capabilities: ['READ_INPUT', 'READ_CONTEXT'],
    };
    const outcome = registry.update(
      FAKE_VERSION_CONFLICT_VALIDATOR,
      conflicting,
      SYSTEM_BOOTSTRAP_ACTOR,
    );

    if (outcome.ok) {
      return createValidationOutcome({
        validator: FAKE_VERSION_CONFLICT_VALIDATOR,
        status: 'ACCEPT',
        message: 'registry accepted a conflicting redefinition',
        metadata: { conflictRefused: false },
      });
    }

    return createValidationOutcome({
      validator: FAKE_VERSION_CONFLICT_VALIDATOR,
      status: 'REJECT',
      reasonCode: outcome.code,
      issues: [outcome.message ?? 'update refused'],
      message: outcome.message,
      metadata: { conflictRefused: true, registryCode: outcome.code },
    });
  },
};

/** Same declared metadata as its twin below, different implementation. */
export const fakeFingerprintCollisionValidatorA: ValidatorContract = {
  name: FAKE_FINGERPRINT_COLLISION_VALIDATOR,
  type: 'ADVERSARIAL_FIXTURE',
  deterministic: true,
  mutationPolicy: 'NONE',
  isolation: 'INTERNAL_VALIDATION_ONLY',
  capabilities: ['READ_INPUT'],
  executionMode: 'SYNC_ONLY',
  contractVersion: '1.0.0',
  inputSchema: {
    requiredFields: [],
    requiredAnyOf: ['files'],
    description: 'Adversarial fixture: identical declaration, different body.',
  },
  validate: () =>
    createValidationOutcome({
      validator: FAKE_FINGERPRINT_COLLISION_VALIDATOR,
      status: 'ACCEPT',
      message: 'implementation A',
    }),
};

/** Identical declaration to A, deliberately different body. */
export const fakeFingerprintCollisionValidatorB: ValidatorContract = {
  ...fakeFingerprintCollisionValidatorA,
  validate: () =>
    createValidationOutcome({
      validator: FAKE_FINGERPRINT_COLLISION_VALIDATOR,
      status: 'REJECT',
      reasonCode: 'IMPLEMENTATION_B',
      message: 'implementation B',
    }),
};

export const FAKE_ASYNC_VALIDATOR = 'FakeAsyncValidator';
export const FAKE_DELAYED_ESCAPE_VALIDATOR = 'FakeDelayedEscapeValidator';
export const FAKE_PROMISE_CAPABILITY_VALIDATOR = 'FakePromiseCapabilityValidator';

/** Declares SYNC_ONLY, then returns a promise. */
export const fakeAsyncValidator: ValidatorContract = capabilityFixture(
  FAKE_ASYNC_VALIDATOR,
  'Adversarial fixture: returns a promise despite declaring SYNC_ONLY.',
  () => undefined,
  () =>
    Promise.resolve(
      createValidationOutcome({ validator: FAKE_ASYNC_VALIDATOR, status: 'ACCEPT' }),
    ) as unknown as InternalValidationOutcome,
);

/**
 * Declares SYNC_ONLY, returns promptly, and leaves a timer behind that would
 * touch the filesystem after the capability boundary came down.
 */
export const fakeDelayedEscapeValidator: ValidatorContract = capabilityFixture(
  FAKE_DELAYED_ESCAPE_VALIDATOR,
  'Adversarial fixture: schedules a filesystem read for after its own return.',
  () => {
    setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('fs').readFileSync('package.json', 'utf8');
    }, 10);
  },
);

/** Declares SYNC_ONLY, then hides the filesystem read inside a microtask. */
export const fakePromiseCapabilityValidator: ValidatorContract = capabilityFixture(
  FAKE_PROMISE_CAPABILITY_VALIDATOR,
  'Adversarial fixture: defers a filesystem read into a promise continuation.',
  () => undefined,
  () =>
    Promise.resolve().then(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('fs').readFileSync('package.json', 'utf8');
    }) as unknown as InternalValidationOutcome,
);

/**
 * The honest counterpart: declares READ_INPUT and takes its input from the
 * capability context rather than reaching around it.
 */
export const capabilityRespectingValidator: ValidatorContract = {
  name: CAPABILITY_RESPECTING_VALIDATOR,
  type: 'ADVERSARIAL_FIXTURE',
  deterministic: true,
  mutationPolicy: 'NONE',
  isolation: 'INTERNAL_VALIDATION_ONLY',
  capabilities: ['READ_INPUT'],
  executionMode: 'SYNC_ONLY',
  contractVersion: '1.0.0',
  inputSchema: {
    requiredFields: [],
    requiredAnyOf: ['files'],
    description: 'Reads its input only through the capability context.',
  },
  validate(request, capabilities): InternalValidationOutcome {
    const input = (capabilities?.readInput<Record<string, unknown>>() ??
      (request.input as Record<string, unknown>)) ?? {};
    const files = Array.isArray(input.files) ? input.files : [];
    return createValidationOutcome({
      validator: CAPABILITY_RESPECTING_VALIDATOR,
      status: 'ACCEPT',
      message: `read ${files.length} declared file(s) through the capability context`,
      metadata: { fileCount: files.length, usedCapabilityContext: capabilities !== undefined },
    });
  },
};
