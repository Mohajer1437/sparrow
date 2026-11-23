import { SessionStore } from '../../contracts/session-store';
import { FileSessionStore } from '../../contracts/file-session-store';
import { ExecutionSession, ExecutionSessionInput, ExecutionStep, DecisionRecord, StepState } from '../../domain/session';
import { randomUUID } from 'crypto';

export class SessionManagerExtended {
  constructor(
    private readonly legacyStore: SessionStore,
    private readonly fileStore: FileSessionStore
  ) {}

  async startSession(input: ExecutionSessionInput): Promise<ExecutionSession | null> {
    const now = new Date().toISOString();
    const session: ExecutionSession = {
      ...input,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      steps: input.steps || [],
      decisions: input.decisions || [],
    };

    const success = await this.fileStore.save(session);
    return success ? session : null;
  }

  async updateStepStatus(
    sessionId: string,
    stepId: string,
    state: StepState,
    options?: {
      error?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<ExecutionSession | null> {
    const session = await this.fileStore.load(sessionId);
    if (!session) return null;

    const now = new Date().toISOString();
    const updatedSteps = session.steps.map(step => {
      if (step.id !== stepId) return step;
      
      const updatedStep: ExecutionStep = {
        ...step,
        state,
        ...(state === 'running' && !step.startedAt ? { startedAt: now } : {}),
        ...((state === 'completed' || state === 'failed' || state === 'skipped') && !step.completedAt 
          ? { completedAt: now } 
          : {}),
        ...(options?.error ? { error: options.error } : {}),
        ...(options?.metadata ? { metadata: { ...step.metadata, ...options.metadata } } : {}),
      };
      
      return updatedStep;
    });

    const updatedSession: ExecutionSession = {
      ...session,
      steps: updatedSteps,
      updatedAt: now,
      ...(state === 'failed' ? { failedStepId: stepId, status: 'failed' } : {}),
    };

    const success = await this.fileStore.update(updatedSession);
    return success ? updatedSession : null;
  }

  async addDecision(
    sessionId: string,
    decision: Omit<DecisionRecord, 'id' | 'timestamp'>
  ): Promise<ExecutionSession | null> {
    const session = await this.fileStore.load(sessionId);
    if (!session) return null;

    const newDecision: DecisionRecord = {
      ...decision,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    const updatedSession: ExecutionSession = {
      ...session,
      decisions: [...session.decisions, newDecision],
      updatedAt: new Date().toISOString(),
    };

    const success = await this.fileStore.update(updatedSession);
    return success ? updatedSession : null;
  }

  async completeSession(sessionId: string): Promise<ExecutionSession | null> {
    const session = await this.fileStore.load(sessionId);
    if (!session) return null;

    const updatedSession: ExecutionSession = {
      ...session,
      status: 'completed',
      updatedAt: new Date().toISOString(),
    };

    const success = await this.fileStore.update(updatedSession);
    return success ? updatedSession : null;
  }

  async failSession(sessionId: string, error: string, failedStepId?: string): Promise<ExecutionSession | null> {
    const session = await this.fileStore.load(sessionId);
    if (!session) return null;

    const updatedSession: ExecutionSession = {
      ...session,
      status: 'failed',
      error,
      failedStepId,
      updatedAt: new Date().toISOString(),
    };

    const success = await this.fileStore.update(updatedSession);
    return success ? updatedSession : null;
  }

  async pauseSession(sessionId: string): Promise<ExecutionSession | null> {
    const session = await this.fileStore.load(sessionId);
    if (!session) return null;

    const updatedSession: ExecutionSession = {
      ...session,
      status: 'paused',
      updatedAt: new Date().toISOString(),
    };

    const success = await this.fileStore.update(updatedSession);
    return success ? updatedSession : null;
  }

  async resumeSession(sessionId: string): Promise<ExecutionSession | null> {
    const session = await this.fileStore.load(sessionId);
    if (!session) return null;

    if (session.status !== 'paused' && session.status !== 'failed') {
      console.warn(`[SessionManager] Cannot resume session ${sessionId} with status ${session.status}`);
      return null;
    }

    const updatedSession: ExecutionSession = {
      ...session,
      status: 'running',
      updatedAt: new Date().toISOString(),
    };

    const success = await this.fileStore.update(updatedSession);
    return success ? updatedSession : null;
  }

  async loadSession(sessionId: string): Promise<ExecutionSession | null> {
    return await this.fileStore.load(sessionId);
  }

  async listSessions(workspace: string): Promise<ReadonlyArray<ExecutionSession>> {
    return await this.fileStore.list(workspace);
  }

  async findUnfinishedSessions(workspace: string): Promise<ReadonlyArray<ExecutionSession>> {
    const all = await this.fileStore.list(workspace);
    return all.filter(s => s.status === 'paused' || s.status === 'failed');
  }
}
