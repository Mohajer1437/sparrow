import { DefaultReflectionEngine } from '../../../src/core/reflection/default-reflection-engine';
import { WorkspaceSession } from '../../../src/domain/workspace-session';

describe('DefaultReflectionEngine', () => {
  const engine = new DefaultReflectionEngine();

  const createMockSession = (overrides: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
    id: 'sess-1',
    workspacePath: '/test/workspace',
    task: 'Test task',
    plan: null,
    status: 'completed',
    currentStep: 2,
    totalSteps: 3,
    events: [
      { id: '1', type: 'TOOL_EXECUTED', message: 'tool', timestamp: '', metadata: { toolName: 'read_file' } },
      { id: '2', type: 'VALIDATION_STARTED', message: 'val', timestamp: '' },
      { id: '3', type: 'VALIDATION_PASSED', message: 'val', timestamp: '' },
    ],
    createdAt: '',
    updatedAt: '',
    modifiedFiles: ['src/a.ts'],
    retryHistory: [{ attempt: 1, timestamp: '', action: 'retry', error: 'err' }],
    ...overrides,
  } as WorkspaceSession);

  it('generates a successful reflection', () => {
    const session = createMockSession();
    const reflection = engine.generate(session);

    expect(reflection.executionOutcome).toBe('success');
    expect(reflection.toolsUsed).toContain('read_file');
    expect(reflection.verificationExecuted).toBe(true);
    expect(reflection.verificationPassed).toBe(true);
    expect(reflection.retriesRequired).toBe(1);
    expect(reflection.summary).toContain('Outcome: success');
  });

  it('generates a failed reflection with rollback', () => {
    const session = createMockSession({
      status: 'rolled_back',
      events: [
        { id: '1', type: 'ROLLBACK_COMPLETED', message: 'rb', timestamp: '' },
      ],
    });
    const reflection = engine.generate(session);

    expect(reflection.executionOutcome).toBe('rolled_back');
    expect(reflection.rollbackPerformed).toBe(true);
    expect(reflection.verificationExecuted).toBe(false);
  });

  it('handles undefined modifiedFiles gracefully', () => {
    const session = createMockSession({ modifiedFiles: undefined });
    const reflection = engine.generate(session);

    expect(reflection.filesModified).toEqual([]);
    expect(reflection.summary).not.toContain('Files modified');
  });
});

// ============================================================
// Phase A: Strict Reflection Tests (added by patch 56)
// ============================================================
describe('DefaultReflectionEngine — Phase A strict logic', () => {
  const engine = new DefaultReflectionEngine();

  const makeEvent = (type: string, metadata?: Record<string, any>) => ({
    id: 'e-' + Math.random(),
    type: type as any,
    message: '',
    metadata,
    timestamp: new Date().toISOString(),
  });

  const makeSession = (overrides: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
    id: 'sess-1',
    workspacePath: '/tmp/ws',
    task: 'Test task',
    plan: null,
    status: 'completed',
    currentStep: 3,
    totalSteps: 3,
    events: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as WorkspaceSession);

  it('reports success when all steps completed with no failures', () => {
    const session = makeSession({
      events: [
        makeEvent('STEP_STARTED'), makeEvent('STEP_COMPLETED'),
        makeEvent('STEP_STARTED'), makeEvent('STEP_COMPLETED'),
        makeEvent('STEP_STARTED'), makeEvent('STEP_COMPLETED'),
      ],
    });
    const r = engine.generate(session);
    expect(r.executionOutcome).toBe('success');
    expect(r.stepFailureCount).toBe(0);
    expect(r.stepsStarted).toBe(3);
  });

  it('reports partial_failure when some steps failed', () => {
    const session = makeSession({
      events: [
        makeEvent('STEP_STARTED'), makeEvent('STEP_COMPLETED'),
        makeEvent('STEP_STARTED'), makeEvent('STEP_FAILED'),
        makeEvent('STEP_STARTED'), makeEvent('STEP_COMPLETED'),
      ],
    });
    const r = engine.generate(session);
    expect(r.executionOutcome).toBe('partial_failure');
    expect(r.stepFailureCount).toBe(1);
    expect(r.stepsStarted).toBe(3);
  });

  it('reports failed when session.status is failed', () => {
    const session = makeSession({
      status: 'failed',
      events: [makeEvent('STEP_STARTED'), makeEvent('STEP_FAILED')],
    });
    const r = engine.generate(session);
    expect(r.executionOutcome).toBe('failed');
  });

  it('reports rolled_back when session.status is rolled_back', () => {
    const session = makeSession({
      status: 'rolled_back',
      events: [makeEvent('ROLLBACK_COMPLETED')],
    });
    const r = engine.generate(session);
    expect(r.executionOutcome).toBe('rolled_back');
  });

  it('counts tools used correctly (deduplicated)', () => {
    const session = makeSession({
      events: [
        makeEvent('TOOL_EXECUTED', { toolName: 'read_file' }),
        makeEvent('TOOL_EXECUTED', { toolName: 'write_file' }),
        makeEvent('TOOL_EXECUTED', { toolName: 'read_file' }),
      ],
    });
    const r = engine.generate(session);
    expect(r.toolsUsed).toContain('read_file');
    expect(r.toolsUsed).toContain('write_file');
    expect(r.toolsUsed.length).toBe(2);
  });
});

// ============================================================
// Phase B: Tool Failure Tracking Tests
// ============================================================
describe('DefaultReflectionEngine — Phase B tool failure tracking', () => {
  const engine = new DefaultReflectionEngine();

  const makeEvent = (type: string, metadata?: Record<string, any>) => ({
    id: 'e-' + Math.random(),
    type: type as any,
    message: '',
    metadata,
    timestamp: new Date().toISOString(),
  });

  const makeSession = (overrides: Partial<any> = {}): any => ({
    id: 'sess-b1',
    workspacePath: '/tmp/ws',
    task: 'Test task',
    plan: null,
    status: 'completed',
    currentStep: 2,
    totalSteps: 2,
    events: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  it('counts tool successes and failures correctly', () => {
    const session = makeSession({
      events: [
        makeEvent('STEP_STARTED'), makeEvent('STEP_COMPLETED'),
        makeEvent('TOOL_EXECUTED', { toolName: 'read_file', success: true }),
        makeEvent('TOOL_EXECUTED', { toolName: 'write_file', success: true }),
        makeEvent('TOOL_EXECUTED', { toolName: 'apply_patch', success: false }),
      ],
    });
    const r = engine.generate(session);
    expect(r.toolSuccessCount).toBe(2);
    expect(r.toolFailureCount).toBe(1);
  });

  it('detects silent failure masking', () => {
    const events: any[] = [];
    for (let i = 0; i < 5; i++) {
      events.push(makeEvent('STEP_STARTED'));
      events.push(makeEvent('STEP_COMPLETED'));
    }
    for (let i = 0; i < 7; i++) {
      events.push(makeEvent('TOOL_EXECUTED', { toolName: `tool${i}`, success: true }));
    }
    for (let i = 0; i < 3; i++) {
      events.push(makeEvent('TOOL_EXECUTED', { toolName: `fail${i}`, success: false }));
    }
    
    const session = makeSession({ currentStep: 5, totalSteps: 5, events });
    const r = engine.generate(session);
    expect(r.executionOutcome).toBe('partial_failure');
    expect(r.toolFailureCount).toBe(3);
  });

  it('does not false-positive on low failure rate', () => {
    const events: any[] = [];
    for (let i = 0; i < 3; i++) {
      events.push(makeEvent('STEP_STARTED'));
      events.push(makeEvent('STEP_COMPLETED'));
    }
    for (let i = 0; i < 19; i++) {
      events.push(makeEvent('TOOL_EXECUTED', { toolName: `tool${i}`, success: true }));
    }
    events.push(makeEvent('TOOL_EXECUTED', { toolName: 'one_fail', success: false }));
    
    const session = makeSession({ currentStep: 3, totalSteps: 3, events });
    const r = engine.generate(session);
    expect(r.executionOutcome).toBe('success');
  });

  it('reports success when no tool failures', () => {
    const events = [
      makeEvent('STEP_STARTED'), makeEvent('STEP_COMPLETED'),
      makeEvent('TOOL_EXECUTED', { toolName: 'a', success: true }),
      makeEvent('TOOL_EXECUTED', { toolName: 'b', success: true }),
    ];
    const session = makeSession({ events, currentStep: 1, totalSteps: 1 });
    const r = engine.generate(session);
    expect(r.executionOutcome).toBe('success');
    expect(r.toolFailureCount).toBe(0);
  });
});
