export type ExecutionProfile = 'coding' | 'reasoning' | 'balanced' | 'vision';

export interface RoleConfig {
  readonly systemPrompt: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly allowedTools?: ReadonlyArray<string>;
  readonly executionProfile?: ExecutionProfile;
}
