import { Reviewer, PatchInfo } from '../../contracts/reviewer';
import { ReviewReport, ReviewCheck, ReviewEvidence } from '../../domain/review-report';
import { ImpactReport } from '../../domain/impact-analysis';
import { Workspace } from '../../contracts/workspace';
import { WorkspaceMemory } from '../../contracts/workspace-memory';
import path from 'path';
import { ExecutionLogger } from '../observability/execution-logger';

export class DefaultReviewer implements Reviewer {
  private readonly protectedPatterns = [
    '.ai/', 'node_modules/', '.git/', 'dist/', 'build/',
    'package.json', 'tsconfig.json', 'tsconfig.build.json',
    'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'
  ];

  private readonly generatedPatterns = [
    '.ai/knowledge/architectural-map.json',
    '.ai/knowledge/codebase-map.json',
    '.ai/knowledge/knowledge-base.json',
    '.ai/knowledge/knowledge_base.json'
  ];

  constructor(
    private readonly workspace: Workspace,
    private readonly workspaceMemory: WorkspaceMemory
  ) {}

  async review(patch: PatchInfo, impactReport?: ImpactReport): Promise<ReviewReport> {
    const checks: ReviewCheck[] = [];
    ExecutionLogger.log('REVIEW', 'reviewer', '-', `Starting review of ${patch.modifiedFiles.length} files`);
    const reviewedFiles = [...patch.modifiedFiles];

    // 1. Protected Files Check
    checks.push(this.checkProtectedFiles(patch.modifiedFiles));

    // 2. Generated Files Check
    checks.push(this.checkGeneratedFiles(patch.modifiedFiles));

    // 3. Clean Architecture Dependencies Check
    checks.push(await this.checkCleanArchitectureDependencies(patch.modifiedFiles));

    // 4. Scope Violation Check
    if (patch.plannedScope) {
      checks.push(this.checkScopeViolation(patch.modifiedFiles, patch.plannedScope));
    } else {
      checks.push(this.createNotEvaluatedCheck('SCOPE_01', 'Scope Violation', 'Planned scope not provided'));
    }

    // 5. Missing Verification Scope Check
    if (impactReport) {
      checks.push(this.checkVerificationScope(patch.modifiedFiles, impactReport));
    } else {
      checks.push(this.createNotEvaluatedCheck('VERIF_01', 'Verification Scope', 'Impact report not provided'));
    }

    const passedCount = checks.filter(c => c.status === 'PASSED').length;
    const failedCount = checks.filter(c => c.status === 'FAILED').length;
    const warningCount = checks.filter(c => c.status === 'WARNING').length;
    const notEvaluatedCount = checks.filter(c => c.status === 'NOT_EVALUATED').length;

    return {
      timestamp: new Date().toISOString(),
      reviewedFiles,
      checks,
      passedCount,
      failedCount,
      warningCount,
      notEvaluatedCount,
    };
  }

  private checkProtectedFiles(files: ReadonlyArray<string>): ReviewCheck {
    const evidence: ReviewEvidence[] = [];
    for (const file of files) {
      const normalized = file.replace(/\\/g, '/');
      for (const pattern of this.protectedPatterns) {
        if (normalized.includes(pattern) || normalized === pattern) {
          evidence.push({
            rule: 'Protected files must not be modified',
            source: file,
            target: pattern,
            description: `File matches protected pattern: ${pattern}`
          });
        }
      }
    }
    return {
      ruleId: 'PROT_01',
      ruleName: 'Protected File Modification',
      severity: 'ERROR',
      status: evidence.length > 0 ? 'FAILED' : 'PASSED',
      evidence
    };
  }

  private checkGeneratedFiles(files: ReadonlyArray<string>): ReviewCheck {
    const evidence: ReviewEvidence[] = [];
    for (const file of files) {
      const normalized = file.replace(/\\/g, '/');
      for (const pattern of this.generatedPatterns) {
        if (normalized === pattern || normalized.endsWith(pattern)) {
          evidence.push({
            rule: 'Generated files must not be modified manually',
            source: file,
            target: pattern,
            description: `File is a generated artifact`
          });
        }
      }
    }
    return {
      ruleId: 'GEN_01',
      ruleName: 'Generated File Modification',
      severity: 'ERROR',
      status: evidence.length > 0 ? 'FAILED' : 'PASSED',
      evidence
    };
  }

  private async checkCleanArchitectureDependencies(files: ReadonlyArray<string>): Promise<ReviewCheck> {
    const evidence: ReviewEvidence[] = [];
    
    for (const file of files) {
      const normalized = file.replace(/\\/g, '/');
      try {
        if (!(await this.workspace.exists(normalized))) continue;
        const content = await this.workspace.readFile(normalized);
        const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
        let match;
        
        while ((match = importRegex.exec(content)) !== null) {
          const importPath = match[1];
          if (!importPath.startsWith('.')) continue;
          
          const dir = path.dirname(normalized);
          let resolved = path.join(dir, importPath).replace(/\\/g, '/');
          if (!resolved.endsWith('.ts')) {
             const withTs = resolved + '.ts';
             if (await this.workspace.exists(withTs).catch(() => false)) resolved = withTs;
             else {
                 const indexTs = resolved + '/index.ts';
                 if (await this.workspace.exists(indexTs).catch(() => false)) resolved = indexTs;
             }
          }
          
          const resolvedNorm = resolved.replace(/\\/g, '/');

          if (normalized.startsWith('src/domain/')) {
            if (resolvedNorm.startsWith('src/core/') || resolvedNorm.startsWith('src/cli/') || resolvedNorm.startsWith('src/contracts/')) {
              evidence.push({
                rule: 'Domain must not depend on Core, Contracts, or CLI',
                source: normalized,
                target: resolvedNorm,
                description: 'Forbidden dependency direction'
              });
            }
          } else if (normalized.startsWith('src/contracts/')) {
            if (resolvedNorm.startsWith('src/core/') || resolvedNorm.startsWith('src/cli/')) {
              evidence.push({
                rule: 'Contracts must not depend on Core or CLI',
                source: normalized,
                target: resolvedNorm,
                description: 'Forbidden dependency direction'
              });
            }
          } else if (normalized.startsWith('src/core/')) {
            if (resolvedNorm.startsWith('src/cli/')) {
              evidence.push({
                rule: 'Core must not depend on CLI',
                source: normalized,
                target: resolvedNorm,
                description: 'Forbidden dependency direction'
              });
            }
          }
        }
      } catch (error) {
        // Fail-safe
      }
    }

    return {
      ruleId: 'ARCH_01',
      ruleName: 'Clean Architecture Dependencies',
      severity: 'ERROR',
      status: evidence.length > 0 ? 'FAILED' : 'PASSED',
      evidence
    };
  }

  private checkScopeViolation(files: ReadonlyArray<string>, plannedScope: ReadonlyArray<string>): ReviewCheck {
    const evidence: ReviewEvidence[] = [];
    for (const file of files) {
      const normalized = file.replace(/\\/g, '/');
      const inScope = plannedScope.some(scope => {
        const scopeNorm = scope.replace(/\\/g, '/');
        return normalized === scopeNorm || normalized.startsWith(scopeNorm + '/') || normalized.startsWith(scopeNorm);
      });
      if (!inScope) {
        evidence.push({
          rule: 'Modifications must be within planned scope',
          source: file,
          target: plannedScope.join(', '),
          description: 'File modified outside planned scope'
        });
      }
    }
    return {
      ruleId: 'SCOPE_01',
      ruleName: 'Scope Violation',
      severity: 'ERROR',
      status: evidence.length > 0 ? 'FAILED' : 'PASSED',
      evidence
    };
  }

  private checkVerificationScope(files: ReadonlyArray<string>, impactReport: ImpactReport): ReviewCheck {
    const evidence: ReviewEvidence[] = [];
    const verifSet = new Set(impactReport.verificationScope.map(f => f.replace(/\\/g, '/')));
    
    for (const file of files) {
      const normalized = file.replace(/\\/g, '/');
      if (!verifSet.has(normalized)) {
        evidence.push({
          rule: 'All modified files should be in verification scope',
          source: file,
          target: 'Impact Report Verification Scope',
          description: 'Modified file not found in Impact Analysis verification scope'
        });
      }
    }
    return {
      ruleId: 'VERIF_01',
      ruleName: 'Missing Verification Scope',
      severity: 'WARNING',
      status: evidence.length > 0 ? 'WARNING' : 'PASSED',
      evidence
    };
  }

  private createNotEvaluatedCheck(ruleId: string, ruleName: string, description: string): ReviewCheck {
    return {
      ruleId,
      ruleName,
      severity: 'NOT_EVALUATED',
      status: 'NOT_EVALUATED',
      evidence: [{
        rule: ruleName,
        source: 'N/A',
        target: 'N/A',
        description
      }]
    };
  }
}
