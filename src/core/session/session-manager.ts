import { SessionStore } from '../../contracts/session-store';
import {
  WorkspaceSession,
  SessionEvent,
  SessionEventType,
  isTerminal,
  RetryAttempt,
} from '../../domain/workspace-session';
import { ExecutionPlan } from '../../domain/execution-plan';
import { randomUUID } from 'crypto';

import { Reflection } from '../../domain/reflection';
import { Decision } from '../../domain/decision';

export class SessionManager {
  constructor(
    private readonly store: SessionStore,
    private readonly workspacePath: string
  ) {}

  async startSession(task: string, plan: ExecutionPlan | null): Promise<string | null> {
    try {
      const id = this.generateId();
      const now = new Date().toISOString();

      const session: WorkspaceSession = Object.freeze({
        id,
        workspacePath: this.workspacePath,
        task,
        plan,
        status: 'created',
        currentStep: 0,
        totalSteps: plan?.steps.length ?? 0,
        events: Object.freeze([]),
        createdAt: now,
        updatedAt: now,
        modifiedFiles: Object.freeze([]),
      });

      await this.store.create(session);
      await this.recordEvent(id, 'SESSION_CREATED', `Session started for: ${task}`);
      if (plan) {
        await this.recordEvent(id, 'PLAN_CREATED', `Plan created with ${plan.steps.length} steps`, {
          complexity: plan.complexity,
          planId: plan.id,
        });
      }

      return id;
    } catch (error: any) {
      console.warn(`[SessionManager] startSession failed: ${error.message}`);
      return null;
    }
  }

  async recordStepStarted(sessionId: string, stepId: string, description: string): Promise<void> {
    try {
      const session = await this.store.get(sessionId);
      if (!session || isTerminal(session.status)) return;

      await this.store.update(sessionId, {
        status: 'executing',
        currentStep: session.currentStep + 1,
      });

      await this.recordEvent(sessionId, 'STEP_STARTED', `[${stepId}] ${description}`);
    } catch (error: any) {
      console.warn(`[SessionManager] recordStepStarted failed: ${error.message}`);
    }
  }

  async recordStepCompleted(sessionId: string, stepId: string, outcome: string): Promise<void> {
    try {
      const session = await this.store.get(sessionId);
      if (session && !isTerminal(session.status)) {
        await this.store.update(sessionId, {
          currentStep: session.currentStep,
        });
      }
    } catch (error: any) {
      console.warn(`[SessionManager] recordStepCompleted update failed: ${error.message}`);
    }
    try {
      await this.recordEvent(sessionId, 'STEP_COMPLETED', `[${stepId}] ${outcome}`);
    } catch (error: any) {
      console.warn(`[SessionManager] recordStepCompleted failed: ${error.message}`);
    }
  }

  async recordStepFailed(sessionId: string, stepId: string, reason: string): Promise<void> {
    try {
      const session = await this.store.get(sessionId);
      if (session && !isTerminal(session.status)) {
        await this.store.update(sessionId, {
          currentStep: session.currentStep,
        });
      }
    } catch (error: any) {
      console.warn(`[SessionManager] recordStepFailed update failed: ${error.message}`);
    }
    try {
      await this.recordEvent(sessionId, 'STEP_FAILED', `[${stepId}] ${reason}`);
    } catch (error: any) {
      console.warn(`[SessionManager] recordStepFailed failed: ${error.message}`);
    }
  }

  async recordToolExecuted(
    sessionId: string,
    toolName: string,
    success: boolean,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.recordEvent(sessionId, 'TOOL_EXECUTED', `Tool: ${toolName} (${success ? 'ok' : 'fail'})`, metadata);
    } catch (error: any) {
      console.warn(`[SessionManager] recordToolExecuted failed: ${error.message}`);
    }
  }

  async completeSession(sessionId: string, summary: string): Promise<void> {
    try {
      await this.store.update(sessionId, { status: 'completed' });
      await this.recordEvent(sessionId, 'SESSION_COMPLETED', summary);
    } catch (error: any) {
      console.warn(`[SessionManager] completeSession failed: ${error.message}`);
    }
  }

  async failSession(sessionId: string, reason: string): Promise<void> {
    try {
      await this.store.update(sessionId, { status: 'failed' });
      await this.recordEvent(sessionId, 'SESSION_FAILED', reason);
    } catch (error: any) {
      console.warn(`[SessionManager] failSession failed: ${error.message}`);
    }
  }

  async pauseSession(sessionId: string, reason: string): Promise<void> {
    try {
      await this.store.update(sessionId, { status: 'paused' });
      await this.recordEvent(sessionId, 'SESSION_PAUSED', reason);
    } catch (error: any) {
      console.warn(`[SessionManager] pauseSession failed: ${error.message}`);
    }
  }

  async resumeSession(sessionId: string): Promise<WorkspaceSession | null> {
    try {
      const session = await this.store.get(sessionId);
      if (!session) return null;

      if (isTerminal(session.status)) {
        console.warn(`[SessionManager] Cannot resume terminal session: ${session.status}`);
        return null;
      }

      await this.store.update(sessionId, { status: 'executing' });
      await this.recordEvent(sessionId, 'SESSION_RESUMED', `Resumed from step ${session.currentStep}`);

      return await this.store.get(sessionId);
    } catch (error: any) {
      console.warn(`[SessionManager] resumeSession failed: ${error.message}`);
      return null;
    }
  }

  async getSession(sessionId: string): Promise<WorkspaceSession | null> {
    try {
      return await this.store.get(sessionId);
    } catch (error: any) {
      console.warn(`[SessionManager] getSession failed: ${error.message}`);
      return null;
    }
  }

  async listSessions(): Promise<ReadonlyArray<WorkspaceSession>> {
    try {
      return await this.store.list(this.workspacePath);
    } catch (error: any) {
      console.warn(`[SessionManager] listSessions failed: ${error.message}`);
      return Object.freeze([]);
    }
  }

  /**
   * E.3: In-memory store for current step's expected files (scope restriction).
   * Set by StepExecutionEngine before each step, read by ApplyPatchTool.
   */
  private expectedFilesBySession: Map<string, ReadonlyArray<string>> = new Map();

  /** E.3: Set expected files for a session's current step */
  setExpectedFiles(sessionId: string, files: ReadonlyArray<string>): void {
    this.expectedFilesBySession.set(sessionId, files);
  }

  /** E.3: Get expected files for a session's current step */
  getExpectedFiles(sessionId: string): ReadonlyArray<string> | undefined {
    return this.expectedFilesBySession.get(sessionId);
  }

  /** E.3: Clear expected files (e.g., after session completes) */
  clearExpectedFiles(sessionId: string): void {
    this.expectedFilesBySession.delete(sessionId);
  }

  /**
   * R2.10: literal markers the current todo declared, extracted
   * deterministically from the task text. Read by the mutation guard to check
   * that the requested change actually landed.
   */
  private expectedMarkersBySession: Map<string, ReadonlyArray<string>> = new Map();

  setExpectedChangeMarkers(sessionId: string, markers: ReadonlyArray<string>): void {
    if (markers.length === 0) this.expectedMarkersBySession.delete(sessionId);
    else this.expectedMarkersBySession.set(sessionId, markers);
  }

  getExpectedChangeMarkers(sessionId: string): ReadonlyArray<string> | undefined {
    return this.expectedMarkersBySession.get(sessionId);
  }

  clearExpectedChangeMarkers(sessionId: string): void {
    this.expectedMarkersBySession.delete(sessionId);
  }

  async recordEvent(
    sessionId: string,
    type: SessionEventType,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const event: SessionEvent = Object.freeze({
      id: this.generateId(),
      type,
      message,
      metadata: metadata ? Object.freeze(metadata) : undefined,
      timestamp: new Date().toISOString(),
    });

    await this.store.update(sessionId, { events: [event] });
  }

  private generateId(): string {
    return randomUUID();
  }

  /**
   * R2.4 Hardening: Record a retry attempt for failure tracking
   */
  async addRetryAttempt(
    sessionId: string,
    attempt: RetryAttempt
  ): Promise<void> {
    const session = await this.store.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const existingRetries = session.retryHistory || [];
    const updatedSession: Partial<WorkspaceSession> = {
      retryHistory: [...existingRetries, attempt],
      updatedAt: new Date().toISOString()
    };

    await this.store.update(sessionId, updatedSession);

    await this.recordStructuredDecision(sessionId, {
      id: randomUUID(),
      type: 'RETRY_SCHEDULED',
      rationale: `Retry attempt ${attempt.attempt} scheduled due to error`,
      evidence: [attempt.error],
      timestamp: attempt.timestamp,
      source: 'runtime',
    });
  }


  /**
   * Load a session by ID (alias for getSession)
   */
  async loadSession(sessionId: string): Promise<WorkspaceSession | null> {
    return await this.getSession(sessionId);
  }


  /**
   * Update an existing session (full object replacement)
   */
  async updateSession(session: WorkspaceSession): Promise<void> {
    // Strip events to prevent duplication (store.update appends events)
    const { events, ...patch } = session;
    await this.store.update(session.id, patch);
  }


  /**
   * Find sessions that were interrupted (executing, validating, or failed)
   */
  async findUnfinishedSessions(): Promise<ReadonlyArray<WorkspaceSession>> {
    const all = await this.store.list(this.workspacePath);
    return all.filter(s =>
      s.status === 'executing' ||
      s.status === 'validating' ||
      s.status === 'failed'
    );
  }


  async recordReflection(sessionId: string, reflection: Reflection): Promise<void> {
    try {
      await this.store.update(sessionId, { reflection });
    } catch (error: any) {
      console.warn(`[SessionManager] recordReflection failed: ${error.message}`);
    }
  }

  async recordStructuredDecision(sessionId: string, decision: Decision): Promise<void> {
    try {
      const session = await this.store.get(sessionId);
      if (!session) return;
      const currentDecisions = session.decisions ?? [];
      await this.store.update(sessionId, { decisions: [...currentDecisions, decision] });
    } catch (error: any) {
      console.warn(`[SessionManager] recordStructuredDecision failed: ${error.message}`);
    }
  }

  async recordDecision(
    sessionId: string,
    decision: string,
    rationale: string
  ): Promise<void> {
    await this.recordEvent(sessionId, 'DECISION_MADE', decision, { rationale });
    await this.recordStructuredDecision(sessionId, {
      id: randomUUID(),
      type: 'GENERIC_RUNTIME_DECISION',
      rationale: `${decision}: ${rationale}`,
      evidence: [],
      timestamp: new Date().toISOString(),
      source: 'runtime',
    });
  }

}
