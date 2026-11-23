export interface SelfHealingConfig {
  readonly enabled: boolean;
  readonly maxHealingAttempts: number;
  readonly escalationModelId?: string;
  readonly escalationProviderId?: string;
  readonly tempKnowledgeDir: string;
  readonly mergeOnSuccess: boolean;
}
