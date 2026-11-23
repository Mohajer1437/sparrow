/**
 * Internal validation contract.
 *
 * An internal validation run calls a single validator directly so reliability
 * and security boundaries can be exercised in isolation. It deliberately has no
 * planner, provider, executor, reviewer, or verification stage.
 *
 * Every validator declares its own guarantees through a ValidatorContract. The
 * registry refuses to register a contract that does not hold, and the runner
 * re-checks before dispatching, so adding a validator cannot quietly weaken the
 * isolation the mode promises.
 */

import type { ValidatorCapability, ValidatorCapabilityContext } from './validator-capability';

export type InternalValidationStatus = 'ACCEPT' | 'REJECT' | 'ERROR';

/** Retained name for the status field's original spelling. */
export type InternalValidationResult = InternalValidationStatus;

export const INTERNAL_VALIDATION_ERROR_CODES = [
  'INVALID_VALIDATION_REQUEST',
  'UNKNOWN_VALIDATOR',
  'INVALID_VALIDATOR_CONTRACT',
  'DUPLICATE_VALIDATOR',
  // Raised by the execution guard when a validator breaks a guarantee it
  // declared. Registration only checks what a contract claims; these are the
  // codes for what it actually does at runtime.
  'VALIDATOR_NON_DETERMINISTIC',
  'VALIDATOR_MUTATION_VIOLATION',
  'VALIDATOR_ISOLATION_VIOLATION',
  'VALIDATOR_EXECUTION_ERROR',
  'VALIDATOR_CAPABILITY_VIOLATION',
  'INVALID_VALIDATOR_CAPABILITY',
  'VALIDATOR_ASYNC_ESCAPE',
  'INVALID_VALIDATOR_CONTRACT_VERSION',
  'VALIDATOR_CONTRACT_DRIFT',
  'VALIDATOR_VERSION_CONFLICT',
  'UNVERIFIED_VALIDATOR_SOURCE',
  'VALIDATOR_DISABLED',
  'INVALID_VALIDATOR_STATE_TRANSITION',
  'MISSING_GOVERNANCE_ACTOR',
  'IMPORT_CONTRACT_DRIFT',
  'IMPORT_INVALID_VERSION',
] as const;

/**
 * Whether a validator is allowed to continue working after `validate` returns.
 *
 * Capability interception is process-wide while installed, so it is only
 * truthful for a body that finishes before the guard restores the entry points.
 * A validator that schedules work for later would run that work unguarded,
 * which is why INTERNAL_VALIDATION admits SYNC_ONLY contracts alone.
 */
export type ValidatorExecutionMode = 'SYNC_ONLY' | 'ASYNC_ALLOWED';

export type InternalValidationErrorCode = (typeof INTERNAL_VALIDATION_ERROR_CODES)[number];

/** A validator may only read. WRITE exists so an unsafe contract is nameable. */
export type ValidatorMutationPolicy = 'NONE' | 'WRITE';

/** Where a validator is allowed to run. */
export type ValidatorIsolation = 'INTERNAL_VALIDATION_ONLY' | 'SHARED';

export interface InternalValidationRequest {
  readonly validator: string;
  readonly input: unknown;
  /** Paths the validator may treat as authorized execution targets. */
  readonly authority?: unknown;
  /** Paths visible for reasoning only. Visibility never grants authority. */
  readonly context?: unknown;
}

/** What a validator expects to find on the request input. */
export interface ValidatorInputSchema {
  /** Fields that must all be present. */
  readonly requiredFields: ReadonlyArray<string>;
  /** Fields of which at least one must be present, when non-empty. */
  readonly requiredAnyOf?: ReadonlyArray<string>;
  readonly optionalFields?: ReadonlyArray<string>;
  readonly description?: string;
}

export interface InternalValidationOutcome {
  readonly validator: string;
  readonly status: InternalValidationStatus;
  /** Original spelling of `status`, kept so existing consumers keep working. */
  readonly result: InternalValidationStatus;
  readonly reasonCode?: string;
  readonly message?: string;
  readonly rejectedTargets: ReadonlyArray<string>;
  readonly issues: ReadonlyArray<string>;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Declared capabilities of a validator, without its implementation. */
export interface ValidatorCapabilities {
  readonly name: string;
  readonly type: string;
  readonly deterministic: boolean;
  readonly mutationPolicy: ValidatorMutationPolicy;
  readonly isolation: ValidatorIsolation;
  readonly inputSchema: ValidatorInputSchema;
  /** Everything the validator is permitted to do. Deny-by-default otherwise. */
  readonly capabilities: ReadonlyArray<ValidatorCapability>;
  /** Whether the validator may outlive its own `validate` call. */
  readonly executionMode: ValidatorExecutionMode;
  /** Semantic version of the declared contract, as `x.y.z`. */
  readonly contractVersion: string;
}

export interface ValidatorContract extends ValidatorCapabilities {
  /**
   * The capability context is the validator's only sanctioned route to data
   * beyond its request. It is optional in the signature so a purely
   * request-reading validator need not accept it.
   */
  validate(
    request: InternalValidationRequest,
    capabilities?: ValidatorCapabilityContext,
  ): InternalValidationOutcome;
}

/** Retained name for the validator interface. */
export type InternalValidator = ValidatorContract;

export interface ValidatorContractCheck {
  readonly valid: boolean;
  readonly violations: ReadonlyArray<string>;
}

/**
 * Checks that a candidate declares the guarantees INTERNAL_VALIDATION depends
 * on. A validator that may mutate, may run outside the mode, or does not
 * promise determinism is not admissible.
 */
export function validateValidatorContract(candidate: unknown): ValidatorContractCheck {
  const violations: string[] = [];

  if (candidate === null || typeof candidate !== 'object') {
    return Object.freeze({ valid: false, violations: Object.freeze(['validator must be an object']) });
  }
  const raw = candidate as Partial<ValidatorContract>;

  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
    violations.push('missing name');
  }
  if (typeof raw.type !== 'string' || raw.type.trim().length === 0) {
    violations.push('missing type');
  }
  if (raw.deterministic !== true) {
    violations.push('deterministic must be true');
  }
  if (raw.mutationPolicy !== 'NONE') {
    violations.push(`mutationPolicy must be NONE, got ${String(raw.mutationPolicy)}`);
  }
  if (raw.isolation !== 'INTERNAL_VALIDATION_ONLY') {
    violations.push(`isolation must be INTERNAL_VALIDATION_ONLY, got ${String(raw.isolation)}`);
  }
  if (raw.inputSchema === null || typeof raw.inputSchema !== 'object' || !Array.isArray(raw.inputSchema.requiredFields)) {
    violations.push('inputSchema must declare requiredFields');
  }
  if (typeof raw.validate !== 'function') {
    violations.push('validate must be a function');
  }
  // Capabilities are deny-by-default, so an absent declaration is not an empty
  // grant — it is an unstated contract, and the registry refuses it.
  if (!Array.isArray(raw.capabilities)) {
    violations.push('capabilities must be declared as an array');
  }
  // An absent execution mode is not an implicit SYNC_ONLY. The capability
  // boundary is only honest for a synchronous body, so the contract has to say
  // so out loud before the mode will run it.
  if (raw.executionMode !== 'SYNC_ONLY' && raw.executionMode !== 'ASYNC_ALLOWED') {
    violations.push(`executionMode must be SYNC_ONLY or ASYNC_ALLOWED, got ${String(raw.executionMode)}`);
  } else if (raw.isolation === 'INTERNAL_VALIDATION_ONLY' && raw.executionMode !== 'SYNC_ONLY') {
    violations.push('executionMode must be SYNC_ONLY under INTERNAL_VALIDATION_ONLY isolation');
  }

  return Object.freeze({ valid: violations.length === 0, violations: Object.freeze(violations) });
}

function freezeInputSchema(schema: ValidatorInputSchema): ValidatorInputSchema {
  return Object.freeze({
    requiredFields: Object.freeze([...schema.requiredFields]),
    requiredAnyOf: schema.requiredAnyOf ? Object.freeze([...schema.requiredAnyOf]) : undefined,
    optionalFields: schema.optionalFields ? Object.freeze([...schema.optionalFields]) : undefined,
    description: schema.description,
  });
}

/**
 * Detaches a contract from the object the caller handed over, so later edits to
 * that object cannot reach registered state, and freezes it through the nested
 * schema arrays so a holder of the contract cannot edit it either.
 */
const DECLARED_CONTRACT_KEYS: ReadonlyArray<string> = Object.freeze([
  'name',
  'type',
  'deterministic',
  'mutationPolicy',
  'isolation',
  'inputSchema',
  'capabilities',
  'executionMode',
  'contractVersion',
  'validate',
]);

/** Detached, deeply frozen copy of an arbitrary value. */
function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(entry => freezeDeep(entry))) as unknown as T;
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    copy[key] = typeof entry === 'function' ? entry : freezeDeep(entry);
  }
  return Object.freeze(copy) as unknown as T;
}

export function freezeValidatorContract(contract: ValidatorContract): ValidatorContract {
  const validate = contract.validate;
  const view = {
    name: contract.name,
    type: contract.type,
    deterministic: contract.deterministic,
    mutationPolicy: contract.mutationPolicy,
    isolation: contract.isolation,
    inputSchema: freezeInputSchema(contract.inputSchema),
    capabilities: Object.freeze([...(contract.capabilities ?? [])]),
    executionMode: contract.executionMode,
    contractVersion: contract.contractVersion,
    // Bound to the frozen view, not to the caller's object, so a validator that
    // reads its own metadata at call time cannot observe a later mutation.
    validate(
      request: InternalValidationRequest,
      capabilities?: ValidatorCapabilityContext,
    ): InternalValidationOutcome {
      return validate.call(view, request, capabilities);
    },
  } as ValidatorContract & Record<string, unknown>;

  // Anything else the validator carries is preserved, frozen, rather than
  // dropped: the execution guard inspects those properties to decide whether a
  // validator is holding a dependency its isolation contract forbids.
  for (const [key, entry] of Object.entries(contract as unknown as Record<string, unknown>)) {
    if (DECLARED_CONTRACT_KEYS.includes(key)) continue;
    view[key] = typeof entry === 'function' ? entry : freezeDeep(entry);
  }

  return Object.freeze(view);
}

export function describeValidator(contract: ValidatorContract): ValidatorCapabilities {
  return Object.freeze({
    name: contract.name,
    type: contract.type,
    deterministic: contract.deterministic,
    mutationPolicy: contract.mutationPolicy,
    isolation: contract.isolation,
    inputSchema: freezeInputSchema(contract.inputSchema),
    capabilities: Object.freeze([...(contract.capabilities ?? [])]),
    executionMode: contract.executionMode,
    contractVersion: contract.contractVersion,
  });
}

export function isInternalValidationRequest(value: unknown): value is InternalValidationRequest {
  if (value === null || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.validator === 'string' && raw.validator.trim().length > 0 && 'input' in raw;
}

export interface ValidationOutcomeInput {
  readonly validator: string;
  readonly status: InternalValidationStatus;
  readonly reasonCode?: string;
  readonly message?: string;
  readonly rejectedTargets?: ReadonlyArray<string>;
  readonly issues?: ReadonlyArray<string>;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Single construction point so every validator answers in the same shape. */
export function createValidationOutcome(input: ValidationOutcomeInput): InternalValidationOutcome {
  const rejectedTargets = Object.freeze([...(input.rejectedTargets ?? [])]);
  const issues = Object.freeze([...(input.issues ?? [])]);
  return Object.freeze({
    validator: input.validator,
    status: input.status,
    result: input.status,
    reasonCode: input.reasonCode,
    message: input.message,
    rejectedTargets,
    issues,
    details: input.details ? Object.freeze({ ...input.details }) : Object.freeze({ rejectedTargets }),
    metadata: input.metadata ? Object.freeze({ ...input.metadata }) : undefined,
  });
}
