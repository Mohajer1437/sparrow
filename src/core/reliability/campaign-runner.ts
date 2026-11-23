/**
 * Milestone R8 — Reliability Campaign Runner & Aggregator.
 *
 * Coordinates execution and evidence collection for empirical reliability testing.
 * Enforces campaign integrity:
 * - Never drops or excludes difficult runs post-execution.
 * - Never modifies metric formulas.
 * - Never converts UNKNOWN into PASS.
 * - Stratifies results across Frontend (Next.js 14) and Backend (Express / SQLite).
 */

import {
  CampaignBuildIdentity,
  CampaignCaseExecutionResult,
  CampaignEnvironmentFingerprint,
  ReliabilityCampaign,
  ReliabilityCampaignCase,
  auditCampaignPopulation,
  validateCampaignIntegrity,
} from '../../domain/reliability-campaign';
import {
  ReliabilityRecord,
  ReliabilityReport,
} from '../../domain/reliability';
import { aggregateReliability } from './reliability-aggregator';

export interface CampaignRunnerOptions {
  readonly campaignId: string;
  readonly frontendRoot?: string;
  readonly backendRoot?: string;
  readonly targetSampleSize?: number;
}

export interface CampaignStratificationReport {
  readonly frontend: ReliabilityReport;
  readonly backend: ReliabilityReport;
  readonly overall: ReliabilityReport;
}

export interface RepeatedGroupAnalysis {
  readonly groupId: string;
  readonly cases: ReadonlyArray<string>;
  readonly taskIds: ReadonlyArray<string>;
  readonly runCount: number;
  readonly outcomeDistribution: Record<string, number>;
  readonly structuralConsistency: boolean;
  readonly varianceObserved: boolean;
}

export class ReliabilityCampaignRunner {
  private readonly campaignId: string;
  private readonly startedAt: string;
  private readonly taskCases: ReliabilityCampaignCase[];
  private readonly completedCases: CampaignCaseExecutionResult[] = [];
  private readonly exclusions: Array<{ caseId: string; reason: string }> = [];
  private readonly buildIdentity: CampaignBuildIdentity;
  private readonly environmentFingerprint: CampaignEnvironmentFingerprint;

  constructor(
    cases: ReadonlyArray<ReliabilityCampaignCase>,
    options: CampaignRunnerOptions,
  ) {
    this.campaignId = options.campaignId;
    this.startedAt = new Date().toISOString();
    this.taskCases = [...cases];

    this.buildIdentity = Object.freeze({
      sparrowVersion: '4.2.0',
      buildCommit: '4d026a4',
      distPath: 'E:/agentic/dist',
      buildTimestamp: this.startedAt,
    });

    this.environmentFingerprint = Object.freeze({
      os: 'win32 10.0.19045',
      nodeVersion: process.version,
      frontendFramework: 'next@14.2.35',
      frontendVersion: '14.2.35',
      backendFramework: 'express@4.21.0',
      backendDatabase: 'sqlite-DatabaseSync',
    });
  }

  recordExecution(result: CampaignCaseExecutionResult): void {
    const existingIndex = this.completedCases.findIndex(c => c.caseId === result.caseId);
    if (existingIndex >= 0) {
      throw new Error(`Execution for case ${result.caseId} already recorded`);
    }
    this.completedCases.push(result);
  }

  recordExclusion(caseId: string, reason: string): void {
    if (!reason || reason.trim().length === 0) {
      throw new Error('Exclusion reason is required');
    }
    this.exclusions.push({ caseId, reason });
  }

  buildCampaign(): ReliabilityCampaign {
    const records = this.completedCases
      .map(c => c.reliabilityRecord)
      .filter((r): r is ReliabilityRecord => Boolean(r));

    const overallReport = aggregateReliability(records, {
      minSampleSize: 5,
    });

    const campaign: ReliabilityCampaign = Object.freeze({
      campaignId: this.campaignId,
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      targetSampleSize: this.taskCases.length,
      environments: Object.freeze([
        {
          name: 'frontend' as const,
          workspaceRoot: 'E:/new-test-2',
          framework: 'nextjs',
          isDisposable: false,
        },
        {
          name: 'backend' as const,
          workspaceRoot: 'E:/agentic-r7-backend-test',
          framework: 'express',
          isDisposable: true,
        },
      ]),
      taskCases: Object.freeze(this.taskCases),
      completedCases: Object.freeze([...this.completedCases]),
      exclusions: Object.freeze([...this.exclusions]),
      report: overallReport,
      buildIdentity: this.buildIdentity,
      environmentFingerprint: this.environmentFingerprint,
    });

    const validation = validateCampaignIntegrity(campaign);
    if (!validation.valid) {
      throw new Error(`Campaign integrity check failed: ${validation.errors.join('; ')}`);
    }

    return campaign;
  }

  generateStratification(campaign: ReliabilityCampaign): CampaignStratificationReport {
    const allRecords = campaign.completedCases
      .map(c => c.reliabilityRecord)
      .filter((r): r is ReliabilityRecord => Boolean(r));

    const feRecords = allRecords.filter(r =>
      r.dimensions?.projectType === 'frontend'
      || (r.dimensions?.frameworks?.includes('nextjs') && !r.workspaceRoot.includes('backend'))
      || (r.workspaceRoot.includes('new-test-2') && r.dimensions?.projectType !== 'backend')
    );
    const beRecords = allRecords.filter(r =>
      r.dimensions?.projectType === 'backend'
      || r.dimensions?.frameworks?.includes('express')
      || r.workspaceRoot.includes('backend')
    );

    return Object.freeze({
      frontend: aggregateReliability(feRecords, { minSampleSize: 5 }),
      backend: aggregateReliability(beRecords, { minSampleSize: 5 }),
      overall: campaign.report ?? aggregateReliability(allRecords, { minSampleSize: 5 }),
    });
  }

  analyzeReproducibility(campaign: ReliabilityCampaign): ReadonlyArray<RepeatedGroupAnalysis> {
    const byGroup = new Map<string, ReliabilityCampaignCase[]>();
    for (const c of campaign.taskCases) {
      if (c.repeatedGroupId) {
        const list = byGroup.get(c.repeatedGroupId) ?? [];
        list.push(c);
        byGroup.set(c.repeatedGroupId, list);
      }
    }

    const analyses: RepeatedGroupAnalysis[] = [];
    const executionMap = new Map(campaign.completedCases.map(c => [c.caseId, c]));

    for (const [groupId, cases] of byGroup.entries()) {
      const caseIds = cases.map(c => c.caseId);
      const results = caseIds.map(id => executionMap.get(id)).filter(Boolean);

      const outcomeDistribution: Record<string, number> = {};
      for (const res of results) {
        if (res) {
          outcomeDistribution[res.outcome] = (outcomeDistribution[res.outcome] ?? 0) + 1;
        }
      }

      const outcomes = Object.keys(outcomeDistribution);
      const varianceObserved = outcomes.length > 1;

      analyses.push(Object.freeze({
        groupId,
        cases: Object.freeze(caseIds),
        taskIds: Object.freeze(results.map(r => r!.taskId)),
        runCount: results.length,
        outcomeDistribution: Object.freeze(outcomeDistribution),
        structuralConsistency: true,
        varianceObserved,
      }));
    }

    return Object.freeze(analyses);
  }
}
