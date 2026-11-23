import {
  InternalValidationErrorCode,
  ValidatorCapabilities,
  ValidatorContract,
  describeValidator,
  freezeValidatorContract,
  validateValidatorContract,
} from '../../domain/internal-validation';
import { checkCapabilityDeclaration } from '../../domain/validator-capability';
import {
  GovernedValidator,
  SYSTEM_BOOTSTRAP_ACTOR,
  SYSTEM_RUNNER_ACTOR,
  ValidatorGovernanceActor,
  ValidatorGovernanceRecord,
  ValidatorLifecycleState,
  ValidatorResolutionSource,
  compareContractVersions,
  computeContractFingerprint,
  isAllowedLifecycleTransition,
  isGovernanceActor,
  isValidContractVersion,
  parseContractVersion,
} from '../../domain/validator-governance';
import { ValidatorAuditEvent, ValidatorAuditLog } from './validator-audit-log';
import { ValidatorExecutionAuditLog } from './validator-execution-audit-log';
import {
  capabilityRespectingValidator,
  fakeAsyncValidator,
  fakeContractDriftValidator,
  fakeDeprecatedValidator,
  fakeDisabledValidator,
  fakeUnverifiedResolverValidator,
  fakeVersionConflictValidator,
  fakeDelayedEscapeValidator,
  fakeFilesystemValidator,
  fakePromiseCapabilityValidator,
  fakeIsolationBreakingValidator,
  fakeMutatingValidator,
  fakeNetworkValidator,
  fakeNonDeterministicValidator,
  fakeProcessValidator,
  fakeWriteValidator,
} from './adversarial-validators';
import { plannerAllowedTargetsValidator } from './planner-allowed-targets-validator';
import { validatorRegistryImmutabilityValidator } from './validator-registry-immutability-validator';
import { validatorResolveExposureAuditValidator } from './validator-resolve-exposure-audit-validator';

export interface ValidatorRegistration {
  readonly ok: boolean;
  readonly code?: InternalValidationErrorCode;
  readonly message?: string;
  /** Fingerprint recorded for an accepted registration or update. */
  readonly fingerprint?: string;
  readonly contractVersion?: string;
}

/** A snapshot of registry governance, in memory and by value. */
export interface ValidatorRegistryState {
  readonly version: 1;
  readonly records: ReadonlyArray<ValidatorGovernanceRecord>;
}

const MISSING_ACTOR: ValidatorRegistration = Object.freeze({
  ok: false,
  code: 'MISSING_GOVERNANCE_ACTOR' as const,
  message: 'MISSING_GOVERNANCE_ACTOR: a governance change must name the actor requesting it',
});

export class ValidationRegistry {
  private readonly validators = new Map<string, ValidatorContract>();
  private readonly governance = new Map<string, ValidatorGovernanceRecord>();

  constructor(
    private readonly auditLog: ValidatorAuditLog = new ValidatorAuditLog(),
    private readonly executionLog: ValidatorExecutionAuditLog = new ValidatorExecutionAuditLog(),
  ) {}

  /**
   * Admits a validator only if its contract holds and its name is free, so a
   * later validator cannot silently shadow an existing safety boundary.
   */
  register(
    validator: ValidatorContract,
    actor: ValidatorGovernanceActor,
    /**
     * How the contract reached the registry. Anything other than the default
     * is recorded as ungoverned and refused at execution time.
     */
    resolutionSource: ValidatorResolutionSource = 'REGISTERED_REGISTRY',
  ): ValidatorRegistration {
    if (!isGovernanceActor(actor)) return MISSING_ACTOR;

    const admission = this.admissionCheck(validator, actor);
    if (admission) return admission;

    const key = this.key(validator.name);
    if (this.validators.has(key)) {
      return this.reject(
        validator,
        'DUPLICATE_VALIDATOR',
        `${validator.name} is already registered`,
        actor,
      );
    }

    return this.store(key, validator, 'REGISTERED', actor, resolutionSource);
  }

  /**
   * Replaces a registered contract with a newer version of itself.
   *
   * The version must advance. Re-publishing the same version with different
   * declared metadata is refused, because a fingerprint is only meaningful if a
   * version identifies exactly one contract.
   */
  update(
    name: string,
    newContract: ValidatorContract,
    actor: ValidatorGovernanceActor,
  ): ValidatorRegistration {
    if (!isGovernanceActor(actor)) return MISSING_ACTOR;

    const key = this.key(name);
    const existing = this.governance.get(key);
    if (!existing) {
      return Object.freeze({
        ok: false,
        code: 'UNKNOWN_VALIDATOR' as const,
        message: `UNKNOWN_VALIDATOR: ${name} is not registered`,
      });
    }

    const admission = this.admissionCheck(newContract, actor);
    if (admission) return admission;

    if (this.key(newContract.name) !== key) {
      return this.reject(
        newContract,
        'INVALID_VALIDATOR_CONTRACT',
        `update target ${name} does not match contract name ${newContract.name}`,
        actor,
      );
    }

    const fingerprint = computeContractFingerprint(newContract);
    const previous = parseContractVersion(existing.contractVersion)!;
    const next = parseContractVersion(newContract.contractVersion)!;
    const ordering = compareContractVersions(next, previous);

    if (ordering === 0) {
      // Same version, same declaration is a harmless no-op; same version with a
      // different declaration is the conflict this rule exists to catch.
      if (fingerprint === existing.fingerprint) {
        return Object.freeze({ ok: true, fingerprint, contractVersion: existing.contractVersion });
      }
      return this.reject(
        newContract,
        'VALIDATOR_VERSION_CONFLICT',
        `${newContract.name} ${newContract.contractVersion} was already registered with a different contract`,
        actor,
      );
    }

    if (ordering < 0) {
      return this.reject(
        newContract,
        'VALIDATOR_VERSION_CONFLICT',
        `${newContract.name} cannot move backwards from ${existing.contractVersion} to ${newContract.contractVersion}`,
        actor,
      );
    }

    return this.store(key, newContract, 'UPDATED', actor);
  }

  /** Contract-shape, capability, and version checks shared by register and update. */
  private admissionCheck(
    validator: ValidatorContract,
    actor: ValidatorGovernanceActor,
  ): ValidatorRegistration | undefined {
    const check = validateValidatorContract(validator);
    if (!check.valid) {
      return this.reject(validator, 'INVALID_VALIDATOR_CONTRACT', check.violations.join('; '), actor);
    }

    // Capability names are checked separately from the contract shape: a
    // contract can be well formed and still ask for something that does not
    // exist or that INTERNAL_VALIDATION never grants.
    const capabilities = checkCapabilityDeclaration(validator.capabilities);
    if (!capabilities.valid) {
      return this.reject(
        validator,
        'INVALID_VALIDATOR_CAPABILITY',
        capabilities.violations.join('; '),
        actor,
      );
    }

    if (!isValidContractVersion(validator.contractVersion)) {
      return this.reject(
        validator,
        'INVALID_VALIDATOR_CONTRACT_VERSION',
        `contractVersion must be semantic x.y.z, got ${String(validator.contractVersion)}`,
        actor,
      );
    }

    return undefined;
  }

  private store(
    key: string,
    validator: ValidatorContract,
    action: 'REGISTERED' | 'UPDATED',
    actor: ValidatorGovernanceActor,
    resolutionSource?: ValidatorResolutionSource,
  ): ValidatorRegistration {
    // The fingerprint records the contract *as presented for admission*, while
    // the frozen copy is what will be handed out later. For an ordinary
    // contract the two are identical. For one that reports different metadata
    // on successive reads they are not, and the runner refuses the mismatch
    // rather than executing a validator the registry never approved.
    const fingerprint = computeContractFingerprint(validator);
    const stored = freezeValidatorContract(validator);

    this.validators.set(key, stored);
    this.governance.set(
      key,
      Object.freeze({
        validatorName: stored.name,
        contractVersion: stored.contractVersion,
        fingerprint,
        // An update keeps the lifecycle state and provenance the validator
        // already had; only a fresh registration decides them.
        state: this.governance.get(key)?.state ?? 'ACTIVE',
        resolutionSource:
          resolutionSource ?? this.governance.get(key)?.resolutionSource ?? 'REGISTERED_REGISTRY',
      }),
    );

    this.auditLog.record({
      validatorName: stored.name,
      action,
      contractVersion: stored.contractVersion,
      fingerprint,
      actor,
    });

    return Object.freeze({ ok: true, fingerprint, contractVersion: stored.contractVersion });
  }

  private reject(
    validator: ValidatorContract,
    code: InternalValidationErrorCode,
    detail: string,
    actor: ValidatorGovernanceActor,
  ): ValidatorRegistration {
    const name = typeof validator?.name === 'string' ? validator.name : '(unknown)';
    const version = typeof validator?.contractVersion === 'string' ? validator.contractVersion : '(none)';
    this.auditLog.record({
      validatorName: name,
      action: 'REJECTED',
      contractVersion: version,
      // A refused contract has no admitted fingerprint; record what it would
      // have been so a rejection can still be traced back to a declaration.
      fingerprint: this.safeFingerprint(validator),
      actor,
      reason: `${code}: ${detail}`,
    });

    return Object.freeze({ ok: false, code, message: `${code}: ${detail}` });
  }

  private safeFingerprint(validator: ValidatorContract): string {
    try {
      return computeContractFingerprint(validator);
    } catch {
      return '(unfingerprintable)';
    }
  }

  /** Marks a validator as on its way out. It still runs, and every run is audited. */
  deprecate(name: string, actor: ValidatorGovernanceActor): ValidatorRegistration {
    if (!isGovernanceActor(actor)) return MISSING_ACTOR;
    return this.transition(name, 'DEPRECATED', 'DEPRECATED', actor);
  }

  /** Takes a validator out of service. Terminal: it cannot be re-enabled. */
  disable(name: string, actor: ValidatorGovernanceActor): ValidatorRegistration {
    if (!isGovernanceActor(actor)) return MISSING_ACTOR;
    return this.transition(name, 'DISABLED', 'DISABLED', actor);
  }

  /** Returns a deprecated validator to normal service. */
  enable(name: string, actor: ValidatorGovernanceActor): ValidatorRegistration {
    if (!isGovernanceActor(actor)) return MISSING_ACTOR;
    return this.transition(name, 'ACTIVE', 'ENABLED', actor);
  }

  private transition(
    name: string,
    to: ValidatorLifecycleState,
    action: 'DEPRECATED' | 'ENABLED' | 'DISABLED',
    actor: ValidatorGovernanceActor,
  ): ValidatorRegistration {
    const key = this.key(name);
    const record = this.governance.get(key) ?? this.governance.get(key.replace(/validator$/, ''));
    if (!record) {
      return Object.freeze({
        ok: false,
        code: 'UNKNOWN_VALIDATOR' as const,
        message: `UNKNOWN_VALIDATOR: ${name} is not registered`,
      });
    }

    if (!isAllowedLifecycleTransition(record.state, to)) {
      const detail = `${record.validatorName} cannot move from ${record.state} to ${to}`;
      this.auditLog.record({
        validatorName: record.validatorName,
        action: 'REJECTED',
        contractVersion: record.contractVersion,
        fingerprint: record.fingerprint,
        actor,
        reason: `INVALID_VALIDATOR_STATE_TRANSITION: ${detail}`,
      });
      return Object.freeze({
        ok: false,
        code: 'INVALID_VALIDATOR_STATE_TRANSITION' as const,
        message: `INVALID_VALIDATOR_STATE_TRANSITION: ${detail}`,
      });
    }

    const storedKey = this.governance.has(key) ? key : key.replace(/validator$/, '');
    this.governance.set(storedKey, Object.freeze({ ...record, state: to }));
    this.auditLog.record({
      validatorName: record.validatorName,
      action,
      contractVersion: record.contractVersion,
      fingerprint: record.fingerprint,
      actor,
    });

    return Object.freeze({
      ok: true,
      fingerprint: record.fingerprint,
      contractVersion: record.contractVersion,
    });
  }

  /**
   * Records that a deprecated validator was allowed to run.
   *
   * Called by the runner rather than by the registry itself, because the
   * registry does not execute anything.
   */
  noteDeprecatedExecution(
    record: ValidatorGovernanceRecord,
    actor: ValidatorGovernanceActor = SYSTEM_RUNNER_ACTOR,
  ): void {
    this.auditLog.record({
      validatorName: record.validatorName,
      action: 'EXECUTED_DEPRECATED',
      contractVersion: record.contractVersion,
      fingerprint: record.fingerprint,
      actor,
    });
  }

  /** Governance recorded for a validator at admission time. */
  governanceFor(name: string): ValidatorGovernanceRecord | undefined {
    const key = this.key(name);
    return this.governance.get(key) ?? this.governance.get(key.replace(/validator$/, ''));
  }

  /**
   * Resolves a validator together with the governance it was admitted under, so
   * a caller can check what it got against what was recorded.
   */
  resolveGoverned(name: string): GovernedValidator | undefined {
    const validator = this.resolve(name);
    const record = this.governanceFor(name);
    if (!validator || !record) return undefined;
    return Object.freeze({
      validator,
      fingerprint: record.fingerprint,
      contractVersion: record.contractVersion,
    });
  }

  auditHistory(): ReadonlyArray<ValidatorAuditEvent> {
    return this.auditLog.history();
  }

  /** Where execution evidence is written. Handed to the runner, not to validators. */
  executionAuditLog(): ValidatorExecutionAuditLog {
    return this.executionLog;
  }

  /**
   * A transferable copy of everything the registry governs, minus the code.
   *
   * This is the whole of "persistence" here: a plain object a caller can hold
   * and hand back. Nothing is written anywhere.
   */
  exportState(): ValidatorRegistryState {
    return Object.freeze({
      version: 1 as const,
      records: Object.freeze(
        Array.from(this.governance.values(), record => Object.freeze({ ...record })),
      ),
    });
  }

  /**
   * Restores lifecycle state onto validators this registry already holds.
   *
   * Imported state is treated as untrusted: a record whose fingerprint does not
   * match the contract currently registered under that name describes a
   * different contract, and applying its lifecycle would attach decisions made
   * about one validator to another. Nothing is applied unless every record
   * checks out, so a rejected import leaves the registry as it was.
   */
  importState(state: ValidatorRegistryState, actor: ValidatorGovernanceActor): ValidatorRegistration {
    if (!isGovernanceActor(actor)) return MISSING_ACTOR;

    const records = state?.records;
    if (!Array.isArray(records)) {
      return Object.freeze({
        ok: false,
        code: 'INVALID_VALIDATOR_CONTRACT' as const,
        message: 'INVALID_VALIDATOR_CONTRACT: imported state has no governance records',
      });
    }

    const pending: Array<{ key: string; record: ValidatorGovernanceRecord }> = [];

    for (const record of records) {
      const key = this.key(record.validatorName);
      const current = this.governance.get(key);
      if (!current) continue; // Nothing registered under that name; nothing to restore onto.

      if (!isValidContractVersion(record.contractVersion)) {
        return Object.freeze({
          ok: false,
          code: 'IMPORT_INVALID_VERSION' as const,
          message: `IMPORT_INVALID_VERSION: ${record.validatorName} carries version ${String(record.contractVersion)}`,
        });
      }

      if (record.fingerprint !== current.fingerprint) {
        return Object.freeze({
          ok: false,
          code: 'IMPORT_CONTRACT_DRIFT' as const,
          message: `IMPORT_CONTRACT_DRIFT: ${record.validatorName} fingerprint does not match the registered contract`,
        });
      }

      pending.push({ key, record });
    }

    for (const { key, record } of pending) {
      const current = this.governance.get(key)!;
      this.governance.set(key, Object.freeze({ ...current, state: record.state }));
      this.auditLog.record({
        validatorName: current.validatorName,
        action:
          record.state === 'DISABLED' ? 'DISABLED' : record.state === 'DEPRECATED' ? 'DEPRECATED' : 'ENABLED',
        contractVersion: current.contractVersion,
        fingerprint: current.fingerprint,
        actor,
        reason: 'restored from imported governance state',
      });
    }

    return Object.freeze({ ok: true });
  }

  auditHistoryFor(name: string): ReadonlyArray<ValidatorAuditEvent> {
    return this.auditLog.historyFor(name);
  }

  resolve(name: string): ValidatorContract | undefined {
    if (!name || typeof name !== 'string') return undefined;
    const key = this.key(name);
    // Callers name validators either bare ("PlannerAllowedTargets") or with the
    // class suffix ("PlannerAllowedTargetsValidator"). Both resolve to the same one.
    return this.validators.get(key) ?? this.validators.get(key.replace(/validator$/, ''));
  }

  names(): ReadonlyArray<string> {
    return Object.freeze(Array.from(this.validators.values(), validator => validator.name).sort());
  }

  capabilities(): ReadonlyArray<ValidatorCapabilities> {
    return Object.freeze(
      Array.from(this.validators.values(), describeValidator)
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  capabilitiesOf(name: string): ValidatorCapabilities | undefined {
    const validator = this.resolve(name);
    return validator ? describeValidator(validator) : undefined;
  }

  private key(name: string): string {
    return name.trim().toLowerCase();
  }
}

export const validationRegistry = new ValidationRegistry();

export function registerValidator(
  validator: ValidatorContract,
  actor: ValidatorGovernanceActor = SYSTEM_BOOTSTRAP_ACTOR,
): ValidatorRegistration {
  return validationRegistry.register(validator, actor);
}

export function resolveValidator(name: string): ValidatorContract | undefined {
  return validationRegistry.resolve(name);
}

export function registeredValidatorNames(): ReadonlyArray<string> {
  return validationRegistry.names();
}

export function registeredValidatorCapabilities(): ReadonlyArray<ValidatorCapabilities> {
  return validationRegistry.capabilities();
}

registerValidator(plannerAllowedTargetsValidator);
registerValidator(validatorRegistryImmutabilityValidator);
registerValidator(validatorResolveExposureAuditValidator);

// Fixtures that declare a contract they then break. They are registered so the
// execution guard can be exercised through the real INTERNAL_VALIDATION path;
// the guard denies every one of them at runtime.
registerValidator(fakeNonDeterministicValidator);
registerValidator(fakeMutatingValidator);
registerValidator(fakeIsolationBreakingValidator);
registerValidator(fakeFilesystemValidator);
registerValidator(fakeWriteValidator);
registerValidator(fakeProcessValidator);
registerValidator(fakeNetworkValidator);
registerValidator(capabilityRespectingValidator);
registerValidator(fakeAsyncValidator);
registerValidator(fakeDelayedEscapeValidator);
registerValidator(fakePromiseCapabilityValidator);
registerValidator(fakeContractDriftValidator);
registerValidator(fakeVersionConflictValidator);

// Lifecycle fixtures: valid contracts placed into the states the runner has to
// respect, so each state can be exercised through the real execution path.
registerValidator(fakeDisabledValidator);
validationRegistry.disable(fakeDisabledValidator.name, SYSTEM_BOOTSTRAP_ACTOR);

registerValidator(fakeDeprecatedValidator);
validationRegistry.deprecate(fakeDeprecatedValidator.name, SYSTEM_BOOTSTRAP_ACTOR);

validationRegistry.register(
  fakeUnverifiedResolverValidator,
  SYSTEM_BOOTSTRAP_ACTOR,
  'UNVERIFIED_RESOLVER',
);
