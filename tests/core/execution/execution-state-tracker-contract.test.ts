import { ExecutionStateTracker } from '../../../src/core/execution/execution-state-tracker';
import type { IExecutionStateTracker } from '../../../src/contracts/execution-state-tracker';
import type { RuntimeRepository } from '../../../src/contracts/runtime-repository';

describe('ExecutionStateTracker Contract Compliance', () => {
  it('ExecutionStateTracker implements IExecutionStateTracker interface', () => {
    const mockRepo: RuntimeRepository = {
      exists: jest.fn().mockResolvedValue(false),
      readFile: jest.fn().mockResolvedValue(''),
      writeFile: jest.fn().mockResolvedValue(undefined),
      appendFeedbackCandidates: jest.fn().mockResolvedValue(undefined),
      saveHealingKnowledge: jest.fn().mockResolvedValue(undefined),
      loadHealingKnowledge: jest.fn().mockResolvedValue(null),
      deleteHealingKnowledge: jest.fn().mockResolvedValue(undefined),
    } as any;

    const tracker = new ExecutionStateTracker(mockRepo);

    // TypeScript compile-time check: tracker is assignable to interface
    const asInterface: IExecutionStateTracker = tracker;
    expect(asInterface).toBe(tracker);

    // Runtime check: all interface methods exist and are functions
    expect(typeof tracker.capturePreExecutionState).toBe('function');
    expect(typeof tracker.capturePostExecutionState).toBe('function');
    expect(typeof tracker.compareStates).toBe('function');
  });

  it('capturePreExecutionState returns PreExecutionState shape', async () => {
    const mockRepo: RuntimeRepository = {
      exists: jest.fn().mockResolvedValue(false),
      readFile: jest.fn().mockResolvedValue(''),
      writeFile: jest.fn().mockResolvedValue(undefined),
      appendFeedbackCandidates: jest.fn().mockResolvedValue(undefined),
      saveHealingKnowledge: jest.fn().mockResolvedValue(undefined),
      loadHealingKnowledge: jest.fn().mockResolvedValue(null),
      deleteHealingKnowledge: jest.fn().mockResolvedValue(undefined),
    } as any;

    const tracker: IExecutionStateTracker = new ExecutionStateTracker(mockRepo);
    const preState = await tracker.capturePreExecutionState('sess-1', 'test task', ['file1.ts']);

    expect(preState.sessionId).toBe('sess-1');
    expect(preState.task).toBe('test task');
    expect(Array.isArray(preState.plannedFiles)).toBe(true);
    expect(Array.isArray(preState.fileStates)).toBe(true);
    expect(typeof preState.capturedAt).toBe('string');
  });

  it('compareStates returns StateComparison shape', async () => {
    const mockRepo: RuntimeRepository = {
      exists: jest.fn().mockResolvedValue(false),
      readFile: jest.fn().mockResolvedValue(''),
      writeFile: jest.fn().mockResolvedValue(undefined),
      appendFeedbackCandidates: jest.fn().mockResolvedValue(undefined),
      saveHealingKnowledge: jest.fn().mockResolvedValue(undefined),
      loadHealingKnowledge: jest.fn().mockResolvedValue(null),
      deleteHealingKnowledge: jest.fn().mockResolvedValue(undefined),
    } as any;

    const tracker: IExecutionStateTracker = new ExecutionStateTracker(mockRepo);

    const preState = await tracker.capturePreExecutionState('sess-1', 'test', ['file1.ts']);
    const postState = await tracker.capturePostExecutionState('sess-1', preState, ['file1.ts']);
    const comparison = tracker.compareStates(preState, postState);

    expect(Array.isArray(comparison.filesModified)).toBe(true);
    expect(Array.isArray(comparison.filesCreated)).toBe(true);
    expect(Array.isArray(comparison.filesDeleted)).toBe(true);
    expect(Array.isArray(comparison.unexpectedChanges)).toBe(true);
    expect(typeof comparison.hasUnexpectedChanges).toBe('boolean');
  });
});
