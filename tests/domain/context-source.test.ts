import { ContextSourceValidationError } from '../../src/domain/errors/context-strategy-errors';
import {
  CONTEXT_SOURCE_PRIORITY,
  validateContextSource,
} from '../../src/domain/context-source';

function validSelected() {
  return {
    type: 'USER_TASK' as const,
    priority: CONTEXT_SOURCE_PRIORITY.USER_TASK,
    required: true,
    available: true,
    status: 'SELECTED' as const,
    selectionReason: 'User task is present',
  };
}

describe('Context source model', () => {
  it('creates a valid selected source', () => {
    const source = validateContextSource(validSelected());
    expect(source.type).toBe('USER_TASK');
    expect(source.required).toBe(true);
    expect(source.status).toBe('SELECTED');
    expect(Object.isFrozen(source)).toBe(true);
  });

  it('creates a valid optional excluded source', () => {
    const source = validateContextSource({
      type: 'CODEBASE_MAP',
      priority: CONTEXT_SOURCE_PRIORITY.CODEBASE_MAP,
      required: false,
      available: false,
      status: 'EXCLUDED',
      exclusionReason: 'Not required for frontend skills',
    });
    expect(source.status).toBe('EXCLUDED');
  });

  it('creates a valid missing required source', () => {
    const source = validateContextSource({
      type: 'PROJECT_METADATA',
      priority: CONTEXT_SOURCE_PRIORITY.PROJECT_METADATA,
      required: true,
      available: false,
      status: 'MISSING_REQUIRED',
      missingReason: 'Project type is unknown',
    });
    expect(source.status).toBe('MISSING_REQUIRED');
    expect(source.required).toBe(true);
  });

  it('rejects selected when unavailable', () => {
    expect(() => validateContextSource({
      ...validSelected(),
      available: false,
    })).toThrow(ContextSourceValidationError);
  });

  it('rejects missing required when available', () => {
    expect(() => validateContextSource({
      type: 'PROJECT_METADATA',
      priority: 4,
      required: true,
      available: true,
      status: 'MISSING_REQUIRED',
      missingReason: 'should not work',
    })).toThrow(ContextSourceValidationError);
  });

  it('rejects excluded required sources', () => {
    expect(() => validateContextSource({
      type: 'USER_TASK',
      priority: 1,
      required: true,
      available: true,
      status: 'EXCLUDED',
      exclusionReason: 'cannot exclude required',
    })).toThrow(ContextSourceValidationError);
  });

  it('rejects deferred required sources', () => {
    expect(() => validateContextSource({
      type: 'USER_TASK',
      priority: 1,
      required: true,
      available: false,
      status: 'DEFERRED',
      deferralReason: 'cannot defer required',
    })).toThrow(ContextSourceValidationError);
  });

  it('rejects a wrong priority for a source type', () => {
    expect(() => validateContextSource({
      ...validSelected(),
      priority: 7,
    })).toThrow(/priority for USER_TASK must be 1/);
  });

  it('rejects a non-object payload', () => {
    expect(() => validateContextSource(null)).toThrow(ContextSourceValidationError);
    expect(() => validateContextSource('USER_TASK')).toThrow(ContextSourceValidationError);
  });
});
