/**
 * Capability model for internal validators.
 *
 * Isolation enforcement in the contract guard is name-based: it can see a
 * dependency handed *to* a validator, but not one the validator reaches for on
 * its own through a module import. Capabilities close the official access
 * paths. A validator declares what it needs, receives a context exposing only
 * that, and the ambient routes it might otherwise use are intercepted for the
 * duration of its execution.
 *
 * This is a boundary, not a sandbox. See the capability guard for what it can
 * and cannot observe.
 */

import type { ValidatorCapabilities } from './internal-validation';

export const VALIDATOR_CAPABILITIES = [
  /** Read the request input payload. */
  'READ_INPUT',
  /** Read the read-only context paths on the request. */
  'READ_CONTEXT',
  /** Read the validator's own declared contract metadata. */
  'READ_VALIDATOR_METADATA',
  /** Explicit statement that the validator writes nothing anywhere. */
  'WRITE_NONE',
  'FILESYSTEM_READ',
  'FILESYSTEM_WRITE',
  'PROCESS_EXECUTION',
  'NETWORK_ACCESS',
  'MODEL_ACCESS',
] as const;

export type ValidatorCapability = (typeof VALIDATOR_CAPABILITIES)[number];

/**
 * Capabilities an INTERNAL_VALIDATION validator may never hold, whatever it
 * declares. The mode promises no filesystem, process, network, or model access;
 * a contract that asks for one of these is refused at registration rather than
 * granted and then policed.
 */
export const CAPABILITIES_FORBIDDEN_IN_INTERNAL_VALIDATION: ReadonlyArray<ValidatorCapability> = Object.freeze([
  'FILESYSTEM_READ',
  'FILESYSTEM_WRITE',
  'PROCESS_EXECUTION',
  'NETWORK_ACCESS',
  'MODEL_ACCESS',
]);

export interface ValidatorCapabilityPolicy {
  readonly allowed: ReadonlyArray<ValidatorCapability>;
  /** Nothing is available unless it appears in `allowed`. */
  readonly denyByDefault: boolean;
}

/** Deny-by-default with nothing granted. Every policy starts here. */
export const DEFAULT_CAPABILITY_POLICY: ValidatorCapabilityPolicy = Object.freeze({
  allowed: Object.freeze([] as ValidatorCapability[]),
  denyByDefault: true,
});

export function isValidatorCapability(value: unknown): value is ValidatorCapability {
  return typeof value === 'string' && (VALIDATOR_CAPABILITIES as ReadonlyArray<string>).includes(value);
}

export interface CapabilityDeclarationCheck {
  readonly valid: boolean;
  readonly unknownCapabilities: ReadonlyArray<string>;
  readonly forbiddenCapabilities: ReadonlyArray<ValidatorCapability>;
  readonly violations: ReadonlyArray<string>;
}

/**
 * Checks a declared capability list before it is ever granted: it must exist,
 * be an array, name only known capabilities, and stay inside what
 * INTERNAL_VALIDATION allows.
 */
export function checkCapabilityDeclaration(value: unknown): CapabilityDeclarationCheck {
  const violations: string[] = [];
  const unknown: string[] = [];
  const forbidden: ValidatorCapability[] = [];

  if (!Array.isArray(value)) {
    return Object.freeze({
      valid: false,
      unknownCapabilities: Object.freeze([]),
      forbiddenCapabilities: Object.freeze([]),
      violations: Object.freeze(['capabilities must be declared as an array']),
    });
  }

  for (const entry of value) {
    if (!isValidatorCapability(entry)) {
      unknown.push(String(entry));
      continue;
    }
    if (CAPABILITIES_FORBIDDEN_IN_INTERNAL_VALIDATION.includes(entry)) forbidden.push(entry);
  }

  for (const entry of unknown) violations.push(`unknown capability: ${entry}`);
  for (const entry of forbidden) {
    violations.push(`capability not permitted under INTERNAL_VALIDATION: ${entry}`);
  }

  return Object.freeze({
    valid: violations.length === 0,
    unknownCapabilities: Object.freeze(unknown),
    forbiddenCapabilities: Object.freeze(forbidden),
    violations: Object.freeze(violations),
  });
}

/** Deny-by-default policy granting exactly what the contract declared. */
export function capabilityPolicyFor(
  capabilities: ReadonlyArray<ValidatorCapability>,
): ValidatorCapabilityPolicy {
  return Object.freeze({
    allowed: Object.freeze([...capabilities]),
    denyByDefault: true,
  });
}

/**
 * The only interface a validator receives besides its request.
 *
 * It exposes reads and nothing else: no fs handle, no child_process, no network
 * client, no provider, executor, or planner is reachable from here.
 */
export interface ValidatorCapabilityContext {
  readInput<T = unknown>(): T;
  readContext<T = unknown>(): T;
  readMetadata(): ValidatorCapabilities;
  /** Capabilities actually granted, so a validator can degrade rather than guess. */
  granted(): ReadonlyArray<ValidatorCapability>;
  has(capability: ValidatorCapability): boolean;
}

export function policyAllows(
  policy: ValidatorCapabilityPolicy,
  capability: ValidatorCapability,
): boolean {
  if (!policy.denyByDefault) return true;
  return policy.allowed.includes(capability);
}
