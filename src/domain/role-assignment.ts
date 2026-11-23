export type AssignmentSource = 'default' | 'user' | 'cli';

export interface RoleAssignment {
  readonly roleId: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly assignedAt: string;
  readonly updatedAt?: string;
  readonly source?: AssignmentSource;
  readonly metadata?: Readonly<Record<string, string>>;
}
