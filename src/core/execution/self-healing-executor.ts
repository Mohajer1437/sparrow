import { TaskExecutor } from './task-executor';
import { MicroTask } from '../../domain/micro-task';
import { SelfHealingConfig } from '../../domain/self-healing-config';
import { KnowledgeFeedbackEngine } from '../../contracts/knowledge-feedback-engine';
import { RuntimeRepository } from '../../contracts/runtime-repository';
import { ExecutionLogger } from '../observability/execution-logger';
import { ProviderId } from '../../domain/provider-id';

export interface SelfHealingResult {
  readonly success: boolean;
  readonly attempts: number;
  readonly escalated: boolean;
  readonly finalError?: string;
}

export class SelfHealingExecutor {
  constructor(
    private readonly taskExecutor: TaskExecutor,
    private readonly knowledgeFeedbackEngine: KnowledgeFeedbackEngine,
    private readonly runtimeRepository: RuntimeRepository,
  ) {}

  async executeWithHealing(
    sessionId: string,
    task: MicroTask,
    config: SelfHealingConfig,
    baseModelId: string,
    baseProviderId: ProviderId,
    executeTask: (modelId: string, providerId: ProviderId) => Promise<void>,
  ): Promise<SelfHealingResult> {
    if (!config.enabled) {
      try {
        await executeTask(baseModelId, baseProviderId);
        return { success: true, attempts: 1, escalated: false };
      } catch (error: any) {
        return { success: false, attempts: 1, escalated: false, finalError: error.message };
      }
    }

    let attempts = 0;
    let lastError = '';

    // Phase 1: Try with base model
    for (let i = 0; i < config.maxHealingAttempts; i++) {
      attempts++;
      try {
        await executeTask(baseModelId, baseProviderId);
        
        // Success: merge temp knowledge if enabled
        if (config.mergeOnSuccess) {
          await this.mergeTempKnowledge(sessionId, task.id);
        }
        
        ExecutionLogger.log('SELF_HEALING', '-', baseModelId, 
          `Task succeeded after ${attempts} attempt(s)`);
        
        return { success: true, attempts, escalated: false };
      } catch (error: any) {
        lastError = error.message;
        ExecutionLogger.log('SELF_HEALING', '-', baseModelId, 
          `Attempt ${attempts}/${config.maxHealingAttempts} failed: ${lastError.substring(0, 100)}`);
        
        // Save failure to temp knowledge
        await this.saveHealingKnowledge(sessionId, task.id, attempts, lastError);
      }
    }

    // Phase 2: Escalation to stronger model (if configured)
    if (config.escalationModelId && config.escalationProviderId) {
      attempts++;
      try {
        ExecutionLogger.log('SELF_HEALING', '-', config.escalationModelId, 
          `Escalating to stronger model after ${config.maxHealingAttempts} failures`);
        
        await executeTask(config.escalationModelId, config.escalationProviderId as ProviderId);
        
        if (config.mergeOnSuccess) {
          await this.mergeTempKnowledge(sessionId, task.id);
        }
        
        return { success: true, attempts, escalated: true };
      } catch (error: any) {
        lastError = error.message;
        ExecutionLogger.log('SELF_HEALING', '-', config.escalationModelId, 
          `Escalation failed: ${lastError.substring(0, 100)}`);
      }
    }

    // All attempts failed
    return { success: false, attempts, escalated: false, finalError: lastError };
  }

  private async saveHealingKnowledge(
    sessionId: string,
    taskId: string,
    attempt: number,
    errorLog: string,
  ): Promise<void> {
    const tempPath = `knowledge/temp/${sessionId}.json`;
    
    try {
      let existing: any = { sessionId, taskId, attempts: [] };
      
      if (await this.runtimeRepository.exists(tempPath)) {
        const raw = await this.runtimeRepository.readFile(tempPath);
        if (raw && raw.trim().length > 0) {
          existing = JSON.parse(raw);
        }
      }
      
      existing.attempts.push({
        attempt,
        errorLog: errorLog.substring(0, 2000),
        timestamp: new Date().toISOString(),
      });
      
      await this.runtimeRepository.writeFile(tempPath, JSON.stringify(existing, null, 2));
    } catch (error: any) {
      console.warn(`[SelfHealingExecutor] Failed to save temp knowledge: ${error.message}`);
    }
  }

  private async mergeTempKnowledge(sessionId: string, taskId: string): Promise<void> {
    const tempPath = `knowledge/temp/${sessionId}.json`;
    
    try {
      if (await this.runtimeRepository.exists(tempPath)) {
        // TODO: Implement merge logic to main knowledge base
        // For now, just mark as merged
        const raw = await this.runtimeRepository.readFile(tempPath);
        const data = JSON.parse(raw);
        data.mergedToMain = true;
        await this.runtimeRepository.writeFile(tempPath, JSON.stringify(data, null, 2));
        
        ExecutionLogger.log('SELF_HEALING', '-', '-', 
          `Temp knowledge for session ${sessionId} marked as merged`);
      }
    } catch (error: any) {
      console.warn(`[SelfHealingExecutor] Failed to merge temp knowledge: ${error.message}`);
    }
  }
}
