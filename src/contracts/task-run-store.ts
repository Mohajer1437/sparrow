import { TaskRunContextContent, TaskRunSnapshot } from '../domain/task-run';

/**
 * Persistence boundary for pipeline run read models (R6.16).
 *
 * Runs are written by whichever adapter executed the task (CLI, REPL, Web)
 * and read by observers, including the Web API and CLI inspection tools.
 */
export interface TaskRunStore {
  save(snapshot: TaskRunSnapshot): Promise<void>;
  saveContextContent(content: TaskRunContextContent): Promise<void>;
  list(limit?: number): Promise<ReadonlyArray<TaskRunSnapshot>>;
  get(taskId: string): Promise<TaskRunSnapshot | null>;
  getRun(runId: string): Promise<TaskRunSnapshot | null>;
  listRuns(taskId: string): Promise<ReadonlyArray<TaskRunSnapshot>>;
  getContextContent(taskId: string): Promise<TaskRunContextContent | null>;
  /** Latest mutation time across stored runs; used for cheap change detection. */
  lastModified(): Promise<number>;
}
