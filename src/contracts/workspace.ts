export interface FileDiff {
  path: string;
  oldContent: string | null;
  newContent: string | null;
  status: 'added' | 'modified' | 'deleted' | 'unchanged';
}

export interface Snapshot {
  id: string;
  timestamp: Date;
  description?: string;
}

export interface Workspace {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  listFiles(directoryPath: string): Promise<string[]>;
  /**
   * Lists immediate entries (files and directories) in a directory.
   * NON-RECURSIVE: only returns direct children.
   * Each entry is returned with its base name (e.g., 'file.ts' or 'subdir/').
   * Directories are indicated with a trailing slash for clarity.
   */
  listEntries(path: string): Promise<string[]>;

  
  createSnapshot(description?: string): Promise<Snapshot>;
  rollback(snapshotId: string): Promise<void>;
  diff(snapshotIdA: string, snapshotIdB?: string): Promise<FileDiff[]>;

  deleteFile(path: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;

  isDirectory(path: string): Promise<boolean>;
}
