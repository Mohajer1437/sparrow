import { CheckpointRepository } from '../../contracts/checkpoint-repository';
import { ExecutionCheckpoint } from '../../domain/execution-checkpoint';
import { RuntimeRepository } from '../../contracts/runtime-repository';

const CHECKPOINT_DIR = 'checkpoints';

export class FileCheckpointRepository implements CheckpointRepository {
  constructor(private readonly runtime: RuntimeRepository) {}

  private checkpointPath(checkpointId: string): string {
    const safeId = checkpointId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${CHECKPOINT_DIR}/${safeId}.json`;
  }

  /**
   * LocalRuntimeRepository.listFiles returns paths relative to `.ai`, already
   * prefixed with `checkpoints/…`. Older mocks return bare `cp-1.json`.
   * Never double-prefix (SM-11).
   */
  private resolveListedPath(file: string): string {
    const normalized = file.replace(/\\/g, '/');
    if (normalized.startsWith(`${CHECKPOINT_DIR}/`) || normalized === CHECKPOINT_DIR) {
      return normalized;
    }
    return `${CHECKPOINT_DIR}/${normalized.replace(/^\//, '')}`;
  }

  async save(checkpoint: ExecutionCheckpoint): Promise<void> {
    await this.runtime.mkdir(CHECKPOINT_DIR);
    await this.runtime.writeFile(
      this.checkpointPath(checkpoint.checkpointId),
      JSON.stringify(checkpoint, null, 2)
    );
  }

  async load(checkpointId: string): Promise<ExecutionCheckpoint | null> {
    try {
      const exists = await this.runtime.exists(this.checkpointPath(checkpointId));
      if (!exists) return null;
      const raw = await this.runtime.readFile(this.checkpointPath(checkpointId));
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.checkpointId !== 'string') return null;
      return Object.freeze(parsed);
    } catch {
      return null;
    }
  }

  async loadLatest(executionId: string): Promise<ExecutionCheckpoint | null> {
    try {
      const dirExists = await this.runtime.exists(CHECKPOINT_DIR);
      if (!dirExists) return null;
      const files = await this.runtime.listFiles(CHECKPOINT_DIR);
      const checkpoints: ExecutionCheckpoint[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = await this.runtime.readFile(this.resolveListedPath(file));
          const cp = JSON.parse(raw);
          if (cp.executionId === executionId) {
            checkpoints.push(cp);
          }
        } catch {
          // Skip corrupted files
        }
      }
      if (checkpoints.length === 0) return null;
      checkpoints.sort((a, b) => {
        const timeDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        if (timeDiff !== 0) return timeDiff;
        return b.currentStepIndex - a.currentStepIndex;
      });
      return Object.freeze(checkpoints[0]);
    } catch {
      return null;
    }
  }

  async delete(checkpointId: string): Promise<boolean> {
    try {
      const exists = await this.runtime.exists(this.checkpointPath(checkpointId));
      if (!exists) return false;
      await this.runtime.writeFile(this.checkpointPath(checkpointId), '');
      return true;
    } catch {
      return false;
    }
  }

  async list(executionId: string): Promise<ReadonlyArray<ExecutionCheckpoint>> {
    try {
      const dirExists = await this.runtime.exists(CHECKPOINT_DIR);
      if (!dirExists) return Object.freeze([]);
      const files = await this.runtime.listFiles(CHECKPOINT_DIR);
      const checkpoints: ExecutionCheckpoint[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = await this.runtime.readFile(this.resolveListedPath(file));
          const cp = JSON.parse(raw);
          if (cp.executionId === executionId) {
            checkpoints.push(Object.freeze(cp));
          }
        } catch {
          // Skip corrupted files
        }
      }
      return Object.freeze(checkpoints);
    } catch {
      return Object.freeze([]);
    }
  }

  async listAll(): Promise<ReadonlyArray<ExecutionCheckpoint>> {
    try {
      const dirExists = await this.runtime.exists(CHECKPOINT_DIR);
      if (!dirExists) return Object.freeze([]);
      const files = await this.runtime.listFiles(CHECKPOINT_DIR);
      const checkpoints: ExecutionCheckpoint[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = await this.runtime.readFile(this.resolveListedPath(file));
          const cp = JSON.parse(raw);
          if (cp && typeof cp.checkpointId === 'string') {
            checkpoints.push(Object.freeze(cp));
          }
        } catch {
          // Skip corrupted files
        }
      }
      return Object.freeze(checkpoints);
    } catch {
      return Object.freeze([]);
    }
  }
}
