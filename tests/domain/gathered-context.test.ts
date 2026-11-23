import { GatheredContextValidationError } from '../../src/domain/errors/gathered-context-errors';
import { DEFAULT_CONTEXT_GATHERING_LIMITS } from '../../src/domain/context-gathering-limits';
import {
  validateGatheredContext,
  validateGatheredContextRecord,
} from '../../src/domain/gathered-context';

function validCollected() {
  return {
    source: 'SOURCE_FILES' as const,
    reference: 'src/auth/middleware.ts',
    status: 'COLLECTED' as const,
    reason: 'explicitly referenced by task',
    collectionMethod: 'WORKSPACE_READ' as const,
    content: 'export function middleware() {}',
    truncated: false,
    sizeBytes: 32,
    priority: 1,
    metadata: {
      workspaceRoot: '/tmp/web',
      fingerprint: '1:32',
      cacheHit: false,
    },
  };
}

describe('GatheredContext contract', () => {
  it('accepts a valid collected record with reason and source traceability', () => {
    const record = validateGatheredContextRecord(validCollected());
    expect(record.source).toBe('SOURCE_FILES');
    expect(record.reference).toBe('src/auth/middleware.ts');
    expect(record.status).toBe('COLLECTED');
    expect(record.reason).toBe('explicitly referenced by task');
    expect(record.truncated).toBe(false);
    expect(record.priority).toBe(1);
    expect(Object.isFrozen(record)).toBe(true);
  });

  it('records truncation metadata', () => {
    const record = validateGatheredContextRecord({
      ...validCollected(),
      content: 'partial',
      truncated: true,
      sizeBytes: 7,
      maxBytes: 7,
      metadata: { originalSizeBytes: 40000 },
    });
    expect(record.truncated).toBe(true);
    expect(record.maxBytes).toBe(7);
    expect(record.metadata?.originalSizeBytes).toBe(40000);
  });

  it('accepts LIMIT_REACHED without silently inventing content', () => {
    const record = validateGatheredContextRecord({
      source: 'SOURCE_FILES',
      reference: 'src/too-big.ts',
      status: 'LIMIT_REACHED',
      reason: 'skipped because maxFiles reached',
      collectionMethod: 'WORKSPACE_READ',
      truncated: false,
      sizeBytes: 0,
      priority: 2,
    });
    expect(record.content).toBeUndefined();
    expect(record.status).toBe('LIMIT_REACHED');
  });

  it('rejects COLLECTED without content', () => {
    expect(() => validateGatheredContextRecord({
      ...validCollected(),
      content: undefined,
    })).toThrow(GatheredContextValidationError);
  });

  it('rejects FAILED without an error', () => {
    expect(() => validateGatheredContextRecord({
      source: 'SOURCE_FILES',
      reference: '../secret.ts',
      status: 'FAILED',
      reason: 'path traversal',
      collectionMethod: 'WORKSPACE_READ',
      truncated: false,
      sizeBytes: 0,
      priority: 1,
    })).toThrow(GatheredContextValidationError);
  });

  it('rejects EXCLUDED records that include content', () => {
    expect(() => validateGatheredContextRecord({
      source: 'CODEBASE_MAP',
      reference: 'CODEBASE_MAP',
      status: 'EXCLUDED',
      reason: 'not required',
      collectionMethod: 'STRATEGY_SKIP',
      content: 'should not be here',
      truncated: false,
      sizeBytes: 18,
      priority: 7,
    })).toThrow(GatheredContextValidationError);
  });

  it('rejects truncated=true without content', () => {
    expect(() => validateGatheredContextRecord({
      ...validCollected(),
      content: undefined,
      truncated: true,
    })).toThrow(GatheredContextValidationError);
  });

  it('rejects unknown source types', () => {
    expect(() => validateGatheredContextRecord({
      ...validCollected(),
      source: 'RANDOM',
    })).toThrow(GatheredContextValidationError);
  });

  it('freezes a valid gathered context bundle', () => {
    const gathered = validateGatheredContext({
      workspaceRoot: '/tmp/web',
      records: [validCollected()],
      totalBytes: 32,
      fileCount: 1,
      truncatedCount: 0,
      limitReached: false,
      limits: DEFAULT_CONTEXT_GATHERING_LIMITS,
    });
    expect(gathered.fileCount).toBe(1);
    expect(gathered.totalBytes).toBe(32);
    expect(Object.isFrozen(gathered)).toBe(true);
  });
});
