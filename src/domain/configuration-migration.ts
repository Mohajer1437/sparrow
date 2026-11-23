export interface MigrationStep {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly description: string;
  readonly transform: (config: Readonly<Record<string, unknown>>) => Record<string, unknown>;
}

export interface MigrationResult {
  readonly success: boolean;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly backupPath?: string;
  readonly stepsApplied: ReadonlyArray<number>;
  readonly error?: string;
}
