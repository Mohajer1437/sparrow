import {
  InternalValidationOutcome,
  InternalValidationRequest,
  ValidatorContract,
  createValidationOutcome,
  isInternalValidationRequest,
  validateValidatorContract,
} from '../../domain/internal-validation';
import {
  SYSTEM_RUNNER_ACTOR,
  ValidatorExecutionResult,
  ValidatorGovernanceRecord,
  ValidatorResolutionSource,
  computeContractFingerprint,
} from '../../domain/validator-governance';
import { ValidationRegistry, validationRegistry } from './validation-registry';
import { validateWithContractGuard } from './validator-contract-guard';
import { ValidatorExecutionAuditLog } from './validator-execution-audit-log';

/**
 * Refusals decided before the validator body was entered.
 *
 * Nothing of the validator ran, so the run is recorded as REJECTED rather than
 * FAILED: the distinction is between a validator that misbehaved and one that
 * was never given the chance.
 */
const PRE_DISPATCH_REFUSALS: ReadonlySet<string> = new Set([
  'UNKNOWN_VALIDATOR',
  'UNVERIFIED_VALIDATOR_SOURCE',
  'VALIDATOR_CONTRACT_DRIFT',
  'VALIDATOR_DISABLED',
  'INVALID_VALIDATOR_CONTRACT',
  'INVALID_VALIDATION_REQUEST',
]);

export type ValidatorResolver = (name: string) => ValidatorContract | undefined;

function error(
  validator: string,
  reasonCode: string,
  detail: string,
  issues: ReadonlyArray<string> = [detail],
): InternalValidationOutcome {
  return createValidationOutcome({
    validator,
    status: 'ERROR',
    reasonCode,
    issues,
    message: `${reasonCode}: ${detail}`,
  });
}

/**
 * Entry point for the internal validation execution path.
 *
 * The runner resolves a validator by name and calls it directly. Nothing in
 * this path touches the planner, an LLM provider, the executor, the reviewer,
 * or the verification pipeline. Contract guarantees are re-checked here rather
 * than trusted from registration time, so a validator injected through any
 * other route is held to the same isolation rules.
 */
export interface InternalValidationRunnerOptions {
  /**
   * Permits execution from a bare resolver, which has no admission record and
   * therefore no fingerprint to verify. Test-only: nothing in the shipped
   * pipeline constructs a runner this way.
   */
  readonly allowUnverifiedSource?: boolean;
}

export class InternalValidationRunner {
  private readonly resolve: ValidatorResolver;
  private readonly registry?: ValidationRegistry;
  /** How validators reach this runner, decided once at construction. */
  private readonly resolutionSource: ValidatorResolutionSource;
  private readonly allowUnverifiedSource: boolean;

  constructor(
    resolver?: ValidatorResolver | ValidationRegistry,
    options: InternalValidationRunnerOptions = {},
  ) {
    this.allowUnverifiedSource = options.allowUnverifiedSource === true;

    if (typeof resolver === 'function') {
      // A bare function hands back whatever it likes. There is no admission
      // record behind it, so nothing about the contract can be verified.
      this.resolve = resolver;
      this.resolutionSource = 'UNVERIFIED_RESOLVER';
    } else {
      const registry = resolver ?? validationRegistry;
      this.registry = registry;
      this.resolve = (name: string) => registry.resolve(name);
      this.resolutionSource = 'REGISTERED_REGISTRY';
    }
  }

  private governanceFor(name: string): ValidatorGovernanceRecord | undefined {
    return this.registry?.governanceFor(name);
  }

  /** Where this runner writes evidence. Absent for a bare-resolver runner. */
  private get executionLog(): ValidatorExecutionAuditLog | undefined {
    return this.registry?.executionAuditLog();
  }

  /** The execution history for validators run through this runner. */
  executionHistory() {
    return this.executionLog?.history() ?? [];
  }

  /**
   * Runs a validator and records what happened.
   *
   * Evidence is written for every dispatch, including the ones refused before
   * the validator body was reached, because "it was never allowed to run" is
   * the fact most worth being able to prove later.
   */
  run(request: InternalValidationRequest): InternalValidationOutcome {
    const startedAt = this.executionLog?.now() ?? new Date();
    const outcome = this.execute(request);
    this.recordEvidence(request, outcome, startedAt);
    return outcome;
  }

  private recordEvidence(
    request: InternalValidationRequest,
    outcome: InternalValidationOutcome,
    startedAt: Date,
  ): void {
    const log = this.executionLog;
    if (!log) return;

    const name =
      typeof request?.validator === 'string' && request.validator.trim().length > 0
        ? request.validator
        : '(unknown)';
    const record = this.governanceFor(name);
    const validator = this.safeResolve(name);

    const reasonCode = outcome.reasonCode ?? undefined;
    const result: ValidatorExecutionResult =
      outcome.status === 'ACCEPT'
        ? 'SUCCESS'
        : reasonCode && PRE_DISPATCH_REFUSALS.has(reasonCode)
          ? 'REJECTED'
          : 'FAILED';

    log.record({
      validatorName: outcome.validator || name,
      fingerprint: record?.fingerprint ?? this.safeFingerprint(validator),
      contractVersion: record?.contractVersion ?? validator?.contractVersion ?? '(unknown)',
      lifecycleState: record?.state ?? 'ACTIVE',
      startedAt,
      completedAt: log.now(),
      result,
      errorCode: result === 'SUCCESS' ? undefined : reasonCode,
      actor: SYSTEM_RUNNER_ACTOR,
    });
  }

  private safeResolve(name: string): ValidatorContract | undefined {
    try {
      return this.resolve(name);
    } catch {
      return undefined;
    }
  }

  private safeFingerprint(validator: ValidatorContract | undefined): string {
    if (!validator) return '(unresolved)';
    try {
      return computeContractFingerprint(validator);
    } catch {
      return '(unfingerprintable)';
    }
  }

  private execute(request: InternalValidationRequest): InternalValidationOutcome {
    if (!isInternalValidationRequest(request)) {
      return error(
        '(unknown)',
        'INVALID_VALIDATION_REQUEST',
        'request must declare a validator name and an input',
      );
    }

    // Provenance is settled before anything about the contract is trusted: an
    // ungoverned validator is refused whatever it claims about itself.
    if (this.resolutionSource === 'UNVERIFIED_RESOLVER' && !this.allowUnverifiedSource) {
      return error(
        request.validator,
        'UNVERIFIED_VALIDATOR_SOURCE',
        `${request.validator} was resolved through an unverified resolver with no governance record`,
      );
    }

    const validator = this.resolve(request.validator);
    if (!validator) {
      return error('(unknown)', 'UNKNOWN_VALIDATOR', request.validator);
    }

    const check = validateValidatorContract(validator);
    if (!check.valid) {
      return error(
        typeof validator.name === 'string' && validator.name.trim().length > 0
          ? validator.name
          : request.validator,
        'INVALID_VALIDATOR_CONTRACT',
        check.violations.join('; '),
        check.violations,
      );
    }

    // The contract handed back must be the one that was admitted. A mismatch
    // means the declaration changed after the registry approved it, and the
    // validator does not run.
    const record = this.governanceFor(request.validator);
    if (record) {
      if (record.resolutionSource !== 'REGISTERED_REGISTRY' && !this.allowUnverifiedSource) {
        return error(
          validator.name,
          'UNVERIFIED_VALIDATOR_SOURCE',
          `${validator.name} was admitted from ${record.resolutionSource} and cannot be verified`,
        );
      }

      const fingerprint = computeContractFingerprint(validator);
      if (fingerprint !== record.fingerprint) {
        return error(
          validator.name,
          'VALIDATOR_CONTRACT_DRIFT',
          `${validator.name} resolved with fingerprint ${fingerprint} but was registered as ${record.fingerprint}`,
        );
      }

      if (record.state === 'DISABLED') {
        return error(
          validator.name,
          'VALIDATOR_DISABLED',
          `${validator.name} has been taken out of service`,
        );
      }

      if (record.state === 'DEPRECATED') {
        // Deprecated validators still run, so callers are not broken without
        // warning, but the run is on the record.
        this.registry?.noteDeprecatedExecution(record);
      }
    }

    const schemaViolations = this.checkInputSchema(validator, request);
    if (schemaViolations.length > 0) {
      return error(
        validator.name,
        'INVALID_VALIDATION_REQUEST',
        schemaViolations.join('; '),
        schemaViolations,
      );
    }

    // Declared guarantees are enforced against actual behaviour here rather
    // than trusted, so a validator that lies about determinism, mutation, or
    // isolation is stopped instead of being believed.
    return validateWithContractGuard(validator, request);
  }

  private checkInputSchema(
    validator: ValidatorContract,
    request: InternalValidationRequest,
  ): string[] {
    const violations: string[] = [];
    const input = request.input;
    if (input === null || typeof input !== 'object') {
      return ['input must be an object'];
    }
    const payload = input as Record<string, unknown>;

    for (const field of validator.inputSchema.requiredFields) {
      if (!(field in payload)) violations.push(`input is missing required field: ${field}`);
    }

    const anyOf = validator.inputSchema.requiredAnyOf ?? [];
    if (anyOf.length > 0 && !anyOf.some(field => field in payload)) {
      violations.push(`input must declare at least one of: ${anyOf.join(', ')}`);
    }

    return violations;
  }
}

export const internalValidationRunner = new InternalValidationRunner();
