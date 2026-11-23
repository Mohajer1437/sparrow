import { PostExecutionPipeline } from '../../contracts/post-execution-pipeline';
import { KnowledgeFeedbackEngine } from '../../contracts/knowledge-feedback-engine';
import { RuntimeRepository } from '../../contracts/runtime-repository';
import { WorkflowResult } from '../../contracts/workflow-orchestrator';
import { WorkspaceMemoryRepository } from '../../contracts/workspace-memory-repository';
import { RoleMemoryRepository } from '../../contracts/role-memory-repository';
import { SharedMemoryEntry, RoleMemoryEntry } from '../../domain/role-memory';
import { ExecutionLogger } from '../observability/execution-logger';

export class DefaultPostExecutionPipeline implements PostExecutionPipeline {
  constructor(
    private readonly knowledgeFeedbackEngine: KnowledgeFeedbackEngine,
    private readonly runtimeRepository: RuntimeRepository,
    private readonly workspaceMemoryRepository?: WorkspaceMemoryRepository,
    private readonly roleMemoryRepository?: RoleMemoryRepository,
    private readonly roleId?: string
  ) {}

  async execute(result: WorkflowResult): Promise<void> {
    try {
      const candidates = await this.knowledgeFeedbackEngine.analyze(result);

      if (candidates.length > 0) {
        await this.runtimeRepository.appendFeedbackCandidates(candidates);
        ExecutionLogger.log('PIPELINE', '-', '-', `Knowledge feedback: ${candidates.length} candidate(s) saved`);

        // Save to shared memory (WorkspaceMemoryRepository)
        if (this.workspaceMemoryRepository) {
          try {
            const existing = await this.workspaceMemoryRepository.load();
            const newEntries: SharedMemoryEntry[] = candidates.map(c => Object.freeze({
              id: c.id,
              content: `[${c.type}] ${c.title}: ${c.content}`,
              category: c.type.toLowerCase(),
              createdAt: c.generatedAt,
            }));
            await this.workspaceMemoryRepository.save([...existing, ...newEntries]);
            ExecutionLogger.log('MEMORY', '-', '-', `Shared memory updated: ${newEntries.length} entries added`);
          } catch (e: any) {
            console.warn(`[PostExecutionPipeline] Shared memory save failed: ${e.message}`);
          }
        }

        // Save to role memory (RoleMemoryRepository)
        if (this.roleMemoryRepository && this.roleId) {
          try {
            const existing = await this.roleMemoryRepository.load(this.roleId);
            const newEntries: RoleMemoryEntry[] = candidates.map(c => Object.freeze({
              id: c.id,
              roleId: this.roleId!,
              content: `[${c.type}] ${c.title}: ${c.content}`,
              category: c.type.toLowerCase(),
              createdAt: c.generatedAt,
            }));
            await this.roleMemoryRepository.save(this.roleId, [...existing, ...newEntries]);
            ExecutionLogger.log('MEMORY', '-', '-', `Role memory (${this.roleId}) updated: ${newEntries.length} entries added`);
          } catch (e: any) {
            console.warn(`[PostExecutionPipeline] Role memory save failed: ${e.message}`);
          }
        }
      }
    } catch (error: any) {
      console.warn(`[PostExecutionPipeline] Failed: ${error.message}`);
    }
  }
}
