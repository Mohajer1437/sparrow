export type ToolPermission = 'ALLOW' | 'DENY' | 'REQUIRE_CONFIRMATION';

export type ToolRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ToolExecutionContext {
  readonly toolName: string;
  readonly arguments: Record<string, any>;
  readonly sessionId?: string;
  readonly sessionStatus?: string;
  readonly executionCount?: number;
  readonly scope?: ReadonlyArray<string>;
  /** R1.20: system-level execution mode; READ_ONLY denies mutation tools. */
  readonly executionMode?: import('./execution-mode').ExecutionMode;
}

export interface ToolPolicyEvidence {
  readonly rule: string;
  readonly reason: string;
  readonly details?: Record<string, any>;
}

export interface ToolPolicyDecision {
  readonly permission: ToolPermission;
  readonly riskLevel: ToolRiskLevel;
  readonly evidence: ReadonlyArray<ToolPolicyEvidence>;
  readonly timestamp: string;
}
