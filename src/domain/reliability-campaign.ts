/**
 * Milestone R8 — Reliability Campaign & Empirical Evidence.
 *
 * Defines the typed campaign contracts, case definitions, and audit structures.
 * A campaign records what actually happened without altering definitions,
 * excluding difficult cases, or converting UNKNOWN into PASS.
 */

import { ExecutionMode } from './execution-mode';
import {
  EvidenceState,
  ReliabilityRecord,
  ReliabilityReport,
  RunOutcome,
} from './reliability';
import { TaskRunSnapshot } from './task-run';

export const CAMPAIGN_CATEGORIES = [
  'FRONTEND_READONLY',
  'FRONTEND_SIMPLE_MUTATION',
  'FRONTEND_MULTI_FILE',
  'FRONTEND_ARCHITECTURE_AWARE',
  'FRONTEND_VERSION_AWARE',
  'FRONTEND_IMPACT_AWARE',
  'BACKEND_READONLY',
  'BACKEND_ENDPOINT_VERIFICATION',
  'BACKEND_AUTH',
  'BACKEND_ADMIN',
  'BACKEND_DATABASE',
  'FAILURE_REPAIR',
  'REPAIR_EXPANSION',
  'CONFIRMATION',
  'NEGATIVE_SCOPE',
  'NEGATIVE_SECURITY',
] as const;
export type CampaignCategory = (typeof CAMPAIGN_CATEGORIES)[number];

export const CAMPAIGN_DIFFICULTIES = ['LOW', 'MEDIUM', 'HIGH', 'ADVERSARIAL'] as const;
export type CampaignDifficulty = (typeof CAMPAIGN_DIFFICULTIES)[number];

export const CAMPAIGN_TERMINAL_CLASSIFICATIONS = [
  'SUCCESS',
  'FAILED',
  'BLOCKED',
  'ABORTED',
  'INSUFFICIENT_EVIDENCE',
  'NOT_AVAILABLE',
] as const;
export type CampaignTerminalClassification = (typeof CAMPAIGN_TERMINAL_CLASSIFICATIONS)[number];

export const CAMPAIGN_EXECUTION_LABELS = ['REAL E2E', 'INTEGRATION', 'UNIT', 'FIXTURE'] as const;
export type CampaignExecutionLabel = (typeof CAMPAIGN_EXECUTION_LABELS)[number];

export interface CampaignBuildIdentity {
  readonly sparrowVersion: string;
  readonly buildCommit?: string;
  readonly distPath: string;
  readonly buildTimestamp: string;
}

export interface CampaignEnvironmentFingerprint {
  readonly os: string;
  readonly nodeVersion: string;
  readonly frontendFramework: string;
  readonly frontendVersion: string;
  readonly backendFramework: string;
  readonly backendDatabase: string;
}

export interface CampaignEnvironmentConfig {
  readonly name: 'frontend' | 'backend';
  readonly workspaceRoot: string;
  readonly framework: string;
  readonly isDisposable: boolean;
}

export interface ReliabilityCampaignCase {
  readonly caseId: string;
  readonly category: CampaignCategory;
  readonly difficulty: CampaignDifficulty;
  readonly environment: 'frontend' | 'backend';
  readonly prompt: string;
  readonly promptVersion: string;
  readonly executionMode: ExecutionMode;
  readonly requiresRepair: boolean;
  readonly requiresConfirmation: boolean;
  readonly expectedBehavior: string;
  readonly repeatedGroupId?: string;
}

export interface CampaignCaseExecutionResult {
  readonly caseId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly attemptId?: string;
  readonly outcome: RunOutcome;
  readonly classification: CampaignTerminalClassification;
  readonly executionLabel: CampaignExecutionLabel;
  readonly firstPassSuccess: boolean;
  readonly repairExecuted: boolean;
  readonly repairSuccess?: boolean;
  readonly confirmationExecuted: boolean;
  readonly confirmationApproved?: boolean;
  readonly evidenceState: EvidenceState;
  readonly suspicious: boolean;
  readonly rawSnapshot?: TaskRunSnapshot;
  readonly reliabilityRecord?: ReliabilityRecord;
  readonly notes?: string;
}

export interface CampaignExclusion {
  readonly caseId: string;
  readonly reason: string;
}

export interface CampaignPopulationAudit {
  readonly totalScheduled: number;
  readonly totalExecuted: number;
  readonly totalCompleted: number;
  readonly totalBlocked: number;
  readonly totalFailed: number;
  readonly totalInsufficient: number;
  readonly totalExcluded: number;
  readonly exclusions: ReadonlyArray<CampaignExclusion>;
}

export interface ReliabilityCampaign {
  readonly campaignId: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly targetSampleSize: number;
  readonly environments: ReadonlyArray<CampaignEnvironmentConfig>;
  readonly taskCases: ReadonlyArray<ReliabilityCampaignCase>;
  readonly completedCases: ReadonlyArray<CampaignCaseExecutionResult>;
  readonly exclusions: ReadonlyArray<CampaignExclusion>;
  readonly report?: ReliabilityReport;
  readonly buildIdentity: CampaignBuildIdentity;
  readonly environmentFingerprint: CampaignEnvironmentFingerprint;
}

export function validateCampaignCase(
  caseDef: ReliabilityCampaignCase,
): { readonly valid: boolean; readonly errors: ReadonlyArray<string> } {
  const errors: string[] = [];

  if (!caseDef.caseId || typeof caseDef.caseId !== 'string') {
    errors.push('caseId is required');
  }
  if (!CAMPAIGN_CATEGORIES.includes(caseDef.category)) {
    errors.push(`Invalid category: ${caseDef.category}`);
  }
  if (!CAMPAIGN_DIFFICULTIES.includes(caseDef.difficulty)) {
    errors.push(`Invalid difficulty: ${caseDef.difficulty}`);
  }
  if (caseDef.environment !== 'frontend' && caseDef.environment !== 'backend') {
    errors.push(`Invalid environment: ${caseDef.environment}`);
  }
  if (!caseDef.prompt || !caseDef.prompt.startsWith('/execute')) {
    errors.push('prompt is required and must begin with /execute');
  }
  if (!caseDef.promptVersion || typeof caseDef.promptVersion !== 'string') {
    errors.push('promptVersion is required');
  }

  return {
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  };
}

export function validateCampaignIntegrity(
  campaign: ReliabilityCampaign,
): { readonly valid: boolean; readonly errors: ReadonlyArray<string> } {
  const errors: string[] = [];

  if (!campaign.campaignId) {
    errors.push('campaignId is required');
  }
  if (!campaign.startedAt) {
    errors.push('startedAt is required');
  }
  if (campaign.targetSampleSize <= 0) {
    errors.push('targetSampleSize must be > 0');
  }

  // Duplicate caseId detection
  const caseIds = new Set<string>();
  for (const c of campaign.taskCases) {
    if (caseIds.has(c.caseId)) {
      errors.push(`Duplicate caseId found in taskCases: ${c.caseId}`);
    }
    caseIds.add(c.caseId);
    const validation = validateCampaignCase(c);
    if (!validation.valid) {
      errors.push(`Invalid case ${c.caseId}: ${validation.errors.join(', ')}`);
    }
  }

  // Scheduled case cannot disappear without exclusion record
  const executedIds = new Set(campaign.completedCases.map(res => res.caseId));
  const excludedIds = new Set(campaign.exclusions.map(ex => ex.caseId));

  for (const scheduled of campaign.taskCases) {
    if (!executedIds.has(scheduled.caseId) && !excludedIds.has(scheduled.caseId)) {
      errors.push(`Scheduled case ${scheduled.caseId} neither executed nor explicitly excluded`);
    }
  }

  return {
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  };
}

export function auditCampaignPopulation(campaign: ReliabilityCampaign): CampaignPopulationAudit {
  const totalScheduled = campaign.taskCases.length;
  const totalExecuted = campaign.completedCases.length;
  const totalCompleted = campaign.completedCases.filter(c => c.classification === 'SUCCESS').length;
  const totalBlocked = campaign.completedCases.filter(c => c.classification === 'BLOCKED').length;
  const totalFailed = campaign.completedCases.filter(c => c.classification === 'FAILED').length;
  const totalInsufficient = campaign.completedCases.filter(
    c => c.classification === 'INSUFFICIENT_EVIDENCE' || c.classification === 'ABORTED',
  ).length;
  const totalExcluded = campaign.exclusions.length;

  return Object.freeze({
    totalScheduled,
    totalExecuted,
    totalCompleted,
    totalBlocked,
    totalFailed,
    totalInsufficient,
    totalExcluded,
    exclusions: campaign.exclusions,
  });
}
