/**
 * C.1: Edit-Size Gate Tests
 */
import { SafePatchExecutor } from '../../../src/core/patch/safe-patch-executor';

const mockPatchExecutor = {
  execute: jest.fn().mockResolvedValue({ success: true, operationsApplied: 1 }),
  rollback: jest.fn().mockResolvedValue(true),
};

const mockVerificationEngine = {
  verify: jest.fn().mockResolvedValue({ success: true, errors: [] }),
};

const mockSessionManager = {
  getSession: jest.fn().mockResolvedValue(null),
  updateSession: jest.fn().mockResolvedValue(undefined),
  addRetryAttempt: jest.fn().mockResolvedValue(undefined),
};

describe('SafePatchExecutor — C.1 Edit-Size Gate', () => {
  let executor: SafePatchExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    executor = new SafePatchExecutor({
      workspacePath: '/test/workspace',
      patchExecutor: mockPatchExecutor as any,
      verificationEngine: mockVerificationEngine as any,
      sessionManager: mockSessionManager as any,
      maxRetries: 1,
    });
  });

  describe('Protected files (lib/utils.ts, FlipCard.tsx)', () => {
    it('blocks > 30% change on lib/utils.ts', async () => {
      const oldContent = Array(100).fill('line').join('\n');
      const newContent = Array(50).fill('different').join('\n');

      const request = {
        sessionId: 'test',
        operations: [{
          path: 'lib/utils.ts',
          operation: 'modify' as const,
          originalContent: oldContent,
          newContent: newContent,
        }],
      };

      const result = await executor.executeWithVerification('test', request);
      expect(result.success).toBe(false);
      expect(result.finalError).toContain('DANGEROUS_REWRITE_BLOCKED');
      expect(mockPatchExecutor.execute).not.toHaveBeenCalled();
    });

    it('allows < 30% change on protected files', async () => {
      const oldContent = Array(100).fill('line').join('\n');
      const newContent = Array(110).fill('line modified').join('\n');

      const request = {
        sessionId: 'test',
        operations: [{
          path: 'lib/utils.ts',
          operation: 'modify' as const,
          originalContent: oldContent,
          newContent: newContent,
        }],
      };

      const result = await executor.executeWithVerification('test', request);
      expect(result.success).toBe(true);
      expect(mockPatchExecutor.execute).toHaveBeenCalled();
    });

    it('blocks rewrite of components/FlipCard.tsx', async () => {
      const oldContent = Array(100).fill('original').join('\n');
      const newContent = Array(150).fill('completely different').join('\n');

      const request = {
        sessionId: 'test',
        operations: [{
          path: 'components/FlipCard.tsx',
          operation: 'modify' as const,
          originalContent: oldContent,
          newContent: newContent,
        }],
      };

      const result = await executor.executeWithVerification('test', request);
      expect(result.success).toBe(false);
      expect(result.finalError).toContain('FlipCard.tsx');
    });
  });

  describe('Non-protected files', () => {
    it('blocks > 70% change on regular files', async () => {
      const oldContent = Array(100).fill('original').join('\n');
      const newContent = Array(20).fill('new').join('\n');

      const request = {
        sessionId: 'test',
        operations: [{
          path: 'app/some/page.tsx',
          operation: 'modify' as const,
          originalContent: oldContent,
          newContent: newContent,
        }],
      };

      const result = await executor.executeWithVerification('test', request);
      expect(result.success).toBe(false);
      expect(result.finalError).toContain('DANGEROUS_REWRITE_BLOCKED');
      expect(mockPatchExecutor.execute).not.toHaveBeenCalled();
    });

    it('allows < 70% change on regular files', async () => {
      const oldContent = Array(100).fill('line').join('\n');
      const newContent = Array(140).fill('modified').join('\n');

      const request = {
        sessionId: 'test',
        operations: [{
          path: 'app/some/page.tsx',
          operation: 'modify' as const,
          originalContent: oldContent,
          newContent: newContent,
        }],
      };

      const result = await executor.executeWithVerification('test', request);
      expect(result.success).toBe(true);
      expect(mockPatchExecutor.execute).toHaveBeenCalled();
    });
  });

  describe('Create operations', () => {
    it('allows create operations regardless of size', async () => {
      const request = {
        sessionId: 'test',
        operations: [{
          path: 'components/NewComponent.tsx',
          operation: 'create' as const,
          newContent: Array(1000).fill('new line').join('\n'),
        }],
      };

      const result = await executor.executeWithVerification('test', request);
      expect(result.success).toBe(true);
      expect(mockPatchExecutor.execute).toHaveBeenCalled();
    });
  });

  describe('Multiple operations', () => {
    it('blocks if any operation violates the limit', async () => {
      const request = {
        sessionId: 'test',
        operations: [
          {
            path: 'app/ok/page.tsx',
            operation: 'modify' as const,
            originalContent: Array(100).fill('line').join('\n'),
            newContent: Array(110).fill('modified').join('\n'),
          },
          {
            path: 'lib/utils.ts',
            operation: 'modify' as const,
            originalContent: Array(100).fill('line').join('\n'),
            newContent: Array(30).fill('rewritten').join('\n'),
          },
        ],
      };

      const result = await executor.executeWithVerification('test', request);
      expect(result.success).toBe(false);
      expect(result.finalError).toContain('lib/utils.ts');
    });
  });
});
