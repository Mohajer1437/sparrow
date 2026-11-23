import { CreateFileTool } from '../../../../src/core/tools/workspace/create-file-tool';

describe('CreateFileTool', () => {
  let tool: CreateFileTool;
  const mockWorkspace = {
    mkdir: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(false),
    readFile: jest.fn().mockResolvedValue(''),
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

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new CreateFileTool(mockWorkspace, mockPatchExecutor);
  });

  it('creates new file via patch executor', async () => {
    const res = await tool.execute({ path: 'new.txt', content: 'data' });
    expect(res.isError).toBe(false);
    expect(res.content).toContain('Successfully created');
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
