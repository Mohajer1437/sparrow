import { ProjectDiscoveryService } from '../discovery/project-discovery-service';
import { ContextEngine } from '../../contracts/context';
import { Session } from '../../contracts/session';
import { TaskExecutor } from '../execution/task-executor';
import { TaskPlanner } from '../../contracts/task-planner';
import { ConversationTurn, ConversationResponse } from '../../domain/conversation-turn';
import { Message } from '../../domain/message';
import { formatExecutionPlan } from '../../domain/execution-plan';
import { ExecutionLogger } from '../observability/execution-logger';

export class ConversationOrchestrator {
  constructor(
    private readonly discovery: ProjectDiscoveryService,
    private readonly contextEngine: ContextEngine,
    private readonly session: Session,
    private readonly taskExecutor: TaskExecutor,
    private readonly taskPlanner?: TaskPlanner
  ) {}

  async handleTurn(turn: ConversationTurn): Promise<ConversationResponse> {
    const snapshot = await this.discovery.discover();
    ExecutionLogger.log('CONVERSATION', '-', turn.model, `Turn started: "${turn.message?.substring(0, 60)}"`);

    let context = await this.contextEngine.buildContext({
      task: turn.message,
      snapshot: snapshot,
      signal: turn.signal
    });

    if (this.taskPlanner && turn.planningEnabled !== false) {
      context = await this.enrichContextWithPlan(turn, context);
    }

    const userMessage: Message = { role: 'user', content: turn.message };
    await this.session.appendMessage(turn.sessionId, userMessage);

    const updatedHistory = await this.session.getHistory(turn.sessionId);

    const response = await this.taskExecutor.execute({
      sessionId: turn.sessionId,
      context,
      role: turn.role,
      providerId: turn.providerId,
      model: turn.model,
      history: updatedHistory,
      tools: turn.tools,
      signal: turn.signal
    });

    const assistantMessage: Message = { role: 'assistant', content: response.content };
    await this.session.appendMessage(turn.sessionId, assistantMessage);

    return {
      content: response.content,
      usage: response.usage,
      metadata: response.metadata
    };
  }

  private async enrichContextWithPlan(turn: ConversationTurn, context: any): Promise<any> {
    if (!this.taskPlanner) return context;

    try {
      const availableTools = (turn.tools ?? []).map(t => t.name);
      const plan = await this.taskPlanner.plan({
        task: turn.message,
        availableTools,
        providerId: turn.providerId,
        model: turn.model,
        signal: turn.signal,
      });

      if (!plan) return context;

      const planAsText = formatExecutionPlan(plan);
      return {
        ...context,
        knowledge: [
          ...(context.knowledge ?? []),
          { id: 'execution-plan', content: planAsText, filePath: 'plan://execution' },
        ],
        metadata: {
          ...(context.metadata ?? {}),
          planId: plan.id,
          planComplexity: plan.complexity,
          planStepsCount: String(plan.steps.length),
        },
      };
    } catch (error: any) {
      console.warn(
        `[ConversationOrchestrator] Planning failed, continuing without plan. Error: ${error.message}`
      );
      return context;
    }
  }
}
