import { randomUUID } from 'crypto';
import { VerificationValidationAgent } from '../../contracts/vv-agent';
import { ProductValidator } from '../../contracts/product-validator';
import { QualityPolicy } from '../../contracts/quality-policy';
import { DeterministicVerifier } from '../../contracts/deterministic-verifier';
import { ApiVerifier } from '../../contracts/api-verifier';
import { BrowserVerifier } from '../../contracts/browser-verifier';
import { SecurityVerifier } from '../../contracts/security-verifier';
import { AdaptiveAdversary } from '../../contracts/adaptive-adversary';
import { RegressionStore } from '../../contracts/regression-store';
import { ProductAnalysis, ProductValidationRequest } from '../../domain/product-analysis';
import { VerificationReport, VerificationRequest } from '../../domain/verification-report';
import { VerificationCheck, aggregateVerificationPassed, resolveVerificationResultStatus } from '../../domain/verification-check';
import { buildFailureContract } from './failure-contract-builder';
import { assertionsAsCriteria, isMeaningfulFailure, regressionCaseFromFailure } from './regression-case';
import { filterRegressionCases, replayApiCases, replayBrowserCasesFromChecks } from './regression-replay';
import { verifyIntentContract } from './intent-contract-verifier';
import { loadIntentContract } from './intent-contract-store';
import {
  VerificationSideEffect,
  VerificationSideEffectPolicy,
  buildSideEffectLedger,
} from '../../domain/verification-side-effect';
import { ExecutionLogger } from '../observability/execution-logger';
import { BLOCKED_BY_POLICY } from '../../domain/execution-mode';
import { isUrlReachable } from './production-app-server';

export class DefaultVvAgent implements VerificationValidationAgent {
  constructor(
    private readonly productValidator: ProductValidator,
    private readonly policy: QualityPolicy,
    private readonly deterministicVerifier: DeterministicVerifier,
    private readonly apiVerifier: ApiVerifier,
    private readonly browserVerifier: BrowserVerifier,
    private readonly securityVerifier: SecurityVerifier,
    private readonly adversary: AdaptiveAdversary,
    private readonly regressionStore: RegressionStore,
  ) {}

  analyzeIntent(request: ProductValidationRequest): Promise<ProductAnalysis> {
    return this.productValidator.analyze(request);
  }

  async verify(request: VerificationRequest): Promise<VerificationReport> {
    const profile = request.qualityProfile;
    const checks: VerificationCheck[] = [];
    // R1.26: the execution mode decides the policy. READ_ONLY forces read-only
    // verification and no caller can opt out of it; a mutating run verifies its
    // product live, which is a declared controlled mutation.
    const sideEffectPolicy: VerificationSideEffectPolicy =
      request.executionMode === 'READ_ONLY'
        ? 'READ_ONLY'
        : (request.sideEffectPolicy ?? 'CONTROLLED_MUTATION');
    const sideEffects: VerificationSideEffect[] = [];

    if (this.policy.requiresDeterministicVerification) {
      const changeFiles = request.runChangeSet?.files
        ?? request.changedFiles;
      checks.push(...await this.deterministicVerifier.verify({
        workspacePath: request.workspacePath,
        profile,
        changedFiles: changeFiles,
      }));
    }

    const baseUrl = process.env.AGENT_VV_BASE_URL
      || (profile === 'PRODUCTION' ? 'http://127.0.0.1:3010' : 'http://127.0.0.1:3000');
    if (!process.env.AGENT_VV_BASE_URL && profile === 'PRODUCTION') {
      process.env.AGENT_VV_BASE_URL = baseUrl;
    }
    let runtimeStop: (() => Promise<{ classification: string }>) | undefined;
    let serverOwnership = 'externally_managed';
    // R1.21/R1.24: live product verification needs a build and a running app,
    // which READ_ONLY structurally refuses. Reporting the resulting
    // unreachability as a product failure would blame the run for a policy the
    // system imposed, so live verification is skipped and recorded as blocked.
    const liveVerificationBlocked = sideEffectPolicy === 'READ_ONLY'
      && !(await isUrlReachable(baseUrl, 1500));
    if (liveVerificationBlocked) {
      checks.push(Object.freeze({
        id: 'read-only-live-verification',
        category: 'api' as const,
        name: 'Live product verification',
        passed: true,
        severity: 'LOW' as const,
        scope: 'WHOLE_RUN' as const,
        evidence: `${BLOCKED_BY_POLICY}: READ_ONLY blocks the build and server start that live API and browser`
          + ` verification require, and nothing is serving ${baseUrl}. This run carries no product-level runtime evidence.`,
        acceptanceCriterion: 'Read-only inspection reports the absence of runtime evidence instead of inventing it',
      }));
      sideEffects.push(Object.freeze({
        id: 'vv-live-verification',
        source: 'DefaultVvAgent',
        kind: 'PROCESS_SPAWN' as const,
        target: baseUrl,
        policy: 'READ_ONLY' as const,
        status: 'BLOCKED' as const,
        declared: true,
        reversible: true,
        detail: 'live API, browser and regression replay verification skipped because the execution mode is READ_ONLY',
      }));
    }
    if (!liveVerificationBlocked
      && profile === 'PRODUCTION'
      && (this.policy.requiresApiVerification || this.policy.requiresBrowserVerification)) {
      const { ensureProductionServer } = await import('./production-app-server');
      const runtime = await ensureProductionServer({
        workspacePath: request.workspacePath,
        baseUrl,
        sideEffectPolicy,
      });
      sideEffects.push(...(runtime.sideEffects ?? []));
      runtimeStop = runtime.stop;
      serverOwnership = runtime.ownership;
      if (runtime.error) {
        checks.push(Object.freeze({
          id: 'runtime-production-server',
          category: 'api' as const,
          name: 'PRODUCTION app server',
          passed: false,
          severity: 'HIGH' as const,
          evidence: runtime.error + '; classification=' + (runtime.crashClassification || 'unexpected_crash'),
          acceptanceCriterion: 'PRODUCTION can serve the built app for live API and browser verification',
        }));
      } else {
        checks.push(Object.freeze({
          id: 'runtime-server-lifecycle',
          category: 'api' as const,
          name: 'Server lifecycle',
          passed: true,
          severity: 'LOW' as const,
          evidence: 'ownership=' + runtime.ownership + ' started=' + runtime.started,
          acceptanceCriterion: 'Verifier starts the production server only when nothing is already listening, and never kills an externally managed process',
        }));
      }
    }

    try {
      const priorFailures = await this.regressionStore.loadFailures(10);
      const storedCases = await this.regressionStore.loadCases(50);
      const replayScope = {
        task: request.task,
        acceptanceCriteria: request.acceptanceCriteria,
        changedFiles: request.changedFiles,
      };
      const replayable = this.policy.requiresRegressionReplay && !liveVerificationBlocked
        ? filterRegressionCases(storedCases, replayScope)
        : [];
      const replayBrowserCriteria = this.policy.requiresRegressionReplay
        ? replayable.filter(item => item.category === 'browser').flatMap(assertionsAsCriteria)
        : [];

      if (this.policy.requiresApiVerification && !liveVerificationBlocked) {
        checks.push(...await this.apiVerifier.verify({
          workspacePath: request.workspacePath,
          profile,
          changedFiles: request.changedFiles,
          task: request.task,
          acceptanceCriteria: request.acceptanceCriteria,
          todoPlan: request.todoPlan,
          skills: request.skills,
          sideEffectPolicy,
        }));
        sideEffects.push(...(this.apiVerifier.drainSideEffects?.() ?? []));
      }
      let browserChecks: VerificationCheck[] = [];
      if (this.policy.requiresBrowserVerification && !liveVerificationBlocked) {
        browserChecks = [...await this.browserVerifier.verify({
          workspacePath: request.workspacePath,
          profile,
          changedFiles: request.changedFiles,
          task: request.task,
          acceptanceCriteria: [
            ...(request.acceptanceCriteria ?? []),
            ...replayBrowserCriteria,
          ],
          todoPlan: request.todoPlan,
        })];
        checks.push(...browserChecks);
      }
      if (this.policy.requiresRegressionReplay && !liveVerificationBlocked) {
        checks.push(...await replayApiCases({
          cases: storedCases,
          baseUrl,
          apiVerifier: this.apiVerifier,
          scope: replayScope,
          sideEffectPolicy,
        }));
        checks.push(...replayBrowserCasesFromChecks(storedCases, browserChecks, replayScope));
      }
      if (this.policy.requiresSecurityVerification) {
        checks.push(...await this.securityVerifier.verify({
          workspacePath: request.workspacePath,
          profile,
          changedFiles: request.changedFiles,
        }));
      }
      if (this.policy.requiresAdversarialTesting) {
        const priorReports = await this.regressionStore.loadRecent(10);
        checks.push(...await this.adversary.generate({
          workspacePath: request.workspacePath,
          profile,
          changedFiles: request.changedFiles,
          priorChecks: checks,
          priorReports,
        }));
      }

      const storedIntent = request.intentContract
        || ((request.acceptanceCriteria && request.acceptanceCriteria.length > 0)
          ? undefined
          : await loadIntentContract(request.workspacePath));
      const acceptanceCriteria = (request.acceptanceCriteria && request.acceptanceCriteria.length > 0)
        ? request.acceptanceCriteria
        : storedIntent?.acceptanceCriteria;
      checks.push(...await verifyIntentContract({
        workspacePath: request.workspacePath,
        profile,
        task: request.task,
        acceptanceCriteria,
        intentContract: request.intentContract || storedIntent,
      }));

      const passed = aggregateVerificationPassed(checks);
      const failureContract = buildFailureContract({
        profile,
        checks,
        acceptanceCriteria,
        attempt: request.repairAttempt ?? 1,
        workspacePath: request.workspacePath,
      });

      const report: VerificationReport = Object.freeze({
        id: 'vv-' + randomUUID(),
        createdAt: new Date().toISOString(),
        qualityProfile: profile,
        passed,
        checks: Object.freeze(checks.slice()),
        evidence: Object.freeze(checks.map(c => {
          const status = resolveVerificationResultStatus(c);
          return c.id + ': ' + status + ' ' + c.evidence;
        })),
        failureContract,
        sideEffects: buildSideEffectLedger({ policy: sideEffectPolicy, effects: sideEffects }),
      });

      for (const effect of sideEffects) {
        ExecutionLogger.log('VERIFICATION_SIDE_EFFECT', '-', '-', `${effect.status} ${effect.kind}`, {
          id: effect.id,
          source: effect.source,
          target: effect.target,
          policy: effect.policy,
          declared: effect.declared,
          reversible: effect.reversible,
        });
      }

      await this.regressionStore.record(report);
      if (passed) {
        for (const prior of priorFailures.filter(isMeaningfulFailure).slice(-5)) {
          const regressionCase = regressionCaseFromFailure(prior, request);
          if (regressionCase) await this.regressionStore.saveCase(regressionCase);
        }
      }
      return report;
    } finally {
      if (runtimeStop) {
        const shutdown = await runtimeStop();
        if (shutdown.classification === 'unexpected_crash' && profile === 'PRODUCTION') {
          // Crash after/during verify is already represented by failed page/API checks.
          void serverOwnership;
        }
      }
    }
  }
}
