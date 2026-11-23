import * as crypto from 'crypto';
import { RiskLevel } from './pre-execution/risk';
import { TestCredentialKind } from './test-credential';

/**
 * R5.1/R5.2: Confirmation types supported by the Sparrow platform.
 */
export const CONFIRMATION_TYPES = [
  'CONFIRMATION_REQUIRED',
  'REQUIRES_TEST_CREDENTIAL',
  'HIGH_RISK_CHANGE',
  'DESTRUCTIVE_REPAIR',
  'AMBIGUOUS_SCOPE',
  'UNKNOWN_INTENT',
] as const;
export type ConfirmationType = (typeof CONFIRMATION_TYPES)[number];

/**
 * R5.3: Lifecycle status of a ConfirmationRequest.
 * Confirmation is an explicit state machine with lifecycle, not a single boolean.
 */
export const CONFIRMATION_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type ConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

/**
 * R5.4: Human decision actions.
 */
export const CONFIRMATION_DECISION_KINDS = [
  'APPROVE',
  'REJECT',
  'PROVIDE',
  'CANCEL',
] as const;
export type ConfirmationDecisionKind = (typeof CONFIRMATION_DECISION_KINDS)[number];

/**
 * R5.4 / R5.5: Confirmation decision record.
 * Contains only non-secret audit metadata.
 * Raw credentials must NEVER be stored here.
 */
export interface ConfirmationDecision {
  readonly requestId: string;
  readonly decision: ConfirmationDecisionKind;
  readonly actor: string;
  readonly decidedAt: string;
  readonly reason?: string;
  readonly input?: {
    readonly credentialProvided?: boolean;
  };
}

/**
 * Specification for credential requirements attached to a request.
 * Contains no secret values.
 */
export interface TestCredentialRequirement {
  readonly kind: TestCredentialKind;
  readonly environment: string;
  readonly scope: string;
  readonly endpoints: ReadonlyArray<string>;
  readonly reason: string;
}

/**
 * R5.1: Structured, typed ConfirmationRequest contract.
 */
export interface ConfirmationRequest {
  readonly id: string;
  readonly taskId: string;
  readonly runId?: string;
  readonly type: ConfirmationType;
  readonly status: ConfirmationStatus;
  readonly reason: string;
  readonly risk: RiskLevel;
  readonly requestedAction: string;
  readonly affectedFiles: ReadonlyArray<string>;
  readonly affectedArtifacts: ReadonlyArray<string>;
  readonly evidenceRefs: ReadonlyArray<string>;
  /** R5.14: SHA-256 fingerprint of approved facts */
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly decision?: ConfirmationDecision;
  readonly credentialRequirement?: TestCredentialRequirement;
  readonly policy?: {
    readonly autoExpiresMs?: number;
    readonly requiresHuman?: boolean;
  };
}

export interface ConfirmationFingerprintInput {
  readonly taskId: string;
  readonly runId?: string;
  readonly type: ConfirmationType;
  readonly risk: RiskLevel;
  readonly requestedAction: string;
  readonly affectedFiles: ReadonlyArray<string>;
  readonly affectedArtifacts?: ReadonlyArray<string>;
  readonly evidenceRefs?: ReadonlyArray<string>;
  readonly credentialRequirement?: TestCredentialRequirement;
}

/**
 * R5.14: Deterministic approval fingerprint calculation.
 * Covers structured approval-relevant facts only.
 * Secrets are never included in the fingerprint.
 */
export function computeConfirmationFingerprint(input: ConfirmationFingerprintInput): string {
  const normFiles = [...(input.affectedFiles ?? [])]
    .map(f => f.replace(/\\/g, '/').replace(/^\.?\//, ''))
    .sort();
  const normArtifacts = [...(input.affectedArtifacts ?? [])]
    .map(f => f.replace(/\\/g, '/').replace(/^\.?\//, ''))
    .sort();
  const normEvidence = [...(input.evidenceRefs ?? [])].sort();

  const credParts = input.credentialRequirement
    ? [
        input.credentialRequirement.kind,
        input.credentialRequirement.environment,
        input.credentialRequirement.scope,
        [...(input.credentialRequirement.endpoints ?? [])].sort().join(','),
      ].join(';')
    : 'none';

  const payload = [
    `task:${input.taskId}`,
    `run:${input.runId || ''}`,
    `type:${input.type}`,
    `risk:${input.risk}`,
    `action:${input.requestedAction}`,
    `files:${normFiles.join(',')}`,
    `artifacts:${normArtifacts.join(',')}`,
    `evidence:${normEvidence.join(',')}`,
    `cred:${credParts}`,
  ].join('|');

  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex').substring(0, 32);
}

/**
 * Checks if a confirmation request is expired based on current timestamp.
 */
export function isConfirmationExpired(
  request: ConfirmationRequest,
  nowIso: string = new Date().toISOString(),
): boolean {
  if (!request.expiresAt) return false;
  return Date.parse(nowIso) >= Date.parse(request.expiresAt);
}

/**
 * Validates whether a decision transition from the current status is valid.
 */
export function validateDecisionTransition(
  currentStatus: ConfirmationStatus,
  decisionKind: ConfirmationDecisionKind,
): { readonly valid: boolean; readonly reason?: string } {
  if (currentStatus === 'EXPIRED') {
    return { valid: false, reason: 'Request is already EXPIRED' };
  }
  if (currentStatus === 'CANCELLED') {
    return { valid: false, reason: 'Request is already CANCELLED' };
  }
  if (currentStatus === 'REJECTED') {
    if (decisionKind === 'REJECT') {
      return { valid: true }; // idempotent
    }
    return { valid: false, reason: 'Request was already REJECTED' };
  }
  if (currentStatus === 'APPROVED') {
    if (decisionKind === 'APPROVE' || decisionKind === 'PROVIDE') {
      return { valid: true }; // idempotent
    }
    return { valid: false, reason: 'Request was already APPROVED' };
  }
  return { valid: true };
}

/**
 * Format a confirmation request for display in CLI/REPL.
 */
export function formatConfirmationRequest(request: ConfirmationRequest): string {
  const lines: string[] = [
    `=== CONFIRMATION REQUIRED [${request.type}] ===`,
    `ID: ${request.id}`,
    `Task: ${request.taskId}`,
    `Risk: ${request.risk}`,
    `Reason: ${request.reason}`,
    `Requested Action: ${request.requestedAction}`,
    `Status: ${request.status}`,
  ];
  if (request.affectedFiles.length > 0) {
    lines.push(`Affected Files: ${request.affectedFiles.join(', ')}`);
  }
  if (request.affectedArtifacts.length > 0) {
    lines.push(`Affected Artifacts: ${request.affectedArtifacts.join(', ')}`);
  }
  if (request.expiresAt) {
    lines.push(`Expires At: ${request.expiresAt}`);
  }
  if (request.credentialRequirement) {
    lines.push(`Required Credential: ${request.credentialRequirement.kind} for ${request.credentialRequirement.scope}`);
  }
  return lines.join('\n');
}
