import { RuntimeRepository } from '../../contracts/runtime-repository';
import * as crypto from 'crypto';
import type { PreExecutionState, PostExecutionState, StateComparison, FileState } from '../../domain/execution/execution-state';
import type { IExecutionStateTracker } from '../../contracts/execution-state-tracker';

export class ExecutionStateTracker implements IExecutionStateTracker {
  constructor(private readonly runtimeRepository: RuntimeRepository) {}

  private async computeFileHash(filePath: string): Promise<string> {
    try {
      const content = await this.runtimeRepository.readFile(filePath);
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch {
      return '';
    }
  }

  private async getFileSize(filePath: string): Promise<number> {
    try {
      const content = await this.runtimeRepository.readFile(filePath);
      return Buffer.byteLength(content, 'utf8');
    } catch {
      return 0;
    }
  }

  async capturePreExecutionState(
    sessionId: string,
    task: string,
    plannedFiles: ReadonlyArray<string>,
  ): Promise<PreExecutionState> {
    const fileStates: FileState[] = [];

    for (const filePath of plannedFiles) {
      const exists = await this.runtimeRepository.exists(filePath);
      if (exists) {
        const hash = await this.computeFileHash(filePath);
        const size = await this.getFileSize(filePath);
        fileStates.push({
          filePath,
          exists: true,
          hash,
          size,
        });
      } else {
        fileStates.push({
          filePath,
          exists: false,
          hash: '',
          size: 0,
        });
      }
    }

    return {
      sessionId,
      task,
      plannedFiles,
      fileStates: Object.freeze(fileStates),
      capturedAt: new Date().toISOString(),
    };
  }

  async capturePostExecutionState(
    sessionId: string,
    preState: PreExecutionState,
    modifiedFiles: ReadonlyArray<string>,
  ): Promise<PostExecutionState> {
    const allFiles = new Set<string>();
    
    // Add all files from preState
    for (const fileState of preState.fileStates) {
      allFiles.add(fileState.filePath);
    }
    
    // Add all modified files
    for (const filePath of modifiedFiles) {
      allFiles.add(filePath);
    }

    const fileStates: FileState[] = [];

    for (const filePath of allFiles) {
      const exists = await this.runtimeRepository.exists(filePath);
      if (exists) {
        const hash = await this.computeFileHash(filePath);
        const size = await this.getFileSize(filePath);
        fileStates.push({
          filePath,
          exists: true,
          hash,
          size,
        });
      } else {
        fileStates.push({
          filePath,
          exists: false,
          hash: '',
          size: 0,
        });
      }
    }

    return {
      sessionId,
      task: preState.task,
      modifiedFiles,
      fileStates: Object.freeze(fileStates),
      capturedAt: new Date().toISOString(),
    };
  }

  compareStates(pre: PreExecutionState, post: PostExecutionState): StateComparison {
    const preFileMap = new Map<string, FileState>();
    for (const fileState of pre.fileStates) {
      preFileMap.set(fileState.filePath, fileState);
    }

    const postFileMap = new Map<string, FileState>();
    for (const fileState of post.fileStates) {
      postFileMap.set(fileState.filePath, fileState);
    }

    const filesModified: string[] = [];
    const filesCreated: string[] = [];
    const filesDeleted: string[] = [];

    // Check for modified and deleted files
    for (const [filePath, preState] of preFileMap.entries()) {
      const postState = postFileMap.get(filePath);
      if (!postState || !postState.exists) {
        filesDeleted.push(filePath);
      } else if (preState.hash !== postState.hash) {
        filesModified.push(filePath);
      }
    }

    // Check for created files
    for (const [filePath, postState] of postFileMap.entries()) {
      const preState = preFileMap.get(filePath);
      if (!preState || !preState.exists) {
        if (postState.exists) {
          filesCreated.push(filePath);
        }
      }
    }

    // Check for unexpected changes
    const plannedFilesSet = new Set(pre.plannedFiles);
    const unexpectedChanges: string[] = [];
    
    for (const filePath of post.modifiedFiles) {
      if (!plannedFilesSet.has(filePath)) {
        unexpectedChanges.push(filePath);
      }
    }

    return {
      filesModified: Object.freeze(filesModified),
      filesCreated: Object.freeze(filesCreated),
      filesDeleted: Object.freeze(filesDeleted),
      unexpectedChanges: Object.freeze(unexpectedChanges),
      hasUnexpectedChanges: unexpectedChanges.length > 0,
    };
  }
}
