import {
  canTransition,
  assertTransition,
  IllegalExecutionTransitionError,
  createInitialFinalTruth,
  transitionFinalTruth,
  canDeclareCompleted,
  isHeartbeatExpired,
  heartbeatFinalTruth,
} from '../../src/domain/final-truth';

describe('FinalTruth state machine', () => {
  it('allows happy-path consecutive transitions', () => {
    expect(canTransition('PLANNING', 'CONTEXT')).toBe(true);
    expect(canTransition('CONTEXT', 'EXECUTION')).toBe(true);
    expect(canTransition('EXECUTION', 'VERIFICATION')).toBe(true);
    expect(canTransition('VERIFICATION', 'ACCEPTANCE')).toBe(true);
    expect(canTransition('ACCEPTANCE', 'COMPLETED')).toBe(true);
  });

  it('rejects COMPLETED -> EXECUTION', () => {
    expect(canTransition('COMPLETED', 'EXECUTION')).toBe(false);
    expect(() => assertTransition('COMPLETED', 'EXECUTION')).toThrow(IllegalExecutionTransitionError);
  });

  it('allows any non-terminal to FAILED/INTERRUPTED', () => {
    expect(canTransition('EXECUTION', 'FAILED')).toBe(true);
    expect(canTransition('VERIFICATION', 'INTERRUPTED')).toBe(true);
  });

  it('allows INTERRUPTED -> EXECUTION resume', () => {
    expect(canTransition('INTERRUPTED', 'EXECUTION')).toBe(true);
  });

  it('createInitial starts at PLANNING without FAILED outcome seed', () => {
    const truth = createInitialFinalTruth({ runId: 'r1', taskId: 't1' });
    expect(truth.status).toBe('PLANNING');
    expect(truth.verificationStatus).toBe('NOT_RUN');
    expect(truth.mutationStatus).toBe('NONE');
  });

  it('canDeclareCompleted forbids SKIPPED verification', () => {
    let truth = createInitialFinalTruth({ runId: 'r1', taskId: 't1' });
    truth = transitionFinalTruth(truth, 'CONTEXT');
    truth = transitionFinalTruth(truth, 'EXECUTION');
    truth = transitionFinalTruth(truth, 'VERIFICATION', { verificationStatus: 'SKIPPED' });
    truth = transitionFinalTruth(truth, 'ACCEPTANCE', { verificationStatus: 'SKIPPED' });
    expect(canDeclareCompleted(truth)).toBe(false);
  });

  it('canDeclareCompleted allows PASSED', () => {
    let truth = createInitialFinalTruth({ runId: 'r1', taskId: 't1' });
    truth = transitionFinalTruth(truth, 'CONTEXT');
    truth = transitionFinalTruth(truth, 'EXECUTION');
    truth = transitionFinalTruth(truth, 'VERIFICATION', { verificationStatus: 'PASSED', mutationStatus: 'APPLIED' });
    truth = transitionFinalTruth(truth, 'ACCEPTANCE', { verificationStatus: 'PASSED' });
    expect(canDeclareCompleted(truth)).toBe(true);
  });

  it('detects expired heartbeat', () => {
    let truth = createInitialFinalTruth({ runId: 'r1', taskId: 't1', now: '2020-01-01T00:00:00.000Z' });
    expect(isHeartbeatExpired(truth, Date.parse('2020-01-01T01:00:00.000Z'), 15 * 60 * 1000)).toBe(true);
    truth = heartbeatFinalTruth(truth, { now: '2020-01-01T00:50:00.000Z' });
    expect(isHeartbeatExpired(truth, Date.parse('2020-01-01T00:55:00.000Z'), 15 * 60 * 1000)).toBe(false);
  });
});