import { ExecutionStateTracker } from '../../../src/core/execution/execution-state-tracker';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';
import * as crypto from 'crypto';

describe('ExecutionStateTracker', () => {
  let mockRuntimeRepository: jest.Mocked<RuntimeRepository>;
  let tracker: ExecutionStateTracker;

  const computeHash = (content: string): string => {
    return crypto.createHash('sha256').update(content).digest('hex');
  };

  beforeEach(() => {
    mockRuntimeRepository = {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      exists: jest.fn(),
      listFiles: jest.fn(),
      mkdir: jest.fn(),
      appendFeedbackCandidates: jest.fn(),
    } as any;

    tracker = new ExecutionStateTracker(mockRuntimeRepository);
  });

  describe('computeFileHash', () => {
    it('computes file hash correctly', async () => {
      const content = 'Hello, World!';
      const expectedHash = computeHash(content);

      mockRuntimeRepository.readFile.mockResolvedValue(content);

      // Access private method via any cast for testing
      const hash = await (tracker as any).computeFileHash('test.txt');

      expect(hash).toBe(expectedHash);
      expect(mockRuntimeRepository.readFile).toHaveBeenCalledWith('test.txt');
    });
  });

  describe('capturePreExecutionState', () => {
    it('captures pre-execution state with planned files', async () => {
      const sessionId = 'session-1';
      const task = 'Test task';
      const plannedFiles = ['file1.ts', 'file2.ts'];

      mockRuntimeRepository.exists.mockResolvedValue(true);
      mockRuntimeRepository.readFile.mockResolvedValue('content');

      const state = await tracker.capturePreExecutionState(sessionId, task, plannedFiles);

      expect(state.sessionId).toBe(sessionId);
      expect(state.task).toBe(task);
      expect(state.plannedFiles).toEqual(plannedFiles);
      expect(state.fileStates.length).toBe(2);
      expect(state.fileStates[0].filePath).toBe('file1.ts');
      expect(state.fileStates[0].exists).toBe(true);
      expect(state.fileStates[1].filePath).toBe('file2.ts');
      expect(state.fileStates[1].exists).toBe(true);
    });

    it('handles non-existent files in pre-state', async () => {
      const sessionId = 'session-1';
      const task = 'Test task';
      const plannedFiles = ['existing.ts', 'non-existing.ts'];

      mockRuntimeRepository.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      mockRuntimeRepository.readFile.mockResolvedValue('content');

      const state = await tracker.capturePreExecutionState(sessionId, task, plannedFiles);

      expect(state.fileStates.length).toBe(2);
      expect(state.fileStates[0].filePath).toBe('existing.ts');
      expect(state.fileStates[0].exists).toBe(true);
      expect(state.fileStates[1].filePath).toBe('non-existing.ts');
      expect(state.fileStates[1].exists).toBe(false);
      expect(state.fileStates[1].hash).toBe('');
    });
  });

  describe('capturePostExecutionState', () => {
    it('captures post-execution state with modified files', async () => {
      const sessionId = 'session-1';
      const preState = {
        sessionId: 'session-1',
        task: 'Test task',
        plannedFiles: ['file1.ts'],
        fileStates: [
          { filePath: 'file1.ts', exists: true, hash: 'hash1', size: 10 },
        ],
        capturedAt: new Date().toISOString(),
      };
      const modifiedFiles = ['file1.ts', 'file2.ts'];

      mockRuntimeRepository.exists.mockResolvedValue(true);
      mockRuntimeRepository.readFile.mockResolvedValue('new content');
      const newHash = computeHash('new content');

      const postState = await tracker.capturePostExecutionState(sessionId, preState, modifiedFiles);

      expect(postState.sessionId).toBe(sessionId);
      expect(postState.modifiedFiles).toEqual(modifiedFiles);
      expect(postState.fileStates.length).toBe(2);
      
      const file1State = postState.fileStates.find(f => f.filePath === 'file1.ts');
      expect(file1State).toBeDefined();
      expect(file1State!.exists).toBe(true);
      expect(file1State!.hash).toBe(newHash);
    });
  });

  describe('compareStates', () => {
    it('detects modified files in comparison', async () => {
      const preState = {
        sessionId: 'session-1',
        task: 'Test task',
        plannedFiles: ['file1.ts'],
        fileStates: [
          { filePath: 'file1.ts', exists: true, hash: 'hash1', size: 10 },
        ],
        capturedAt: new Date().toISOString(),
      };

      const postState = {
        sessionId: 'session-1',
        task: 'Test task',
        modifiedFiles: ['file1.ts'],
        fileStates: [
          { filePath: 'file1.ts', exists: true, hash: 'hash2', size: 15 },
        ],
        capturedAt: new Date().toISOString(),
      };

      const comparison = tracker.compareStates(preState, postState);

      expect(comparison.filesModified).toContain('file1.ts');
      expect(comparison.filesCreated).toHaveLength(0);
      expect(comparison.filesDeleted).toHaveLength(0);
    });

    it('detects created files in comparison', async () => {
      const preState = {
        sessionId: 'session-1',
        task: 'Test task',
        plannedFiles: ['file1.ts'],
        fileStates: [
          { filePath: 'file1.ts', exists: true, hash: 'hash1', size: 10 },
        ],
        capturedAt: new Date().toISOString(),
      };

      const postState = {
        sessionId: 'session-1',
        task: 'Test task',
        modifiedFiles: ['file2.ts'],
        fileStates: [
          { filePath: 'file1.ts', exists: true, hash: 'hash1', size: 10 },
          { filePath: 'file2.ts', exists: true, hash: 'hash2', size: 20 },
        ],
        capturedAt: new Date().toISOString(),
      };

      const comparison = tracker.compareStates(preState, postState);

      expect(comparison.filesCreated).toContain('file2.ts');
      expect(comparison.filesModified).toHaveLength(0);
    });

    it('detects deleted files in comparison', async () => {
      const preState = {
        sessionId: 'session-1',
        task: 'Test task',
        plannedFiles: ['file1.ts', 'file2.ts'],
        fileStates: [
          { filePath: 'file1.ts', exists: true, hash: 'hash1', size: 10 },
          { filePath: 'file2.ts', exists: true, hash: 'hash2', size: 20 },
        ],
        capturedAt: new Date().toISOString(),
      };

      const postState = {
        sessionId: 'session-1',
        task: 'Test task',
        modifiedFiles: [],
        fileStates: [
          { filePath: 'file1.ts', exists: true, hash: 'hash1', size: 10 },
          { filePath: 'file2.ts', exists: false, hash: '', size: 0 },
        ],
        capturedAt: new Date().toISOString(),
      };

      const comparison = tracker.compareStates(preState, postState);

      expect(comparison.filesDeleted).toContain('file2.ts');
      expect(comparison.filesModified).toHaveLength(0);
    });

    it('detects unexpected changes', async () => {
      const preState = {
        sessionId: 'session-1',
        task: 'Test task',
        plannedFiles: ['file1.ts'],
        fileStates: [
          { filePath: 'file1.ts', exists: true, hash: 'hash1', size: 10 },
        ],
        capturedAt: new Date().toISOString(),
      };

      const postState = {
        sessionId: 'session-1',
        task: 'Test task',
        modifiedFiles: ['file1.ts', 'unexpected.ts'],
        fileStates: [
          { filePath: 'file1.ts', exists: true, hash: 'hash2', size: 15 },
          { filePath: 'unexpected.ts', exists: true, hash: 'hash3', size: 25 },
        ],
        capturedAt: new Date().toISOString(),
      };

      const comparison = tracker.compareStates(preState, postState);

      expect(comparison.unexpectedChanges).toContain('unexpected.ts');
      expect(comparison.hasUnexpectedChanges).toBe(true);
    });

    it('returns hasUnexpectedChanges=true when unexpected changes exist', async () => {
      const preState = {
        sessionId: 'session-1',
        task: 'Test task',
        plannedFiles: ['file1.ts'],
        fileStates: [
          { filePath: 'file1.ts', exists: true, hash: 'hash1', size: 10 },
        ],
        capturedAt: new Date().toISOString(),
      };

      const postState = {
        sessionId: 'session-1',
        task: 'Test task',
        modifiedFiles: ['unplanned.ts'],
        fileStates: [
          { filePath: 'file1.ts', exists: true, hash: 'hash1', size: 10 },
          { filePath: 'unplanned.ts', exists: true, hash: 'hash2', size: 20 },
        ],
        capturedAt: new Date().toISOString(),
      };

      const comparison = tracker.compareStates(preState, postState);

      expect(comparison.hasUnexpectedChanges).toBe(true);
      expect(comparison.unexpectedChanges).toContain('unplanned.ts');
    });

    it('returns hasUnexpectedChanges=false when all changes are planned', async () => {
      const preState = {
        sessionId: 'session-1',
        task: 'Test task',
        plannedFiles: ['file1.ts', 'file2.ts'],
        fileStates: [
          { filePath: 'file1.ts', exists: true, hash: 'hash1', size: 10 },
          { filePath: 'file2.ts', exists: true, hash: 'hash2', size: 20 },
        ],
        capturedAt: new Date().toISOString(),
      };

      const postState = {
        sessionId: 'session-1',
        task: 'Test task',
        modifiedFiles: ['file1.ts'],
        fileStates: [
          { filePath: 'file1.ts', exists: true, hash: 'hash3', size: 15 },
          { filePath: 'file2.ts', exists: true, hash: 'hash2', size: 20 },
        ],
        capturedAt: new Date().toISOString(),
      };

      const comparison = tracker.compareStates(preState, postState);

      expect(comparison.hasUnexpectedChanges).toBe(false);
      expect(comparison.unexpectedChanges).toHaveLength(0);
    });
  });
});
