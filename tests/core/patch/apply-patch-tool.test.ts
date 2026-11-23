import { ApplyPatchTool } from '../../../src/core/tools/workspace/apply-patch-tool';
import { PatchExecutor } from '../../../src/contracts/patch-executor';
import { PatchResult } from '../../../src/domain/patch';

describe('ApplyPatchTool', () => {
  let mockPatchExecutor: jest.Mocked<PatchExecutor>;
  let tool: ApplyPatchTool;

  beforeEach(() => {
    mockPatchExecutor = {
      execute: jest.fn(),
      rollback: jest.fn(),
    } as any;

    tool = new ApplyPatchTool(mockPatchExecutor);
  });

  describe('input validation', () => {
    it('accepts call without sessionId and supplies fallback sessionId to executor', async () => {
      const successResult: PatchResult = {
        success: true,
        changedFiles: ['a.ts'],
        failedFiles: [],
        rollbackPerformed: false,
        validationPassed: true,
        testsPassed: true,
      };
      mockPatchExecutor.execute.mockResolvedValue(successResult);

      const result = await tool.execute({
        reason: 'test without sessionId',
        operations: [{ path: 'a.ts', operation: 'create', newContent: 'content' }],
      });
      expect(result.isError).toBe(false);
      expect(mockPatchExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: expect.stringMatching(/^apply-patch-\d+/),
          reason: 'test without sessionId',
          operations: [{ path: 'a.ts', operation: 'create', newContent: 'content' }],
        })
      );
    });

    it('rejects empty operations array', async () => {
      const result = await tool.execute({
        sessionId: 's1',
        reason: 'test',
        operations: [],
      });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('operations');
    });

    it('rejects non-array operations', async () => {
      const result = await tool.execute({
        sessionId: 's1',
        reason: 'test',
        operations: 'not-an-array' as any,
      });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('operations');
    });
  });

  describe('successful execution', () => {
    it('returns success message on successful patch', async () => {
      const successResult: PatchResult = {
        success: true,
        changedFiles: ['src/a.ts', 'src/b.ts'],
        failedFiles: [],
        rollbackPerformed: false,
        validationPassed: true,
        testsPassed: true,
      };
      mockPatchExecutor.execute.mockResolvedValue(successResult);

      const result = await tool.execute({
        sessionId: 's1',
        reason: 'Add feature',
        operations: [
          { path: 'src/a.ts', operation: 'create', newContent: 'content' },
          { path: 'src/b.ts', operation: 'modify', newContent: 'content2' },
        ],
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Patch applied successfully');
      expect(result.content).toContain('src/a.ts');
      expect(result.content).toContain('src/b.ts');
    });
  });

  describe('failed execution', () => {
    it('returns failure message with rollback info', async () => {
      const failResult: PatchResult = {
        success: false,
        changedFiles: ['src/a.ts'],
        failedFiles: ['src/b.ts'],
        rollbackPerformed: true,
        validationPassed: true,
        testsPassed: false,
        error: 'Tests failed',
      };
      mockPatchExecutor.execute.mockResolvedValue(failResult);

      const result = await tool.execute({
        sessionId: 's1',
        reason: 'Add feature',
        operations: [{ path: 'src/a.ts', operation: 'create', newContent: 'x' }],
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Patch failed');
      expect(result.content).toContain('rolled back');
      expect(result.content).toContain('Tests failed');
    });

    it('handles executor throw gracefully', async () => {
      mockPatchExecutor.execute.mockRejectedValue(new Error('Boom'));

      const result = await tool.execute({
        sessionId: 's1',
        reason: 'test',
        operations: [{ path: 'a.ts', operation: 'create', newContent: 'x' }],
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Boom');
    });
  });

  describe('contract compliance', () => {
    it('has required Tool interface fields', () => {
      expect(tool.name).toBe('apply_patch');
      expect(typeof tool.description).toBe('string');
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    });

    it('does not require sessionId in model-facing parameters schema', () => {
      expect(tool.parameters.required).not.toContain('sessionId');
      expect(tool.parameters.required).toEqual(['reason', 'operations']);
      expect((tool.parameters.properties as any).sessionId).toBeUndefined();
    });
  });
});
