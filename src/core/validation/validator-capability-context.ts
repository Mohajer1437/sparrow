import { InternalValidationRequest, ValidatorCapabilities } from '../../domain/internal-validation';
import {
  ValidatorCapability,
  ValidatorCapabilityContext,
  ValidatorCapabilityPolicy,
  policyAllows,
} from '../../domain/validator-capability';

export type { ValidatorCapabilityContext } from '../../domain/validator-capability';

/** Thrown when a validator reaches for a capability it did not declare. */
export class CapabilityViolationError extends Error {
  constructor(
    readonly validator: string,
    readonly requestedCapability: ValidatorCapability,
    readonly allowedCapabilities: ReadonlyArray<ValidatorCapability>,
    detail?: string,
  ) {
    super(
      `VALIDATOR_CAPABILITY_VIOLATION: ${validator} requested ${requestedCapability}` +
        `${detail ? ` (${detail})` : ''}; allowed: ${allowedCapabilities.join(', ') || 'none'}`,
    );
    this.name = 'CapabilityViolationError';
  }
}

/** Detached, deeply frozen copy so a read cannot become a write. */
function frozenCopy<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(entry => frozenCopy(entry))) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = frozenCopy(entry);
  }
  return Object.freeze(out) as unknown as T;
}

export interface CapabilityContextOptions {
  readonly validator: string;
  readonly metadata: ValidatorCapabilities;
  readonly policy: ValidatorCapabilityPolicy;
  readonly request: InternalValidationRequest;
  /** Records a denied request so the guard can report it after execution. */
  readonly onViolation: (capability: ValidatorCapability, detail: string) => void;
}

export function createValidatorCapabilityContext(
  options: CapabilityContextOptions,
): ValidatorCapabilityContext {
  const { validator, metadata, policy, request, onViolation } = options;

  const require = (capability: ValidatorCapability, detail: string): void => {
    if (policyAllows(policy, capability)) return;
    onViolation(capability, detail);
    throw new CapabilityViolationError(validator, capability, policy.allowed, detail);
  };

  return Object.freeze({
    readInput<T = unknown>(): T {
      require('READ_INPUT', 'readInput()');
      return frozenCopy(request.input) as T;
    },
    readContext<T = unknown>(): T {
      require('READ_CONTEXT', 'readContext()');
      return frozenCopy(request.context) as T;
    },
    readMetadata(): ValidatorCapabilities {
      require('READ_VALIDATOR_METADATA', 'readMetadata()');
      return frozenCopy(metadata);
    },
    granted(): ReadonlyArray<ValidatorCapability> {
      return policy.allowed;
    },
    has(capability: ValidatorCapability): boolean {
      return policyAllows(policy, capability);
    },
  });
}
