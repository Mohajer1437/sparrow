import { TaskExecutor } from '../../execution/task-executor';
import { KnowledgeRole } from '../knowledge-role';
import { ToolDefinition } from '../../../contracts/provider';
import { KnownProviders } from '../../../domain/provider-id';
import { extractJsonFromResponse } from '../utils/json-validator';
import { KNOWLEDGE_BASE_PROMPT } from '../prompts/knowledge-base-prompt';
import { RetryExecutor } from '../utils/retry-executor';

export interface KnowledgeBase {
  meta: {
    project_name: string;
    version: string;
    last_updated: string;
    description: string;
    generation_mode?: 'full' | 'incremental';
  };
  project_context: {
    tech_stack: string[];
    current_state: {
      project_nature: string;
      architecture_overview: string;
      recent_focus: string;
    };
    environment_quirks: string[];
  };
  domain_contexts: Array<{
    module_name: string;
    core_concepts: string[];
    summary: string;
  }>;
  knowledge_base: {
    strict_rules: Array<{ id: string; category: string; rule: string; reason: string }>;
    successful_patterns: Array<{ id: string; context: string; approach: string; why_it_works: string; code_snippet?: string }>;
    failed_patterns: Array<{ id: string; context: string; bad_approach: string; why_it_failed: string; correct_approach: string }>;
    bug_fixes: Array<{ id: string; bug_description: string; root_cause: string; fix_applied: string; prevention_tip: string }>;
  };
}

export class KnowledgeBaseStage {
  private retryExecutor = new RetryExecutor();

  constructor(
    private readonly taskExecutor: TaskExecutor,
    private readonly tools: ReadonlyArray<ToolDefinition>,
    private readonly model: string = 'qwen3-32b'
  ) {}

  /**
   * Truncate existing knowledge if too large (prevent Ollama 500)
   */
  private truncateIfNeeded(existingKnowledge: string, maxLength: number = 8000): string {
    if (existingKnowledge.length <= maxLength) {
      return existingKnowledge;
    }
    
    console.log(`   [Stage 3] ⚠️  Existing knowledge too large (${existingKnowledge.length} chars), truncating to ${maxLength}`);
    
    // Try to parse and keep only most recent entries
    try {
      const parsed = JSON.parse(existingKnowledge);
      // Keep meta and project_context, limit other arrays
      if (parsed.knowledge_base) {
        if (parsed.knowledge_base.strict_rules?.length > 10) {
          parsed.knowledge_base.strict_rules = parsed.knowledge_base.strict_rules.slice(0, 10);
        }
        if (parsed.knowledge_base.successful_patterns?.length > 10) {
          parsed.knowledge_base.successful_patterns = parsed.knowledge_base.successful_patterns.slice(0, 10);
        }
        if (parsed.knowledge_base.failed_patterns?.length > 10) {
          parsed.knowledge_base.failed_patterns = parsed.knowledge_base.failed_patterns.slice(0, 10);
        }
        if (parsed.knowledge_base.bug_fixes?.length > 10) {
          parsed.knowledge_base.bug_fixes = parsed.knowledge_base.bug_fixes.slice(0, 10);
        }
      }
      if (parsed.domain_contexts?.length > 5) {
        parsed.domain_contexts = parsed.domain_contexts.slice(0, 5);
      }
      return JSON.stringify(parsed, null, 2);
    } catch {
      // Fallback: simple truncation
      return existingKnowledge.substring(0, maxLength) + '\n... (truncated)';
    }
  }

  async execute(existingKnowledge?: string): Promise<KnowledgeBase> {
    const mode = existingKnowledge ? 'incremental' : 'full';
    console.log(`   [Stage 3] 🔄 Starting knowledge base generation (${mode} mode)`);
    if (existingKnowledge) {
      const existingLength = existingKnowledge.length;
      console.log(`   [Stage 3] 📖 Existing knowledge: ${existingLength} chars`);
      // Verify it's valid JSON
      try {
        const parsed = JSON.parse(existingKnowledge);
        console.log(`   [Stage 3] ✅ Existing knowledge valid (version: ${parsed.meta?.version || 'unknown'})`);
      } catch (e) {
        console.log(`   [Stage 3] ⚠️  Existing knowledge invalid JSON, starting fresh`);
        existingKnowledge = undefined;
      }
    }
    console.log(`   [Stage 3] 🔄 Starting sparrow exploration...`);
    const startTime = Date.now();

    const truncatedKnowledge = existingKnowledge
      ? this.truncateIfNeeded(existingKnowledge)
      : undefined;

    const contextPart = truncatedKnowledge
      ? `\n\nEXISTING KNOWLEDGE BASE (merge with new insights):\n${truncatedKnowledge}`
      : '\n\nNo existing knowledge base found. Start fresh.';

    let attemptNumber = 0;

    const parsed = await this.retryExecutor.executeWithRetry(async () => {
      attemptNumber++;

      const reinforcement = attemptNumber > 1
        ? `\n\nCRITICAL: You MUST output ONLY valid JSON. No markdown, no explanations.`
        : '';

      const response = await this.taskExecutor.execute({
        context: {
          taskIntent: `${KNOWLEDGE_BASE_PROMPT}${contextPart}\n\nIMPORTANT: First explore the project using tools, examine current state, then output ONLY valid JSON matching the schema.${reinforcement}`,
          rules: [],
          knowledge: [],
          memories: [],
          files: []
        },
        role: new KnowledgeRole(),
        providerId: KnownProviders.OLLAMA,
        model: this.model,
        tools: this.tools,
        history: []
      });

      const content = response.content || '';
      const result = extractJsonFromResponse<KnowledgeBase>(content);

      if (!result) {
        if (attemptNumber < 3) {
          await this.retryExecutor.saveDebugLog(
            'knowledge_base',
            attemptNumber,
            content,
            new Error('JSON parse failed')
          );
        }
        throw new Error('Failed to parse knowledge base JSON');
      }

      return result;
    }, {
      maxAttempts: 3,
      backoffMs: 3000,  // Longer backoff for Ollama 500 errors
      shouldRetry: (error) => RetryExecutor.isTransientError(error),
      onRetry: (attempt, error, delay) => {
        const isOllama500 = error?.message?.includes('500');
        const icon = isOllama500 ? '🔥' : '⚠️';
        console.log(`   [Stage 3] ${icon} ${error.message} (attempt ${attempt}/3), retrying in ${Math.round(delay/1000)}s...`);
      }
    });

    const duration = Date.now() - startTime;
    console.log(`   [Stage 3] ⏱️  ${Math.round(duration/1000)}s, ${attemptNumber} attempt${attemptNumber > 1 ? 's' : ''}`);

    parsed.meta.generation_mode = existingKnowledge ? 'incremental' : 'full';
    console.log(`   [Stage 3] ✅ Parsed: version ${parsed.meta?.version || 'unknown'}`);
    return parsed;
  }
}
