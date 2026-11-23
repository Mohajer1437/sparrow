/**
 * Milestone F: Deterministic Risk-Based Regression Selector.
 * Implements F2 Verification Expansion and F3 Risk-Based Regression Selection.
 */

import { RegressionSelector, RegressionSelectionInput } from '../../contracts/regression-selector';
import { freezeRegressionPlan, RegressionPlan, SkippedRegressionCheck } from '../../domain/regression-plan';
import { ImpactAnalysis } from '../../domain/impact-analysis';
import { TodoRiskLevel } from '../../domain/todo-plan';

export class DeterministicRegressionSelector implements RegressionSelector {
  async selectRegression(input: RegressionSelectionInput): Promise<RegressionPlan> {
    const changedFiles = (input.changedFiles || []).map(f => f.replace(/\\/g, '/'));
    const impact: ImpactAnalysis | null = input.impactAnalysis ?? input.impactReport?.analysis ?? null;

    // 1. Determine Effective Risk
    const risk: TodoRiskLevel = this.determineEffectiveRisk(input, changedFiles);

    // 2. Identify Security Sensitivity
    const isSecuritySensitive = input.securitySensitive || this.checkSecuritySensitivity(changedFiles, impact);

    const directChecks: string[] = [];
    const expandedChecks: string[] = [];
    const selectedChecks = new Set<string>();
    const skippedChecks: SkippedRegressionCheck[] = [];
    const reasons: string[] = [];

    const isTypeScript = changedFiles.some(f => f.endsWith('.ts') || f.endsWith('.tsx'));
    const isMarkdownOnly = changedFiles.length > 0 && changedFiles.every(f => f.endsWith('.md'));
    const isPackageConfig = changedFiles.some(f => f.endsWith('package.json') || f.endsWith('tsconfig.json'));

    // Handle Markdown-only changes
    if (isMarkdownOnly) {
      directChecks.push('markdown_lint');
      selectedChecks.add('markdown_lint');
      reasons.push('RULE_MD: Markdown-only modification requires documentation lint only');
      skippedChecks.push({ check: 'typecheck', reason: 'Markdown-only changes do not affect runtime types' });
      skippedChecks.push({ check: 'build', reason: 'Markdown-only changes do not affect build artifacts' });

      return freezeRegressionPlan({
        id: `reg-${Date.now()}`,
        risk: 'LOW',
        directChecks: Object.freeze(directChecks),
        expandedChecks: Object.freeze([]),
        selectedChecks: Object.freeze(Array.from(selectedChecks)),
        skippedChecks: Object.freeze(skippedChecks),
        affectedArtifacts: Object.freeze(changedFiles),
        verifiedArtifacts: Object.freeze(changedFiles),
        unverifiedArtifacts: Object.freeze([]),
        reasons: Object.freeze(reasons),
        policy: 'MARKDOWN_DOCS_POLICY',
        impactSummary: impact?.summary,
        generatedAt: new Date().toISOString(),
      });
    }

    // Direct Checks (Baseline for code changes)
    if (isTypeScript) {
      directChecks.push('typecheck');
      selectedChecks.add('typecheck');
      reasons.push('DIRECT: TypeScript files modified -> typecheck required');
    }

    directChecks.push('lint');
    selectedChecks.add('lint');
    reasons.push('DIRECT: Code modifications -> lint required');

    if (isPackageConfig || changedFiles.length > 5) {
      directChecks.push('build');
      selectedChecks.add('build');
      reasons.push('DIRECT: Configuration or multiple files changed -> build required');
    }

    // Include direct tests
    if (impact?.affectedTests) {
      for (const testFile of impact.affectedTests) {
        // Direct test if it matches a changed file name
        const isDirect = changedFiles.some(cf => {
          const base = cf.replace(/\.[^.]+$/, '');
          return testFile.includes(base);
        });
        if (isDirect) {
          const checkName = `test:${testFile}`;
          directChecks.push(checkName);
          selectedChecks.add(checkName);
          reasons.push(`DIRECT_TEST: Test file corresponds directly to changed file -> ${testFile}`);
        }
      }
    }

    // 3. Unknown Impact Handling (Conservative Fallback)
    const isUnknownImpact = !impact || impact.confidence === 'UNKNOWN';
    if (isUnknownImpact) {
      reasons.push('FALLBACK: Unknown or unconfirmed impact analysis -> applying conservative safety baseline');
      directChecks.push('build');
      selectedChecks.add('build');
    }

    // 4. Verification Expansion based on Risk Level & Impact
    if (impact && !isUnknownImpact) {
      const affectedTests = impact.affectedTests || [];
      const affectedEndpoints = impact.affectedEndpoints || [];
      const affectedDomains = impact.affectedDomains || [];

      // MEDIUM & HIGH Risk: Include indirectly affected tests
      if (risk === 'MEDIUM' || risk === 'HIGH') {
        for (const testFile of affectedTests) {
          const checkName = `test:${testFile}`;
          if (!selectedChecks.has(checkName)) {
            expandedChecks.push(checkName);
            selectedChecks.add(checkName);
            reasons.push(`EXPANSION_TEST: ${risk} risk change affects dependent test -> ${testFile}`);
          }
        }
      } else {
        // LOW Risk skips indirect tests
        for (const testFile of affectedTests) {
          const checkName = `test:${testFile}`;
          if (!selectedChecks.has(checkName)) {
            skippedChecks.push({
              check: checkName,
              reason: 'LOW risk change skips downstream indirect test regression',
            });
          }
        }
      }

      // Endpoints Expansion
      if (affectedEndpoints.length > 0) {
        if (risk === 'MEDIUM' || risk === 'HIGH') {
          for (const ep of affectedEndpoints) {
            const checkName = `endpoint:${ep}`;
            expandedChecks.push(checkName);
            selectedChecks.add(checkName);
            reasons.push(`EXPANSION_ENDPOINT: ${risk} risk change impacts endpoint -> ${ep}`);
          }
        } else {
          for (const ep of affectedEndpoints) {
            skippedChecks.push({
              check: `endpoint:${ep}`,
              reason: 'LOW risk change skips endpoint regression verification',
            });
          }
        }
      }

      // Frontend Browser Scenarios
      if (affectedDomains.includes('frontend')) {
        const pageEndpoints = affectedEndpoints.filter(e => e.startsWith('PAGE /'));
        if (pageEndpoints.length > 0 && (risk === 'MEDIUM' || risk === 'HIGH')) {
          for (const page of pageEndpoints) {
            const checkName = `browser:${page.replace('PAGE ', '')}`;
            expandedChecks.push(checkName);
            selectedChecks.add(checkName);
            reasons.push(`EXPANSION_BROWSER: Frontend page impacted -> ${page}`);
          }
        }
      }

      // HIGH Risk: Broader targeted regression
      if (risk === 'HIGH') {
        expandedChecks.push('full_build');
        selectedChecks.add('full_build');
        reasons.push('HIGH_RISK: High risk change mandates full build verification');
      }
    }

    // 5. Skill-Aware Expansion
    if (input.skills) {
      for (const skill of input.skills) {
        if (skill.id === 'backend.api' && impact?.affectedEndpoints && impact.affectedEndpoints.length > 0) {
          if (!selectedChecks.has('api_error_handling')) {
            expandedChecks.push('api_error_handling');
            selectedChecks.add('api_error_handling');
            reasons.push('SKILL: backend.api requires unhandled error and status verification');
          }
        }
        if (skill.id === 'backend.database-verification' || impact?.affectedDomains.includes('database')) {
          if (!selectedChecks.has('read_only_db_check')) {
            expandedChecks.push('read_only_db_check');
            selectedChecks.add('read_only_db_check');
            reasons.push('SKILL: backend.database-verification requires read-only persistence check');
          }
        }
      }
    }

    // 6. Security-Sensitive Expansion
    if (isSecuritySensitive) {
      reasons.push('SECURITY: Security-sensitive change detected -> adding authentication and authorization verification');
      if (!selectedChecks.has('auth_verification')) {
        expandedChecks.push('auth_verification');
        selectedChecks.add('auth_verification');
      }
      if (!selectedChecks.has('authorization_verification')) {
        expandedChecks.push('authorization_verification');
        selectedChecks.add('authorization_verification');
      }
    }

    // 7. Version-Aware Expansion
    if (input.versionIntelligence && (input.versionIntelligence.conflicts.length > 0 || input.versionIntelligence.staleItems.length > 0)) {
      expandedChecks.push('version_compatibility_check');
      selectedChecks.add('version_compatibility_check');
      reasons.push('VERSION: Stale or conflicting dependencies detected -> adding version compatibility check');
    }

    // 8. Artifact Accounting
    const affectedArtifactsSet = new Set<string>([
      ...changedFiles,
      ...(impact?.directlyAffected || []),
      ...(impact?.indirectlyAffected || []),
      ...(impact?.affectedEndpoints || []),
      ...(impact?.affectedTests || []),
    ]);
    const affectedArtifacts = Array.from(affectedArtifactsSet).sort();

    const verifiedArtifactsSet = new Set<string>();
    const unverifiedArtifactsSet = new Set<string>();

    for (const art of affectedArtifacts) {
      const isDirectlyChecked = changedFiles.includes(art);
      const isTestChecked = selectedChecks.has(`test:${art}`);
      const isEndpointChecked = selectedChecks.has(`endpoint:${art}`) || selectedChecks.has(`browser:${art.replace('PAGE ', '')}`);

      if (isDirectlyChecked || isTestChecked || isEndpointChecked) {
        verifiedArtifactsSet.add(art);
      } else {
        unverifiedArtifactsSet.add(art);
      }
    }

    const policy = isUnknownImpact
      ? 'CONSERVATIVE_UNKNOWN_IMPACT_POLICY'
      : isSecuritySensitive
      ? 'SECURITY_SENSITIVE_EXPANSION_POLICY'
      : `${risk}_RISK_DETERMINISTIC_POLICY`;

    return freezeRegressionPlan({
      id: `reg-${Date.now()}`,
      risk,
      directChecks: Object.freeze(Array.from(new Set(directChecks)).sort()),
      expandedChecks: Object.freeze(Array.from(new Set(expandedChecks)).sort()),
      selectedChecks: Object.freeze(Array.from(selectedChecks).sort()),
      skippedChecks: Object.freeze(skippedChecks),
      affectedArtifacts: Object.freeze(affectedArtifacts),
      verifiedArtifacts: Object.freeze(Array.from(verifiedArtifactsSet).sort()),
      unverifiedArtifacts: Object.freeze(Array.from(unverifiedArtifactsSet).sort()),
      reasons: Object.freeze(reasons),
      policy,
      impactSummary: impact?.summary,
      generatedAt: new Date().toISOString(),
    });
  }

  private determineEffectiveRisk(input: RegressionSelectionInput, changedFiles: string[]): TodoRiskLevel {
    if (input.risk) return input.risk;

    if (input.todoPlan?.todos) {
      if (input.todoPlan.todos.some(t => t.risk === 'HIGH')) return 'HIGH';
      if (input.todoPlan.todos.some(t => t.risk === 'MEDIUM')) return 'MEDIUM';
      if (input.todoPlan.todos.some(t => t.risk === 'LOW')) return 'LOW';
    }

    // Default based on file count
    if (changedFiles.length > 5) return 'HIGH';
    if (changedFiles.length > 2) return 'MEDIUM';
    return 'LOW';
  }

  private checkSecuritySensitivity(changedFiles: string[], impact: ImpactAnalysis | null): boolean {
    const securityKeywords = ['auth', 'login', 'session', 'token', 'guard', 'credential', 'permission', 'secret', 'password'];
    for (const file of changedFiles) {
      const lower = file.toLowerCase();
      if (securityKeywords.some(kw => lower.includes(kw))) {
        return true;
      }
    }
    if (impact) {
      for (const file of impact.indirectlyAffected) {
        const lower = file.toLowerCase();
        if (securityKeywords.some(kw => lower.includes(kw))) {
          return true;
        }
      }
      if (impact.affectedDomains.includes('auth')) {
        return true;
      }
    }
    return false;
  }
}
