import { RoleAssignment } from '../../domain/role-assignment';

export const DEFAULT_ASSIGNMENTS: ReadonlyArray<RoleAssignment> = Object.freeze([
  Object.freeze({
    roleId: 'coder',
    modelId: 'gpt-oss:20b-cloud',
    providerId: 'ollama',
    assignedAt: new Date().toISOString(),
    metadata: Object.freeze({ source: 'default' })
  }),
  Object.freeze({
    roleId: 'reviewer',
    modelId: 'gpt-oss:120b-cloud',
    providerId: 'ollama',
    assignedAt: new Date().toISOString(),
    metadata: Object.freeze({ source: 'default' })
  }),
  Object.freeze({
    roleId: 'planner',
    modelId: 'gpt-oss:120b-cloud',
    providerId: 'ollama',
    assignedAt: new Date().toISOString(),
    metadata: Object.freeze({ source: 'default' })
  }),
]);
