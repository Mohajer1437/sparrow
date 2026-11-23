import { VerificationStrategyEngine } from '../../contracts/verification-strategy-engine';
import { VerificationStrategy } from '../../domain/verification-strategy';
import { ExecutionPlan } from '../../domain/execution-plan';
import { ImpactReport } from '../../domain/impact-analysis';
import { RegressionSelector } from '../../contracts/regression-selector';
import { DeterministicRegressionSelector } from '../impact-analysis/deterministic-regression-selector';

export class DefaultVerificationStrategyEngine implements VerificationStrategyEngine {
  private readonly MAX_FILES_FOR_HEAVY_CHECK = 5;
  private readonly regressionSelector: RegressionSelector;

  constructor(regressionSelector?: RegressionSelector) {
    this.regressionSelector = regressionSelector || new DeterministicRegressionSelector();
  }

  async generate(
    plan: ExecutionPlan | null,
    impactReport: ImpactReport | null,
    changedFiles: ReadonlyArray<string>
  ): Promise<VerificationStrategy> {
    const reasons: string[] = [];
    let confidence: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';

    let runFormatting = false;
    let runLint = false;
    let runTypeCheck = false;
    let runUnitTests = false;
    let runIntegrationTests = false;
    let runBuild = false;
    const runCustomCommands: string[] = [];

    const normalizedFiles = changedFiles.map(f => f.replace(/\\/g, '/'));

    // RULE_05: If ONLY markdown files changed, skip heavy verification
    const onlyMarkdown = normalizedFiles.length > 0 && normalizedFiles.every(f => f.endsWith('.md'));
    if (onlyMarkdown) {
      reasons.push('RULE_05: Only Markdown files changed, skipping heavy verification');
      confidence = 'LOW';
      return Object.freeze({
        runFormatting, runLint, runTypeCheck, runUnitTests, runIntegrationTests, runBuild,
        runCustomCommands: Object.freeze(runCustomCommands), confidence, reasons: Object.freeze(reasons)
      });
    }

    // RULE_01: TypeScript changed -> TypeCheck
    if (normalizedFiles.some(f => f.endsWith('.ts') || f.endsWith('.tsx'))) {
      runTypeCheck = true;
      reasons.push('RULE_01: TypeScript files changed, requiring TypeCheck');
    }

    // RULE_02: package.json changed -> Build
    if (normalizedFiles.some(f => f.endsWith('package.json'))) {
      runBuild = true;
      reasons.push('RULE_02: package.json changed, requiring Build');
    }

    // RULE_03: Test file changed -> Unit Test
    if (normalizedFiles.some(f => f.includes('.test.') || f.includes('.spec.'))) {
      runUnitTests = true;
      reasons.push('RULE_03: Test files changed, requiring Unit Tests');
    }

    // RULE_04: API files changed -> Integration Test
    if (normalizedFiles.some(f => f.includes('/api/') || f.includes('/routes/') || f.includes('/controllers/'))) {
      runIntegrationTests = true;
      reasons.push('RULE_04: API/Route files changed, requiring Integration Tests');
    }

    // Impact-Driven Regression Selection
    if (impactReport) {
      if (impactReport.relatedTests && impactReport.relatedTests.length > 0) {
        runUnitTests = true;
        reasons.push(`IMPACT: Impacted tests identified: ${impactReport.relatedTests.join(', ')}`);
      }
      if (impactReport.analysis?.affectedEndpoints && impactReport.analysis.affectedEndpoints.length > 0) {
        runIntegrationTests = true;
        reasons.push(`IMPACT: Affected endpoints identified: ${impactReport.analysis.affectedEndpoints.join(', ')}`);
      }
    }

    // RULE_06: > N files changed -> Build + TypeCheck
    if (normalizedFiles.length > this.MAX_FILES_FOR_HEAVY_CHECK) {
      runBuild = true;
      runTypeCheck = true;
      reasons.push(`RULE_06: More than ${this.MAX_FILES_FOR_HEAVY_CHECK} files changed, requiring Build + TypeCheck`);
      confidence = 'HIGH';
    }

    // Default fallback: if no specific rule triggered but files changed, at least lint
    if (!runFormatting && !runLint && !runTypeCheck && !runUnitTests && !runIntegrationTests && !runBuild) {
      runLint = true;
      reasons.push('DEFAULT: Fallback to Lint for unspecified changes');
    }

    // Inherit from ExecutionPlan validation strategy if available
    if (plan?.validationStrategy?.requiredTests?.length) {
      runUnitTests = true;
      reasons.push(`PLAN: ExecutionPlan requires tests: ${plan.validationStrategy.requiredTests.join(', ')}`);
    }

    return Object.freeze({
      runFormatting,
      runLint,
      runTypeCheck,
      runUnitTests,
      runIntegrationTests,
      runBuild,
      runCustomCommands: Object.freeze(runCustomCommands),
      confidence,
      reasons: Object.freeze(reasons)
    });
  }
}
