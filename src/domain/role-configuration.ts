export type ContextScope = 'full' | 'limited' | 'minimal';

export interface RoleConfiguration {
  readonly id: string;
  readonly name: string;
  readonly providerId?: string;  // Deprecated: use RoleAssignment instead
  readonly modelId?: string;     // Deprecated: use RoleAssignment instead
  readonly promptTemplate?: string;
  readonly toolPolicy?: string;
  readonly contextScope: ContextScope;
  readonly metadata?: Readonly<Record<string, string>>;
}
