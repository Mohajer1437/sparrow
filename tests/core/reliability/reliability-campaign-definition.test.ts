import {
  ReliabilityCampaign,
  ReliabilityCampaignCase,
  auditCampaignPopulation,
  validateCampaignCase,
  validateCampaignIntegrity,
} from '../../../src/domain/reliability-campaign';
import { CANONICAL_CAMPAIGN_CASES } from '../../../src/core/reliability/campaign-definitions';
import { ReliabilityCampaignRunner } from '../../../src/core/reliability/campaign-runner';
import { makeSnapshot } from './fixtures/reliability-fixtures';
import { buildReliabilityRecord } from '../../../src/core/reliability/reliability-record-builder';

describe('R8 — Reliability Campaign Definitions & Core Engine', () => {
  it('validates canonical campaign case definitions have valid categories and /execute prefix', () => {
    expect(CANONICAL_CAMPAIGN_CASES.length).toBeGreaterThanOrEqual(20);

    for (const c of CANONICAL_CAMPAIGN_CASES) {
      const validation = validateCampaignCase(c);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(c.prompt.startsWith('/execute')).toBe(true);
      expect(c.promptVersion).toBeDefined();
    }
  });

  it('rejects invalid campaign case without /execute prefix', () => {
    const invalidCase: ReliabilityCampaignCase = {
      caseId: 'invalid-case-01',
      category: 'FRONTEND_READONLY',
      difficulty: 'LOW',
      environment: 'frontend',
      prompt: 'Inspect project structure', // Missing /execute
      promptVersion: 'v1',
      executionMode: 'READ_ONLY',
      requiresRepair: false,
      requiresConfirmation: false,
      expectedBehavior: 'none',
    };

    const validation = validateCampaignCase(invalidCase);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('/execute'))).toBe(true);
  });

  it('detects duplicate case IDs in campaign definition', () => {
    const dupCase = { ...CANONICAL_CAMPAIGN_CASES[0] };
    const cases = [CANONICAL_CAMPAIGN_CASES[0], dupCase];

    const campaign: ReliabilityCampaign = {
      campaignId: 'r8-dup-test',
      startedAt: new Date().toISOString(),
      targetSampleSize: 2,
      environments: [],
      taskCases: cases,
      completedCases: [],
      exclusions: [],
      buildIdentity: {
        sparrowVersion: '4.2.0',
        distPath: 'dist',
        buildTimestamp: new Date().toISOString(),
      },
      environmentFingerprint: {
        os: 'win32',
        nodeVersion: 'v22.0.0',
        frontendFramework: 'nextjs',
        frontendVersion: '14.2.35',
        backendFramework: 'express',
        backendDatabase: 'sqlite',
      },
    };

    const validation = validateCampaignIntegrity(campaign);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('Duplicate caseId'))).toBe(true);
  });

  it('flags scheduled cases that disappear without exclusion records', () => {
    const cases = [CANONICAL_CAMPAIGN_CASES[0], CANONICAL_CAMPAIGN_CASES[1]];

    const campaign: ReliabilityCampaign = {
      campaignId: 'r8-disappear-test',
      startedAt: new Date().toISOString(),
      targetSampleSize: 2,
      environments: [],
      taskCases: cases,
      completedCases: [], // Neither executed nor excluded
      exclusions: [],
      buildIdentity: {
        sparrowVersion: '4.2.0',
        distPath: 'dist',
        buildTimestamp: new Date().toISOString(),
      },
      environmentFingerprint: {
        os: 'win32',
        nodeVersion: 'v22.0.0',
        frontendFramework: 'nextjs',
        frontendVersion: '14.2.35',
        backendFramework: 'express',
        backendDatabase: 'sqlite',
      },
    };

    const validation = validateCampaignIntegrity(campaign);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('neither executed nor explicitly excluded'))).toBe(true);
  });

  it('runs population audit and accurately counts executions, blocks, failures, exclusions', () => {
    const cases = [CANONICAL_CAMPAIGN_CASES[0], CANONICAL_CAMPAIGN_CASES[1], CANONICAL_CAMPAIGN_CASES[2]];
    const snap1 = makeSnapshot({ taskId: 'task-audit-1' });
    const snap2 = makeSnapshot({ taskId: 'task-audit-2', status: 'BLOCKED' });
    const rec1 = buildReliabilityRecord(snap1);
    const rec2 = buildReliabilityRecord(snap2);

    const runner = new ReliabilityCampaignRunner(cases, { campaignId: 'r8-audit-test' });
    runner.recordExecution({
      caseId: cases[0].caseId,
      taskId: 'task-audit-1',
      runId: 'run-audit-1',
      sessionId: 'sess-audit-1',
      outcome: 'SUCCESS',
      classification: 'SUCCESS',
      executionLabel: 'REAL E2E',
      firstPassSuccess: true,
      repairExecuted: false,
      confirmationExecuted: false,
      evidenceState: 'PROVEN',
      suspicious: false,
      reliabilityRecord: rec1,
    });
    runner.recordExecution({
      caseId: cases[1].caseId,
      taskId: 'task-audit-2',
      runId: 'run-audit-2',
      sessionId: 'sess-audit-2',
      outcome: 'BLOCKED',
      classification: 'BLOCKED',
      executionLabel: 'REAL E2E',
      firstPassSuccess: false,
      repairExecuted: false,
      confirmationExecuted: false,
      evidenceState: 'NOT_PROVEN',
      suspicious: false,
      reliabilityRecord: rec2,
    });
    runner.recordExclusion(cases[2].caseId, 'Platform environment dependency unavailable');

    const campaign = runner.buildCampaign();
    const audit = auditCampaignPopulation(campaign);

    expect(audit.totalScheduled).toBe(3);
    expect(audit.totalExecuted).toBe(2);
    expect(audit.totalCompleted).toBe(1);
    expect(audit.totalBlocked).toBe(1);
    expect(audit.totalExcluded).toBe(1);
    expect(audit.exclusions[0].reason).toContain('unavailable');
  });

  it('performs stratification across Frontend and Backend', () => {
    const cases = [CANONICAL_CAMPAIGN_CASES[0], CANONICAL_CAMPAIGN_CASES[8]]; // 1 FE, 1 BE
    const snapFe = makeSnapshot({ taskId: 'task-fe-1', domain: 'frontend' });
    const snapBe = makeSnapshot({
      taskId: 'task-be-1',
      domain: 'backend',
      workspaceRoot: 'E:/agentic-r7-backend-test',
      project: {
        workspaceRoot: 'E:/agentic-r7-backend-test',
        projectType: 'backend',
        detectedFrameworks: ['express'],
        languages: ['javascript'],
        packageManager: 'npm',
        availableTestingTools: ['jest'],
        detectedDomains: ['backend'],
        capabilities: ['backend'],
      },
    });

    const runner = new ReliabilityCampaignRunner(cases, { campaignId: 'r8-strat-test' });
    runner.recordExecution({
      caseId: cases[0].caseId,
      taskId: 'task-fe-1',
      runId: 'run-fe-1',
      sessionId: 'sess-fe-1',
      outcome: 'SUCCESS',
      classification: 'SUCCESS',
      executionLabel: 'REAL E2E',
      firstPassSuccess: true,
      repairExecuted: false,
      confirmationExecuted: false,
      evidenceState: 'PROVEN',
      suspicious: false,
      reliabilityRecord: buildReliabilityRecord(snapFe),
    });
    runner.recordExecution({
      caseId: cases[1].caseId,
      taskId: 'task-be-1',
      runId: 'run-be-1',
      sessionId: 'sess-be-1',
      outcome: 'SUCCESS',
      classification: 'SUCCESS',
      executionLabel: 'REAL E2E',
      firstPassSuccess: true,
      repairExecuted: false,
      confirmationExecuted: false,
      evidenceState: 'PROVEN',
      suspicious: false,
      reliabilityRecord: buildReliabilityRecord(snapBe),
    });

    const campaign = runner.buildCampaign();
    const stratification = runner.generateStratification(campaign);

    expect(stratification.frontend.totals.allRuns).toBe(1);
    expect(stratification.backend.totals.allRuns).toBe(1);
    expect(stratification.overall.totals.allRuns).toBe(2);
  });

  it('analyzes repeated groups for structural consistency and outcome variance', () => {
    const repeatedCases = CANONICAL_CAMPAIGN_CASES.filter(c => c.repeatedGroupId === 'grp-fe-readonly');
    expect(repeatedCases.length).toBe(2);

    const runner = new ReliabilityCampaignRunner(repeatedCases, { campaignId: 'r8-repro-test' });
    runner.recordExecution({
      caseId: repeatedCases[0].caseId,
      taskId: 'task-rep-1',
      runId: 'run-rep-1',
      sessionId: 'sess-rep-1',
      outcome: 'SUCCESS',
      classification: 'SUCCESS',
      executionLabel: 'REAL E2E',
      firstPassSuccess: true,
      repairExecuted: false,
      confirmationExecuted: false,
      evidenceState: 'PROVEN',
      suspicious: false,
      reliabilityRecord: buildReliabilityRecord(makeSnapshot({ taskId: 'task-rep-1' })),
    });
    runner.recordExecution({
      caseId: repeatedCases[1].caseId,
      taskId: 'task-rep-2',
      runId: 'run-rep-2',
      sessionId: 'sess-rep-2',
      outcome: 'SUCCESS',
      classification: 'SUCCESS',
      executionLabel: 'REAL E2E',
      firstPassSuccess: true,
      repairExecuted: false,
      confirmationExecuted: false,
      evidenceState: 'PROVEN',
      suspicious: false,
      reliabilityRecord: buildReliabilityRecord(makeSnapshot({ taskId: 'task-rep-2' })),
    });

    const campaign = runner.buildCampaign();
    const analyses = runner.analyzeReproducibility(campaign);

    expect(analyses.length).toBe(1);
    expect(analyses[0].groupId).toBe('grp-fe-readonly');
    expect(analyses[0].runCount).toBe(2);
    expect(analyses[0].structuralConsistency).toBe(true);
    expect(analyses[0].varianceObserved).toBe(false);
  });
});
