import { PatchExecutor } from '../../contracts/patch-executor';
import { PatchRequest } from '../../domain/patch';
import { VerificationEngine } from '../../contracts/verification-engine';
import { VerificationStrategy } from '../../domain/verification-strategy';
import { SessionManager } from '../session/session-manager';
import { RetryAttempt, SessionStatus } from '../../domain/workspace-session';
import { ExecutionLogger } from '../observability/execution-logger';
import { StructuralAnalyzer } from './structural-analyzer';

export const MAX_PATCH_RETRIES = 3;

/**
 * C.1: Protected files that should never be rewritten (>30% change)
 */
export const PROTECTED_FILES = [
  'lib/utils.ts',
  'lib/storage.ts',
  'components/FlipCard.tsx',
  'components/ui/',
];

/** C.1: Max change for protected files (30%) */
export const PROTECTED_FILE_MAX_CHANGE = 0.3;

/** C.1: Max change for non-protected files (70%) */
export const GENERAL_FILE_MAX_CHANGE = 0.7;

export interface SafePatchExecutorOptions {
  readonly workspacePath: string;
  readonly patchExecutor: PatchExecutor;
  readonly verificationEngine: VerificationEngine;
  readonly sessionManager: SessionManager;
  readonly maxRetries?: number;
  readonly structuralAnalyzer?: StructuralAnalyzer;
}

/**
 * R2.6: SafePatchExecutor
 * Wraps PatchExecutor with verification + retry loop
 */
export class SafePatchExecutor {
  private readonly workspacePath: string;
  private readonly patchExecutor: PatchExecutor;
  private readonly verificationEngine: VerificationEngine;
  private readonly sessionManager: SessionManager;
  private readonly maxRetries: number;
  private readonly structuralAnalyzer?: StructuralAnalyzer;

  constructor(options: SafePatchExecutorOptions) {
    this.workspacePath = options.workspacePath;
    this.patchExecutor = options.patchExecutor;
    this.verificationEngine = options.verificationEngine;
    this.sessionManager = options.sessionManager;
    this.maxRetries = options.maxRetries ?? MAX_PATCH_RETRIES;
    this.structuralAnalyzer = options.structuralAnalyzer;
  }

  async executeWithVerification(
    sessionId: string,
    patchRequest: PatchRequest,
    strategy?: VerificationStrategy
  ): Promise<{ success: boolean; attempts: number; finalError?: string }> {
    let attempt = 0;
    let lastError: string = 'Unknown error';

    while (attempt < this.maxRetries) {
      attempt++;
      ExecutionLogger.log('PATCH', '-', '-', `Patch attempt ${attempt}/${this.maxRetries}`);

      try {
        // C.1: Check for dangerous rewrites
        const rewriteCheck = this.checkForDangerousRewrites(patchRequest);
        if (!rewriteCheck.safe) {
          ExecutionLogger.log('PATCH', '-', '-',
            `⚠️ Dangerous rewrite blocked: ${rewriteCheck.reason}`,
            { file: rewriteCheck.file, changeRatio: rewriteCheck.changeRatio }
          );
          throw new Error(`DANGEROUS_REWRITE_BLOCKED: ${rewriteCheck.reason}`);
        }

        // Step 1: Apply patch
        await this.patchExecutor.execute(patchRequest);

        // Step 2: Verify
        const verification = await this.verificationEngine.verify(this.workspacePath, strategy);

        if (verification.success) {
          await this.updateSessionStatus(sessionId, 'completed');
          ExecutionLogger.log('PATCH', '-', '-', `Patch verification passed`);
          return { success: true, attempts: attempt };
        }

        // Verification failed
        lastError = verification.errors.length > 0
          ? verification.errors.join('; ')
          : 'Verification failed without specific errors';

        const retryAttempt: RetryAttempt = {
          attempt,
          timestamp: new Date().toISOString(),
          action: 'patch_verification',
          error: lastError,
          resolution: attempt < this.maxRetries ? 'Retrying...' : 'Max retries exhausted'
        };

        await this.sessionManager.addRetryAttempt(sessionId, retryAttempt);

        // Rollback
        try {
          await this.patchExecutor.rollback(sessionId);
          ExecutionLogger.log('PATCH', '-', '-', `Rollback performed after verification failure`);
        } catch (rollbackError: any) {
          console.warn(`[SafePatchExecutor] Rollback failed: ${rollbackError.message}`);
        }

      } catch (error: any) {
        lastError = error.message || 'Unknown error during patch execution';
        const retryAttempt: RetryAttempt = {
          attempt,
          timestamp: new Date().toISOString(),
          action: 'patch_execution',
          error: lastError,
          resolution: attempt < this.maxRetries ? 'Retrying...' : 'Max retries exhausted'
        };

        await this.sessionManager.addRetryAttempt(sessionId, retryAttempt);
      }
    }

    // Max retries exhausted
    await this.updateSessionStatus(sessionId, 'rolled_back');

    return {
      success: false,
      attempts: attempt,
      finalError: `Max retries (${this.maxRetries}) exceeded: ${lastError}`
    };
  }

  /**
   * C.1: Check for dangerous rewrites before applying patch
   */
  private checkForDangerousRewrites(
    patchRequest: PatchRequest
  ): { safe: boolean; reason?: string; file?: string; changeRatio?: number } {
    for (const op of patchRequest.operations) {
      if (op.operation === 'modify' && op.originalContent && op.newContent) {
        const oldLines = op.originalContent.split('\n').length;
        const newLines = op.newContent.split('\n').length;

        if (oldLines === 0) continue;

        const changeRatio = Math.abs(oldLines - newLines) / oldLines;
        const isProtected = PROTECTED_FILES.some(pf =>
          op.path.includes(pf) || op.path.endsWith(pf)
        );

        // Phase C: Line count check (fast path)
        if (isProtected && changeRatio > PROTECTED_FILE_MAX_CHANGE) {
          return {
            safe: false,
            reason: `Protected file '${op.path}' has ${Math.round(changeRatio * 100)}% change (max ${Math.round(PROTECTED_FILE_MAX_CHANGE * 100)}%). Use surgical edits.`,
            file: op.path,
            changeRatio,
          };
        }

        if (!isProtected && changeRatio > GENERAL_FILE_MAX_CHANGE) {
          // Phase D.4: If line count is suspicious, run AST structural analysis
          if (this.structuralAnalyzer && this.structuralAnalyzer.isTypeScriptFile(op.path)) {
            try {
              const oldSig = this.structuralAnalyzer.extractSignature(op.originalContent, op.path);
              const newSig = this.structuralAnalyzer.extractSignature(op.newContent, op.path);
              const comparison = this.structuralAnalyzer.compareSignatures(oldSig, newSig);

              if (comparison.isSemanticRewrite) {
                return {
                  safe: false,
                  reason: `D.4 Semantic rewrite detected in '${op.path}': ${comparison.reason}. Use apply_patch for targeted edits.`,
                  file: op.path,
                  changeRatio,
                };
              }

              // AST says it's safe (e.g., just formatting or comments)
              console.log(`[D.4] ${op.path}: Line count ${(changeRatio * 100).toFixed(1)}% but AST similarity ${(comparison.similarityScore * 100).toFixed(1)}% — allowing`);
            } catch (e: any) {
              // AST parse failed, fall back to line count
              console.warn(`[D.4] AST analysis failed for ${op.path}: ${e.message} — using line count`);
              return {
                safe: false,
                reason: `File '${op.path}' has ${Math.round(changeRatio * 100)}% change (max ${Math.round(GENERAL_FILE_MAX_CHANGE * 100)}%). Use apply_patch for targeted edits.`,
                file: op.path,
                changeRatio,
              };
            }
          } else {
            // No analyzer or not TypeScript file — use line count
            return {
              safe: false,
              reason: `File '${op.path}' has ${Math.round(changeRatio * 100)}% change (max ${Math.round(GENERAL_FILE_MAX_CHANGE * 100)}%). Use apply_patch for targeted edits.`,
              file: op.path,
              changeRatio,
            };
          }
        }
      }
    }

    return { safe: true };
  }

  private async updateSessionStatus(
    sessionId: string,
    status: SessionStatus
  ): Promise<void> {
    try {
      const session = await this.sessionManager.getSession(sessionId);
      if (session) {
        await this.sessionManager.updateSession({
          ...session,
          status,
          updatedAt: new Date().toISOString()
        });
      }
    } catch (error: any) {
      console.warn(`[SafePatchExecutor] Failed to update session status: ${error.message}`);
    }
  }
}
