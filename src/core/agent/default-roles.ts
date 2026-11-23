import { RoleConfiguration } from '../../domain/role-configuration';

export const DEFAULT_ROLES: ReadonlyArray<RoleConfiguration> = Object.freeze([
  Object.freeze({
    id: 'coder',
    name: 'Coder',
    providerId: 'ollama',
    modelId: 'gpt-oss:20b-cloud',
    promptTemplate: 'You are an expert software engineer. Write clean, tested, and maintainable code.',
    toolPolicy: 'default',
    contextScope: 'full',
    metadata: Object.freeze({ category: 'execution' })
  }),
  Object.freeze({
    id: 'reviewer',
    name: 'Reviewer',
    providerId: 'ollama',
    modelId: 'gpt-oss:120b-cloud',
    promptTemplate: 'You are a strict code reviewer. Focus on architecture, security, and best practices.',
    toolPolicy: 'read-only',
    contextScope: 'limited',
    metadata: Object.freeze({ category: 'validation' })
  }),
  Object.freeze({
    id: 'planner',
    name: 'Planner',
    providerId: 'ollama',
    modelId: 'gpt-oss:120b-cloud',
    promptTemplate: 'You are a technical architect. Break down tasks into clear, actionable steps.',
    toolPolicy: 'default',
    contextScope: 'full',
    metadata: Object.freeze({ category: 'planning' })
  }),
]);
