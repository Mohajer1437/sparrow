/**
 * CLI / REPL inspection command for Impact & Regression Intelligence (Milestone F).
 * Reports deterministic change impact analysis, relations, evidence, confidence,
 * and the corresponding risk-based regression plan.
 */

import * as path from 'path';
import { AppFactory } from '../../core/app-factory';
import { Logger } from '../../contracts/logger';
import { resolveWorkspaceRoot } from '../workspace-resolver';
import { formatImpactAnalysisSummary } from '../../domain/impact-analysis';
import { formatRegressionPlanSummary } from '../../domain/regression-plan';

export async function impactCommand(args: string[] = []): Promise<void> {
  const targetFiles = args.filter(a => !a.startsWith('-'));
  const workspaceRoot = await resolveWorkspaceRoot();
  const logger: Logger = { debug: () => {}, info: () => {}, warn: console.warn, error: console.error };
  const factory = new AppFactory(workspaceRoot, logger);

  if (targetFiles.length === 0) {
    console.log('Usage: impact <file1> [file2...]');
    console.log('Inspects change impact analysis and regression plan for specified files.');
    return;
  }

  const impactAnalyzer = factory.createImpactAnalyzer();
  const regressionSelector = factory.createRegressionSelector();

  console.log('Impact & Regression Intelligence:');
  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Target files: ${targetFiles.join(', ')}`);
  console.log('');

  try {
    const report = await impactAnalyzer.analyze(targetFiles);
    const analysis = report.analysis;

    if (!analysis) {
      console.log('Impact Report (Legacy):');
      console.log(`  Direct impacts: ${report.directImpacts.join(', ') || 'none'}`);
      console.log(`  Indirect impacts: ${report.indirectImpacts.join(', ') || 'none'}`);
      console.log(`  Related tests: ${report.relatedTests.join(', ') || 'none'}`);
      return;
    }

    console.log(`Impact Analysis Summary: ${formatImpactAnalysisSummary(analysis)}`);
    console.log(`Confidence: ${analysis.confidence}`);
    console.log(`Limits Reached: ${analysis.limitsReached ? 'YES (bounded)' : 'NO'}`);
    console.log('');

    console.log(`Directly Affected (${analysis.directlyAffected.length}):`);
    for (const f of analysis.directlyAffected) {
      console.log(`  - ${f}`);
    }
    console.log('');

    console.log(`Indirectly Affected (${analysis.indirectlyAffected.length}):`);
    for (const f of analysis.indirectlyAffected) {
      console.log(`  - ${f}`);
    }
    console.log('');

    console.log(`Affected Endpoints (${analysis.affectedEndpoints.length}):`);
    for (const ep of analysis.affectedEndpoints) {
      console.log(`  - ${ep}`);
    }
    console.log('');

    console.log(`Affected Tests (${analysis.affectedTests.length}):`);
    for (const t of analysis.affectedTests) {
      console.log(`  - ${t}`);
    }
    console.log('');

    console.log(`Affected Domains: [${analysis.affectedDomains.join(', ')}]`);
    console.log('');

    console.log(`Evidence & Relations (${analysis.relations.length}):`);
    for (const rel of analysis.relations) {
      console.log(`  * ${rel.source} --[${rel.relationType}]--> ${rel.target} (${rel.confidence})`);
      console.log(`    reason: ${rel.reason}`);
      if (rel.evidenceRef) {
        console.log(`    evidence: ${rel.evidenceRef}`);
      }
    }
    console.log('');

    if (analysis.unknowns.length > 0) {
      console.log(`Unknowns (${analysis.unknowns.length}):`);
      for (const u of analysis.unknowns) {
        console.log(`  ? ${u}`);
      }
      console.log('');
    }

    // Generate and display Regression Plan
    const regressionPlan = await regressionSelector.selectRegression({
      impactAnalysis: analysis,
      impactReport: report,
      changedFiles: targetFiles,
    });

    console.log('---');
    console.log('Regression Plan:');
    console.log(`Summary: ${formatRegressionPlanSummary(regressionPlan)}`);
    console.log(`Risk: ${regressionPlan.risk}`);
    console.log(`Policy: ${regressionPlan.policy}`);
    console.log(`Selected Checks (${regressionPlan.selectedChecks.length}): [${regressionPlan.selectedChecks.join(', ')}]`);
    console.log(`Direct Checks: [${regressionPlan.directChecks.join(', ')}]`);
    console.log(`Expanded Checks: [${regressionPlan.expandedChecks.join(', ')}]`);

    if (regressionPlan.skippedChecks.length > 0) {
      console.log(`Skipped Checks (${regressionPlan.skippedChecks.length}):`);
      for (const sk of regressionPlan.skippedChecks) {
        console.log(`  - ${sk.check}: ${sk.reason}`);
      }
    }

    if (regressionPlan.unverifiedArtifacts.length > 0) {
      console.log(`Unverified Affected Artifacts (${regressionPlan.unverifiedArtifacts.length}):`);
      for (const unv of regressionPlan.unverifiedArtifacts) {
        console.log(`  ! ${unv}`);
      }
    }

    console.log('');
    console.log('Reasons:');
    for (const r of regressionPlan.reasons) {
      console.log(`  - ${r}`);
    }
  } catch (err: any) {
    console.error(`Impact inspection failed: ${err.message}`);
  }
}
