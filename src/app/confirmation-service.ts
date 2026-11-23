import * as crypto from 'crypto';
import { ConfirmationStore, ConfirmationListFilter } from '../contracts/confirmation-store';
import {
  ConfirmationRequest,
  ConfirmationDecision,
  ConfirmationType,
  ConfirmationStatus,
  ConfirmationFingerprintInput,
  computeConfirmationFingerprint,
  isConfirmationExpired,
  validateDecisionTransition,
  TestCredentialRequirement,
} from '../domain/confirmation';
import { RiskLevel } from '../domain/pre-execution/risk';
import { ConfirmationPolicy } from '../core/confirmation/confirmation-policy';
import { RuntimeSecretHolder } from '../core/backend/runtime-secrets';
import { ExecutionLogger } from '../core/observability/execution-logger';

export interface CreateConfirmationRequestInput {
  readonly taskId: string;
  readonly runId?: string;
  readonly type: ConfirmationType;
  readonly reason: string;
  readonly risk: RiskLevel;
  readonly requestedAction: string;
  readonly affectedFiles?: ReadonlyArray<string>;
  readonly affectedArtifacts?: ReadonlyArray<string>;
  readonly evidenceRefs?: ReadonlyArray<string>;
  readonly credentialRequirement?: TestCredentialRequirement;
  readonly expiresAt?: string;
  readonly autoExpiresMs?: number;
}

export interface DecisionValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
  readonly stale?: boolean;
  readonly request?: ConfirmationRequest;
}

const DEFAULT_EXPIRATION_MS = 15 * 60 * 1000; // 15 minutes

export class ConfirmationService {
  constructor(
    private readonly store: ConfirmationStore,
    private readonly policy: ConfirmationPolicy = new ConfirmationPolicy(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createRequest(input: CreateConfirmationRequestInput): Promise<ConfirmationRequest> {
    const policyEval = this.policy.evaluate({
      type: input.type,
      risk: input.risk,
      affectedFiles: input.affectedFiles,
    });

    if (policyEval.layer === 'HARD_BLOCK') {
      throw new Error(`Cannot create confirmation request for hard-blocked action: ${policyEval.reason}`);
    }

    const id = `conf-${this.now().getTime()}-${crypto.randomBytes(4).toString('hex')}`;
    const createdAt = this.now().toISOString();
    const autoExpiresMs = input.autoExpiresMs ?? DEFAULT_EXPIRATION_MS;
    const expiresAt = input.expiresAt ?? new Date(this.now().getTime() + autoExpiresMs).toISOString();

    const fingerprintInput: ConfirmationFingerprintInput = {
      taskId: input.taskId,
      runId: input.runId,
      type: input.type,
      risk: input.risk,
      requestedAction: input.requestedAction,
      affectedFiles: input.affectedFiles ?? [],
      affectedArtifacts: input.affectedArtifacts ?? [],
      evidenceRefs: input.evidenceRefs ?? [],
      credentialRequirement: input.credentialRequirement,
    };

    const fingerprint = computeConfirmationFingerprint(fingerprintInput);

    const request: ConfirmationRequest = Object.freeze({
      id,
      taskId: input.taskId,
      runId: input.runId,
      type: input.type,
      status: 'PENDING',
      reason: input.reason,
      risk: input.risk,
      requestedAction: input.requestedAction,
      affectedFiles: Object.freeze([...(input.affectedFiles ?? [])]),
      affectedArtifacts: Object.freeze([...(input.affectedArtifacts ?? [])]),
      evidenceRefs: Object.freeze([...(input.evidenceRefs ?? [])]),
      fingerprint,
      createdAt,
      expiresAt,
      credentialRequirement: input.credentialRequirement
        ? Object.freeze({ ...input.credentialRequirement })
        : undefined,
      policy: Object.freeze({
        autoExpiresMs,
        requiresHuman: true,
      }),
    });

    await this.store.save(request);

    ExecutionLogger.log('CONFIRMATION', '-', '-', `Confirmation requested [${request.type}]: ${request.reason}`, {
      event: 'CONFIRMATION_CREATED',
      requestId: request.id,
      taskId: request.taskId,
      type: request.type,
      risk: request.risk,
      fingerprint: request.fingerprint,
    });

    if (request.type === 'REQUIRES_TEST_CREDENTIAL' && request.credentialRequirement) {
      ExecutionLogger.log('CONFIRMATION', '-', '-', `Test credential required: ${request.credentialRequirement.kind}`, {
        event: 'CREDENTIAL_REQUESTED',
        requestId: request.id,
        scope: request.credentialRequirement.scope,
      });
    }

    return request;
  }

  async getRequest(id: string): Promise<ConfirmationRequest | null> {
    const request = await this.store.get(id);
    if (!request) return null;

    if (request.status === 'PENDING' && isConfirmationExpired(request, this.now().toISOString())) {
      const expired: ConfirmationRequest = Object.freeze({
        ...request,
        status: 'EXPIRED',
      });
      await this.store.save(expired);
      ExecutionLogger.log('CONFIRMATION', '-', '-', `Confirmation expired: ${request.id}`, {
        event: 'CONFIRMATION_EXPIRED',
        requestId: request.id,
      });
      return expired;
    }

    return request;
  }

  async listPending(taskId?: string): Promise<ReadonlyArray<ConfirmationRequest>> {
    const list = await this.store.list({ status: 'PENDING', taskId });
    return list.filter(r => !isConfirmationExpired(r, this.now().toISOString()));
  }

  async listRequests(filter?: ConfirmationListFilter): Promise<ReadonlyArray<ConfirmationRequest>> {
    return this.store.list(filter);
  }

  async approve(
    requestId: string,
    options: { actor?: string; reason?: string } = {},
  ): Promise<ConfirmationRequest> {
    const request = await this.getRequest(requestId);
    if (!request) {
      throw new Error(`Confirmation request not found: ${requestId}`);
    }

    const transition = validateDecisionTransition(request.status, 'APPROVE');
    if (!transition.valid) {
      throw new Error(`Cannot approve confirmation request ${requestId}: ${transition.reason}`);
    }

    if (request.status === 'APPROVED') {
      return request; // Idempotent
    }

    if (isConfirmationExpired(request, this.now().toISOString())) {
      const expired: ConfirmationRequest = Object.freeze({ ...request, status: 'EXPIRED' });
      await this.store.save(expired);
      ExecutionLogger.log('CONFIRMATION', '-', '-', `Confirmation expired: ${request.id}`, {
        event: 'CONFIRMATION_EXPIRED',
        requestId: request.id,
      });
      throw new Error(`Confirmation request ${requestId} has expired and cannot be approved.`);
    }

    // Evaluate policy to ensure no hard block (R5.8)
    const policyEval = this.policy.evaluate({
      type: request.type,
      risk: request.risk,
      affectedFiles: request.affectedFiles,
    });
    if (policyEval.layer === 'HARD_BLOCK') {
      throw new Error(`Cannot approve hard-blocked action: ${policyEval.reason}`);
    }

    const decision: ConfirmationDecision = Object.freeze({
      requestId: request.id,
      decision: 'APPROVE',
      actor: options.actor ?? 'local-user',
      decidedAt: this.now().toISOString(),
      reason: options.reason,
    });

    const approvedRequest: ConfirmationRequest = Object.freeze({
      ...request,
      status: 'APPROVED',
      decision,
    });

    await this.store.save(approvedRequest);

    ExecutionLogger.log('CONFIRMATION', '-', '-', `Confirmation approved by ${decision.actor}: ${request.id}`, {
      event: 'CONFIRMATION_APPROVED',
      requestId: request.id,
      actor: decision.actor,
      fingerprint: request.fingerprint,
    });

    return approvedRequest;
  }

  async reject(
    requestId: string,
    options: { actor?: string; reason?: string } = {},
  ): Promise<ConfirmationRequest> {
    const request = await this.getRequest(requestId);
    if (!request) {
      throw new Error(`Confirmation request not found: ${requestId}`);
    }

    const transition = validateDecisionTransition(request.status, 'REJECT');
    if (!transition.valid) {
      throw new Error(`Cannot reject confirmation request ${requestId}: ${transition.reason}`);
    }

    if (request.status === 'REJECTED') {
      return request; // Idempotent
    }

    const decision: ConfirmationDecision = Object.freeze({
      requestId: request.id,
      decision: 'REJECT',
      actor: options.actor ?? 'local-user',
      decidedAt: this.now().toISOString(),
      reason: options.reason ?? 'Rejected by user',
    });

    const rejectedRequest: ConfirmationRequest = Object.freeze({
      ...request,
      status: 'REJECTED',
      decision,
    });

    await this.store.save(rejectedRequest);

    ExecutionLogger.log('CONFIRMATION', '-', '-', `Confirmation rejected by ${decision.actor}: ${request.id}`, {
      event: 'CONFIRMATION_REJECTED',
      requestId: request.id,
      actor: decision.actor,
      reason: decision.reason,
    });

    return rejectedRequest;
  }

  async provideCredential(
    requestId: string,
    token: string,
    options: { actor?: string; reason?: string; secrets?: RuntimeSecretHolder } = {},
  ): Promise<ConfirmationRequest> {
    const request = await this.getRequest(requestId);
    if (!request) {
      throw new Error(`Confirmation request not found: ${requestId}`);
    }

    if (request.type !== 'REQUIRES_TEST_CREDENTIAL') {
      throw new Error(`Request ${requestId} is not a credential request.`);
    }

    const transition = validateDecisionTransition(request.status, 'PROVIDE');
    if (!transition.valid) {
      throw new Error(`Cannot provide credential for request ${requestId}: ${transition.reason}`);
    }

    if (isConfirmationExpired(request, this.now().toISOString())) {
      const expired: ConfirmationRequest = Object.freeze({ ...request, status: 'EXPIRED' });
      await this.store.save(expired);
      throw new Error(`Credential request ${requestId} has expired.`);
    }

    if (options.secrets && request.credentialRequirement) {
      if (request.credentialRequirement.kind === 'admin_access_token') {
        options.secrets.set({ ...options.secrets.get(), adminAccessToken: token });
      } else if (request.credentialRequirement.kind === 'user_access_token') {
        options.secrets.set({ ...options.secrets.get(), userAccessToken: token });
      } else if (request.credentialRequirement.kind === 'database') {
        options.secrets.set({ ...options.secrets.get(), databaseUrl: token });
      }
    }

    const decision: ConfirmationDecision = Object.freeze({
      requestId: request.id,
      decision: 'PROVIDE',
      actor: options.actor ?? 'local-user',
      decidedAt: this.now().toISOString(),
      reason: options.reason ?? 'Test credential supplied',
      input: {
        credentialProvided: true,
      },
    });

    const approvedRequest: ConfirmationRequest = Object.freeze({
      ...request,
      status: 'APPROVED',
      decision,
    });

    await this.store.save(approvedRequest);

    ExecutionLogger.log('CONFIRMATION', '-', '-', `Credential provided by ${decision.actor} for request: ${request.id}`, {
      event: 'CREDENTIAL_PROVIDED',
      requestId: request.id,
      actor: decision.actor,
      scope: request.credentialRequirement?.scope,
    });

    return approvedRequest;
  }

  async cancel(
    requestId: string,
    options: { actor?: string; reason?: string } = {},
  ): Promise<ConfirmationRequest> {
    const request = await this.getRequest(requestId);
    if (!request) {
      throw new Error(`Confirmation request not found: ${requestId}`);
    }

    if (request.status === 'CANCELLED') {
      return request;
    }

    const decision: ConfirmationDecision = Object.freeze({
      requestId: request.id,
      decision: 'CANCEL',
      actor: options.actor ?? 'local-user',
      decidedAt: this.now().toISOString(),
      reason: options.reason ?? 'Cancelled',
    });

    const cancelledRequest: ConfirmationRequest = Object.freeze({
      ...request,
      status: 'CANCELLED',
      decision,
    });

    await this.store.save(cancelledRequest);
    return cancelledRequest;
  }

  async validateDecision(
    requestId: string,
    currentFacts: ConfirmationFingerprintInput,
  ): Promise<DecisionValidationResult> {
    const request = await this.getRequest(requestId);
    if (!request) {
      return { valid: false, reason: 'Confirmation request not found' };
    }

    if (request.status !== 'APPROVED') {
      return { valid: false, reason: `Request status is ${request.status}, not APPROVED`, request };
    }

    if (isConfirmationExpired(request, this.now().toISOString())) {
      return { valid: false, reason: 'Confirmation has expired', request };
    }

    // Recompute current fingerprint
    const currentFingerprint = computeConfirmationFingerprint(currentFacts);
    if (currentFingerprint !== request.fingerprint) {
      ExecutionLogger.log('CONFIRMATION', '-', '-', `Confirmation approval invalidated: facts changed for ${request.id}`, {
        event: 'CONFIRMATION_INVALIDATED',
        requestId: request.id,
        approvedFingerprint: request.fingerprint,
        currentFingerprint,
      });

      return {
        valid: false,
        stale: true,
        reason: 'Approved facts have materially changed (fingerprint mismatch). A new confirmation is required.',
        request,
      };
    }

    // Safety re-check against hard blocks
    const policyEval = this.policy.evaluate({
      type: currentFacts.type,
      risk: currentFacts.risk,
      affectedFiles: currentFacts.affectedFiles,
    });
    if (policyEval.layer === 'HARD_BLOCK') {
      return {
        valid: false,
        reason: `Action violates hard safety boundary: ${policyEval.reason}`,
        request,
      };
    }

    return { valid: true, request };
  }
}
