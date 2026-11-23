import { ConfirmationType } from '../../domain/confirmation';
import { RiskLevel } from '../../domain/pre-execution/risk';
import { ExecutionMode } from '../../domain/execution-mode';
import { RepairSafetyFinding } from '../../domain/repair/repair-objective';

export type PolicyLayer = 'HARD_BLOCK' | 'CONFIRMABLE' | 'ALLOW';

export interface ConfirmationPolicyInput {
  readonly type: ConfirmationType;
  readonly risk: RiskLevel;
  readonly executionMode?: ExecutionMode;
  readonly affectedFiles?: ReadonlyArray<string>;
  readonly proposedOperations?: ReadonlyArray<string>;
  readonly findings?: ReadonlyArray<RepairSafetyFinding>;
  readonly environment?: string;
  readonly isWorkspaceTraversal?: boolean;
  readonly modifiesVerificationHarness?: boolean;
}

export interface ConfirmationPolicyEvaluation {
  readonly layer: PolicyLayer;
  readonly reason: string;
  readonly canBeConfirmed: boolean;
}

/**
 * Deterministic policy engine for evaluating confirmation requirements.
 * Enforces strict boundaries:
 * 1. HARD_BLOCK: Cannot be confirmed or bypassed by human approval.
 * 2. CONFIRMABLE: Requires and permits human-in-the-loop decision.
 * 3. ALLOW: Permitted to execute automatically without confirmation.
 */
export class ConfirmationPolicy {
  evaluate(input: ConfirmationPolicyInput): ConfirmationPolicyEvaluation {
    // 1. HARD BLOCK checks (R5.8: Confirmation is NOT a security bypass)
    if (input.executionMode === 'READ_ONLY' && this.hasMutatingOperations(input.proposedOperations)) {
      return {
        layer: 'HARD_BLOCK',
        reason: 'READ_ONLY execution mode prohibits file modifications; human approval cannot override this boundary.',
        canBeConfirmed: false,
      };
    }

    if (input.isWorkspaceTraversal || this.detectPathTraversal(input.affectedFiles)) {
      return {
        layer: 'HARD_BLOCK',
        reason: 'Workspace path traversal is prohibited; operations outside the workspace root cannot be approved.',
        canBeConfirmed: false,
      };
    }

    if (input.environment === 'production' || input.environment === 'UNSAFE_ENVIRONMENT') {
      return {
        layer: 'HARD_BLOCK',
        reason: 'Production environment access is hard-blocked; human confirmation only permits safe/test environments.',
        canBeConfirmed: false,
      };
    }

    if (input.modifiesVerificationHarness || this.hasVerificationBypassFinding(input.findings)) {
      return {
        layer: 'HARD_BLOCK',
        reason: 'Modifying verification harness or bypassing quality policies is hard-blocked.',
        canBeConfirmed: false,
      };
    }

    // 2. CONFIRMABLE checks (R5.7)
    if (input.type === 'REQUIRES_TEST_CREDENTIAL') {
      return {
        layer: 'CONFIRMABLE',
        reason: 'Test credential required for backend verification.',
        canBeConfirmed: true,
      };
    }

    if (input.type === 'DESTRUCTIVE_REPAIR') {
      return {
        layer: 'CONFIRMABLE',
        reason: 'Destructive repair operations require explicit human confirmation.',
        canBeConfirmed: true,
      };
    }

    if (input.type === 'AMBIGUOUS_SCOPE') {
      return {
        layer: 'CONFIRMABLE',
        reason: 'Ambiguous scope requires explicit human confirmation.',
        canBeConfirmed: true,
      };
    }

    if (input.type === 'UNKNOWN_INTENT') {
      return {
        layer: 'CONFIRMABLE',
        reason: 'Task intent is ambiguous or unclassified for proposed destructive actions.',
        canBeConfirmed: true,
      };
    }

    if (input.type === 'HIGH_RISK_CHANGE' || input.risk === 'HIGH') {
      return {
        layer: 'CONFIRMABLE',
        reason: 'High-risk change requires explicit human confirmation.',
        canBeConfirmed: true,
      };
    }

    if (input.type === 'CONFIRMATION_REQUIRED' && input.risk !== 'LOW') {
      return {
        layer: 'CONFIRMABLE',
        reason: 'Execution gate policy requires user confirmation.',
        canBeConfirmed: true,
      };
    }

    if (this.hasSuspiciousFindings(input.findings)) {
      return {
        layer: 'CONFIRMABLE',
        reason: 'Suspicious repair findings detected requiring user confirmation.',
        canBeConfirmed: true,
      };
    }

    // 3. ALLOW
    return {
      layer: 'ALLOW',
      reason: 'Low or standard risk operation within safe boundaries.',
      canBeConfirmed: true,
    };
  }

  private hasMutatingOperations(operations?: ReadonlyArray<string>): boolean {
    if (!operations || operations.length === 0) return true; // default assume mutation
    return operations.some(op => ['ADD', 'MODIFY', 'DELETE', 'RENAME', 'MOVE', 'WRITE'].includes(op.toUpperCase()));
  }

  private detectPathTraversal(files?: ReadonlyArray<string>): boolean {
    if (!files) return false;
    for (const f of files) {
      if (f.includes('..') || f.startsWith('/') || /^[A-Za-z]:[\\/]/.test(f)) {
        // Absolute paths or parent directory traversal
        return true;
      }
    }
    return false;
  }

  private hasVerificationBypassFinding(findings?: ReadonlyArray<RepairSafetyFinding>): boolean {
    if (!findings) return false;
    return findings.some(f => f.kind === 'VERIFICATION_BYPASS' && (f.severity === 'BLOCKING' || f.severity === 'SUSPICIOUS'));
  }

  private hasSuspiciousFindings(findings?: ReadonlyArray<RepairSafetyFinding>): boolean {
    if (!findings) return false;
    return findings.some(f => f.severity === 'SUSPICIOUS');
  }
}
