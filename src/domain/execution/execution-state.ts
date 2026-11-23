export interface FileState {
  readonly filePath: string;
  readonly exists: boolean;
  readonly hash: string;
  readonly size: number;
}

export interface PreExecutionState {
  readonly sessionId: string;
  readonly task: string;
  readonly plannedFiles: ReadonlyArray<string>;
  readonly fileStates: ReadonlyArray<FileState>;
  readonly capturedAt: string;
}

export interface PostExecutionState {
  readonly sessionId: string;
  readonly task: string;
  readonly modifiedFiles: ReadonlyArray<string>;
  readonly fileStates: ReadonlyArray<FileState>;
  readonly capturedAt: string;
}

export interface StateComparison {
  readonly filesModified: ReadonlyArray<string>;
  readonly filesCreated: ReadonlyArray<string>;
  readonly filesDeleted: ReadonlyArray<string>;
  readonly unexpectedChanges: ReadonlyArray<string>;
  readonly hasUnexpectedChanges: boolean;
}
