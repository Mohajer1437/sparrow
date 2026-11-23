import { createHash } from 'crypto';

import type { ValidatorCapabilities, ValidatorContract } from './internal-validation';

/**
 * Deterministic governance for validator contracts.
 *
 * A fingerprint is taken over the declared metadata of a contract and nothing
 * else. It answers one question: is the contract the registry is holding right
 * now the same contract it admitted? Because the fingerprint excludes the
 * implementation, two validators that declare the same thing fingerprint the
 * same even when their bodies differ — that is intentional, since governance
 * here is about declarations, not behaviour.
 */

const SEMANTIC_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export function parseContractVersion(value: unknown): ParsedVersion | undefined {
  if (typeof value !== 'string') return undefined;
  const match = SEMANTIC_VERSION.exec(value.trim());
  if (!match) return undefined;
  return Object.freeze({
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  });
}

export function isValidContractVersion(value: unknown): boolean {
  return parseContractVersion(value) !== undefined;
}

/** Negative when `a` precedes `b`, zero when equal, positive when `a` follows. */
export function compareContractVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Canonical form of everything a fingerprint covers.
 *
 * Key order is fixed by construction and arrays keep their declared order, so
 * the same contract always serializes identically. The validate function, any
 * runtime object hanging off the contract, and anything time-dependent are all
 * excluded.
 */
function canonicalContract(contract: ValidatorContract | ValidatorCapabilities): unknown {
  const schema = contract.inputSchema;
  return {
    name: contract.name,
    type: contract.type,
    deterministic: contract.deterministic,
    mutationPolicy: contract.mutationPolicy,
    isolation: contract.isolation,
    executionMode: contract.executionMode,
    capabilities: [...contract.capabilities],
    inputSchema: {
      requiredFields: [...schema.requiredFields],
      requiredAnyOf: schema.requiredAnyOf ? [...schema.requiredAnyOf] : null,
      optionalFields: schema.optionalFields ? [...schema.optionalFields] : null,
      description: schema.description ?? null,
    },
    contractVersion: contract.contractVersion,
  };
}

/** Stable hash of a contract's declared metadata. */
export function computeContractFingerprint(
  contract: ValidatorContract | ValidatorCapabilities,
): string {
  return createHash('sha256').update(JSON.stringify(canonicalContract(contract))).digest('hex');
}

/**
 * How a validator reached the runner.
 *
 * Only a contract admitted through the registry has a fingerprint to check
 * against, so only that source can be verified. Anything else is, by
 * definition, ungoverned.
 */
export type ValidatorResolutionSource = 'REGISTERED_REGISTRY' | 'UNVERIFIED_RESOLVER';

/**
 * Where a validator sits in its life.
 *
 * DEPRECATED still runs, so a caller is not broken without warning, but every
 * such run is recorded. DISABLED is terminal: a validator taken out of service
 * cannot be quietly put back, because the reason it was disabled is not
 * something the registry can re-verify.
 */
export type ValidatorLifecycleState = 'ACTIVE' | 'DEPRECATED' | 'DISABLED';

/** Transitions the registry will perform, keyed by the state being left. */
export const ALLOWED_LIFECYCLE_TRANSITIONS: Readonly<
  Record<ValidatorLifecycleState, ReadonlyArray<ValidatorLifecycleState>>
> = Object.freeze({
  ACTIVE: Object.freeze<ValidatorLifecycleState[]>(['DEPRECATED', 'DISABLED']),
  DEPRECATED: Object.freeze<ValidatorLifecycleState[]>(['ACTIVE', 'DISABLED']),
  DISABLED: Object.freeze<ValidatorLifecycleState[]>([]),
});

export function isAllowedLifecycleTransition(
  from: ValidatorLifecycleState,
  to: ValidatorLifecycleState,
): boolean {
  if (from === to) return true;
  return ALLOWED_LIFECYCLE_TRANSITIONS[from].includes(to);
}

/**
 * Who asked for a governance change.
 *
 * A free-form source string can say anything and means nothing. An actor is
 * structured, so a history can be filtered by who acted and of what kind, and
 * an anonymous change is refused rather than attributed to a label.
 */
export interface ValidatorGovernanceActor {
  readonly id: string;
  readonly type: 'SYSTEM' | 'USER' | 'TEST';
  readonly name: string;
}

/** The actor used for validators the process registers at start-up. */
export const SYSTEM_BOOTSTRAP_ACTOR: ValidatorGovernanceActor = Object.freeze({
  id: 'system:bootstrap',
  type: 'SYSTEM',
  name: 'registry bootstrap',
});

/** The actor used by the runner when it records execution evidence. */
export const SYSTEM_RUNNER_ACTOR: ValidatorGovernanceActor = Object.freeze({
  id: 'system:internal-validation-runner',
  type: 'SYSTEM',
  name: 'internal validation runner',
});

export function isGovernanceActor(value: unknown): value is ValidatorGovernanceActor {
  if (value === null || typeof value !== 'object') return false;
  const raw = value as Partial<ValidatorGovernanceActor>;
  return (
    typeof raw.id === 'string' &&
    raw.id.trim().length > 0 &&
    typeof raw.name === 'string' &&
    raw.name.trim().length > 0 &&
    (raw.type === 'SYSTEM' || raw.type === 'USER' || raw.type === 'TEST')
  );
}

export function freezeActor(actor: ValidatorGovernanceActor): ValidatorGovernanceActor {
  return Object.freeze({ id: actor.id, type: actor.type, name: actor.name });
}

/** How a validator execution ended. */
export type ValidatorExecutionResult = 'SUCCESS' | 'FAILED' | 'REJECTED';

/**
 * What actually happened on one dispatch.
 *
 * A lifecycle audit event proves a validator was reached. Evidence proves what
 * it did: which contract ran, in which lifecycle state, over what interval, and
 * how it ended.
 */
export interface ValidatorExecutionEvidence {
  readonly validatorName: string;
  readonly fingerprint: string;
  readonly contractVersion: string;
  readonly lifecycleState: ValidatorLifecycleState;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly result: ValidatorExecutionResult;
  readonly errorCode?: string;
}

/** What the registry knows about a validator besides the validator itself. */
export interface ValidatorGovernanceRecord {
  readonly validatorName: string;
  readonly contractVersion: string;
  readonly fingerprint: string;
  readonly state: ValidatorLifecycleState;
  readonly resolutionSource: ValidatorResolutionSource;
}

/** A resolved validator together with the governance it was admitted under. */
export interface GovernedValidator {
  readonly validator: ValidatorContract;
  readonly fingerprint: string;
  readonly contractVersion: string;
}
