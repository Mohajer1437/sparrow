export interface ConfigurationSnapshot {
  readonly roleId: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly assignmentSource: 'default' | 'user' | 'cli' | 'fallback';
  readonly toolPolicyId: string;
  readonly startedAt: string;
}
