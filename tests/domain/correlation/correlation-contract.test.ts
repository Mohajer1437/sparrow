import {
  CorrelationContext,
  isValidIdentifier,
  validateCorrelationContext,
  assertValidCorrelationContext,
  buildTaskId,
  buildRunId,
  buildSessionId,
  buildAttemptId,
  buildEventId,
  computeRunFingerprint,
  LEGACY_UNKNOWN_RUN_ID,
  UNKNOWN_IDENTIFIER,
  RUN_LIFECYCLE_STATES,
} from '../../../src/domain/correlation';

describe('R6 Domain — Correlation Contract & Validation', () => {
  describe('isValidIdentifier', () => {
    it('accepts valid alphanumeric identifiers with dashes, dots, underscores', () => {
      expect(isValidIdentifier('task-2026-08-29T10-00-00-000Z-abc123')).toBe(true);
      expect(isValidIdentifier('run-123.456_test')).toBe(true);
      expect(isValidIdentifier('session-abc')).toBe(true);
      expect(isValidIdentifier('attempt-1')).toBe(true);
      expect(isValidIdentifier('LEGACY_UNKNOWN')).toBe(true);
    });

    it('rejects empty, non-string, or boundary-escaping identifiers', () => {
      expect(isValidIdentifier('')).toBe(false);
      expect(isValidIdentifier(null)).toBe(false);
      expect(isValidIdentifier(undefined)).toBe(false);
      expect(isValidIdentifier(123)).toBe(false);
      expect(isValidIdentifier('../escape')).toBe(false);
      expect(isValidIdentifier('path/to/file')).toBe(false);
      expect(isValidIdentifier('has spaces')).toBe(false);
      expect(isValidIdentifier('a'.repeat(121))).toBe(false);
    });
  });

  describe('validateCorrelationContext', () => {
    it('validates a complete, valid CorrelationContext', () => {
      const context: CorrelationContext = {
        taskId: 'task-100',
        runId: 'run-200',
        sessionId: 'session-300',
        attemptId: 'attempt-1',
      };
      const result = validateCorrelationContext(context);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(() => assertValidCorrelationContext(context)).not.toThrow();
    });

    it('accepts valid context without optional attemptId', () => {
      const context: CorrelationContext = {
        taskId: 'task-100',
        runId: 'run-200',
        sessionId: 'session-300',
      };
      const result = validateCorrelationContext(context);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('flags missing required identifiers', () => {
      const result = validateCorrelationContext({ taskId: 'task-1' });
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('runId is required'),
          expect.stringContaining('sessionId is required'),
        ]),
      );
    });

    it('flags invalid or boundary-escaping identifiers', () => {
      const result = validateCorrelationContext({
        taskId: '../evil-task',
        runId: 'run 123',
        sessionId: 'valid-session',
        attemptId: 'attempt/bad',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
      expect(() => assertValidCorrelationContext({
        taskId: '../evil-task',
        runId: 'run 123',
        sessionId: 'valid-session',
      })).toThrow(/Invalid correlation context/);
    });
  });

  describe('Identifier Generators', () => {
    it('builds well-formed task, run, session, attempt, and event ids', () => {
      const taskId = buildTaskId('2026-08-29T12:00:00.000Z', 'fixed1');
      expect(taskId).toMatch(/^task-2026-08-29T12-00-00-000Z-fixed1$/);
      expect(isValidIdentifier(taskId)).toBe(true);

      const runId = buildRunId('2026-08-29T12:00:00.000Z', 'runfx1');
      expect(runId).toMatch(/^run-2026-08-29T12-00-00-000Z-runfx1$/);
      expect(isValidIdentifier(runId)).toBe(true);

      const sessionId = buildSessionId('repl');
      expect(sessionId.startsWith('repl-')).toBe(true);
      expect(isValidIdentifier(sessionId)).toBe(true);

      expect(buildAttemptId(1)).toBe('attempt-1');
      expect(buildAttemptId(3.7)).toBe('attempt-3');
      expect(buildAttemptId(0)).toBe('attempt-1');

      const eventId = buildEventId('run-1', 42);
      expect(eventId.startsWith('evt-run-1-42-')).toBe(true);
      expect(isValidIdentifier(eventId)).toBe(true);
    });
  });

  describe('computeRunFingerprint (R6.42)', () => {
    it('computes deterministic, immutable fingerprint for a run', () => {
      const fp1 = computeRunFingerprint('task-100', 'run-200', '2026-08-29T10:00:00.000Z');
      const fp2 = computeRunFingerprint('task-100', 'run-200', '2026-08-29T10:00:00.000Z');
      const fp3 = computeRunFingerprint('task-100', 'run-201', '2026-08-29T10:00:00.000Z');

      expect(fp1).toBe(fp2);
      expect(fp1).not.toBe(fp3);
      expect(fp1.length).toBe(16);
    });
  });

  describe('Constants and Lifecycles', () => {
    it('defines standard fallback constants and lifecycles', () => {
      expect(LEGACY_UNKNOWN_RUN_ID).toBe('LEGACY_UNKNOWN');
      expect(UNKNOWN_IDENTIFIER).toBe('UNKNOWN');
      expect(RUN_LIFECYCLE_STATES).toEqual(['CREATED', 'STARTED', 'RUNNING', 'TERMINAL']);
    });
  });
});
