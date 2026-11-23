import { WriteFileTool } from '../../../../src/core/tools/workspace/write-file-tool';
import { CreateFileTool } from '../../../../src/core/tools/workspace/create-file-tool';
import { DeleteFileTool } from '../../../../src/core/tools/workspace/delete-file-tool';
import { ReadFileTool } from '../../../../src/core/tools/workspace/read-file-tool';

describe('Workspace Tools', () => {
  const mockWorkspace = {
    mkdir: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(false),
    readFile: jest.fn().mockResolvedValue('content'),
    writeFile: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    listFiles: jest.fn().mockResolvedValue(['file1.txt', 'file2.ts']),
    listEntries: jest.fn().mockResolvedValue(['dir1', 'file1.txt']),
    isDirectory: jest.fn().mockResolvedValue(false),
  } as any;

  const mockPatchExecutor = {
    execute: jest.fn().mockResolvedValue({
      success: true,
      changedFiles: [],
      failedFiles: [],
      rollbackPerformed: false,
      validationPassed: true,
      testsPassed: true,
    }),
    rollback: jest.fn().mockResolvedValue(undefined),
  } as any;

  describe('ReadFileTool', () => {
    let tool: ReadFileTool;
    beforeEach(() => { 
      jest.clearAllMocks();
      tool = new ReadFileTool(mockWorkspace); 
    });

    it('reads existing file', async () => {
      const res = await tool.execute({ path: 'test.txt' });
      expect(res.isError).toBe(false);
      expect(res.content).toBe('content');
    });

    it('fails on missing file', async () => {
      mockWorkspace.readFile.mockRejectedValueOnce(new Error('File not found'));
      const res = await tool.execute({ path: 'missing.txt' });
      expect(res.isError).toBe(true);
      expect(res.content).toContain('File not found');
    });

    it('path traversal protection', async () => {
      mockWorkspace.readFile.mockRejectedValueOnce(new Error('Path traversal detected'));
      const res = await tool.execute({ path: '../../secret.txt' });
      expect(res.isError).toBe(true);
      expect(res.content).toContain('Path traversal');
    });
  });

  describe('WriteFileTool', () => {
    let tool: WriteFileTool;
    beforeEach(() => { 
      jest.clearAllMocks();
      tool = new WriteFileTool(mockWorkspace, mockPatchExecutor); 
    });

    it('writes to new file via patch executor', async () => {
      mockWorkspace.exists.mockResolvedValue(false);
      const res = await tool.execute({ path: 'new.txt', content: 'data' });
      expect(res.isError).toBe(false);
      expect(mockPatchExecutor.execute).toHaveBeenCalledWith(expect.objectContaining({
        operations: [{ path: 'new.txt', operation: 'create', newContent: 'data' }]
      }));
    });

    it('overwrites existing file via patch executor', async () => {
      mockWorkspace.exists.mockResolvedValue(true);
      mockWorkspace.readFile.mockResolvedValue('old');
      const res = await tool.execute({ path: 'existing.txt', content: 'new' });
      expect(res.isError).toBe(false);
      expect(mockPatchExecutor.execute).toHaveBeenCalledWith(expect.objectContaining({
        operations: [{ path: 'existing.txt', operation: 'modify', originalContent: 'old', newContent: 'new' }]
      }));
    });
  });

  describe('CreateFileTool', () => {
    let tool: CreateFileTool;
    beforeEach(() => { 
      jest.clearAllMocks();
      tool = new CreateFileTool(mockWorkspace, mockPatchExecutor); 
    });

    it('creates new file via patch executor', async () => {
      mockWorkspace.exists.mockResolvedValue(false);
      const res = await tool.execute({ path: 'new.txt', content: 'data' });
      expect(res.isError).toBe(false);
      expect(mockPatchExecutor.execute).toHaveBeenCalledWith(expect.objectContaining({
        operations: [{ path: 'new.txt', operation: 'create', newContent: 'data' }]
      }));
    });

    it('fails on duplicate file', async () => {
      mockWorkspace.exists.mockResolvedValue(true);
      const res = await tool.execute({ path: 'existing.txt', content: 'data' });
      expect(res.isError).toBe(true);
      expect(res.content).toContain('File already exists');
      expect(mockPatchExecutor.execute).not.toHaveBeenCalled();
    });
  });

  describe('DeleteFileTool', () => {
    let tool: DeleteFileTool;
    beforeEach(() => { 
      jest.clearAllMocks();
      tool = new DeleteFileTool(mockWorkspace); 
    });

    it('deletes existing file', async () => {
      mockWorkspace.exists.mockResolvedValue(true);
      const res = await tool.execute({ path: 'test.txt' });
      expect(res.isError).toBe(false);
      expect(mockWorkspace.deleteFile).toHaveBeenCalledWith('test.txt');
    });

    it('fails on missing file', async () => {
      mockWorkspace.deleteFile.mockRejectedValueOnce(new Error('File not found'));
      const res = await tool.execute({ path: 'missing.txt' });
      expect(res.isError).toBe(true);
      expect(res.content).toContain('File not found');
    });
  });
});
