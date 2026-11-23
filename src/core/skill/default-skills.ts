import { InMemorySkillRegistry } from './in-memory-skill-registry';
import { Skill, validateSkill } from '../../domain/skill';

/**
 * Built-in, framework-independent core skills.
 * Next.js / NestJS specifics are not encoded here.
 */
export const DEFAULT_SKILLS: ReadonlyArray<Skill> = Object.freeze([
  validateSkill({
    id: 'frontend.core',
    name: 'Frontend Core',
    domain: 'frontend',
    applicability: {
      domains: ['frontend'],
    },
    requiredContext: {
      projectProfile: true,
      aiContextFiles: ['project', 'frontend'],
    },
    planningRules: {
      constraints: Object.freeze([
        'Plan UI changes against existing routes and components',
        'Do not invent frameworks that are absent from the project profile',
      ]),
    },
    executionRules: {
      constraints: Object.freeze([
        'Limit file changes to frontend source trees',
        'Do not modify backend modules unless a backend skill is also selected',
      ]),
    },
    verificationRules: {
      requiredChecks: Object.freeze(['deterministic', 'browser']),
      domainSpecific: Object.freeze(['ui-acceptance']),
    },
    versionSupport: {
      knowledgeRefs: Object.freeze([]),
    },
  }),
  validateSkill({
    id: 'backend.core',
    name: 'Backend Core',
    domain: 'backend',
    applicability: {
      domains: ['backend'],
    },
    requiredContext: {
      projectProfile: true,
      aiContextFiles: ['project', 'backend'],
    },
    planningRules: {
      constraints: Object.freeze([
        'Plan API and module changes against existing backend structure',
        'Do not invent frameworks that are absent from the project profile',
      ]),
    },
    executionRules: {
      constraints: Object.freeze([
        'Limit file changes to backend source trees',
        'Do not modify frontend routes unless a frontend skill is also selected',
      ]),
    },
    verificationRules: {
      requiredChecks: Object.freeze(['deterministic', 'api']),
      domainSpecific: Object.freeze(['api-contract']),
      backendVerification: Object.freeze({
        endpointDiscovery: true,
        authentication: true,
        authorization: true,
        requestGeneration: true,
        responseAssertions: true,
        errorHandling: true,
        databaseVerification: false,
        requiredChecks: Object.freeze(['endpoint', 'auth', 'validation', 'error-handling']),
      }),
    },
    versionSupport: {
      knowledgeRefs: Object.freeze([]),
    },
  }),
  validateSkill({
    id: 'testing.core',
    name: 'Testing Core',
    domain: 'testing',
    applicability: {
      domains: ['testing'],
    },
    requiredContext: {
      projectProfile: true,
      aiContextFiles: ['project'],
    },
    planningRules: {
      constraints: Object.freeze([
        'Plan tests against detected testing tools only',
        'Do not introduce a test runner that is absent from the project profile',
      ]),
    },
    executionRules: {
      constraints: Object.freeze([
        'Limit changes to test files and test configuration',
      ]),
    },
    verificationRules: {
      requiredChecks: Object.freeze(['deterministic', 'unit']),
      domainSpecific: Object.freeze(['test-runner']),
    },
    versionSupport: {
      knowledgeRefs: Object.freeze([]),
    },
  }),
  validateSkill({
    id: 'backend.api',
    name: 'Backend API Verification',
    domain: 'backend',
    applicability: {
      domains: ['backend'],
    },
    requiredContext: {
      projectProfile: true,
      aiContextFiles: ['project', 'backend'],
    },
    planningRules: {
      constraints: Object.freeze([
        'Plan against discovered HTTP endpoints only',
        'Do not invent routes that are absent from project evidence',
      ]),
    },
    executionRules: {
      constraints: Object.freeze([
        'Limit file changes to backend source trees',
      ]),
    },
    verificationRules: {
      requiredChecks: Object.freeze(['api']),
      domainSpecific: Object.freeze(['endpoint', 'auth', 'validation', 'error-handling']),
      backendVerification: Object.freeze({
        endpointDiscovery: true,
        authentication: true,
        authorization: true,
        requestGeneration: true,
        responseAssertions: true,
        errorHandling: true,
        requiredChecks: Object.freeze(['endpoint', 'auth', 'validation', 'error-handling']),
        testCommands: Object.freeze(['build', 'typecheck', 'unit', 'api']),
      }),
    },
    versionSupport: {
      knowledgeRefs: Object.freeze([]),
    },
  }),
  validateSkill({
    id: 'backend.nestjs',
    name: 'NestJS Backend',
    domain: 'backend',
    applicability: {
      domains: ['backend'],
      frameworks: ['nestjs'],
    },
    requiredContext: {
      projectProfile: true,
      aiContextFiles: ['project', 'backend'],
    },
    planningRules: {
      constraints: Object.freeze([
        'Use NestJS module/controller conventions present in the project',
        'Do not assume a NestJS major version',
      ]),
    },
    executionRules: {
      constraints: Object.freeze([
        'Limit file changes to NestJS modules, controllers, and providers',
      ]),
    },
    verificationRules: {
      requiredChecks: Object.freeze(['api']),
      domainSpecific: Object.freeze(['nestjs-controller']),
      backendVerification: Object.freeze({
        endpointDiscovery: true,
        authentication: true,
        authorization: true,
        errorHandling: true,
        discoveryHints: Object.freeze([
          '@Controller',
          '@Get',
          '@Post',
          '@Put',
          '@Patch',
          '@Delete',
          '@UseGuards',
          '@Roles',
        ]),
        testCommands: Object.freeze(['build', 'typecheck', 'unit', 'api']),
      }),
    },
    versionSupport: {
      knowledgeRefs: Object.freeze([]),
    },
  }),
  validateSkill({
    id: 'backend.testing',
    name: 'Backend Testing',
    domain: 'backend',
    applicability: {
      domains: ['backend'],
    },
    requiredContext: {
      projectProfile: true,
      aiContextFiles: ['project'],
    },
    planningRules: {
      constraints: Object.freeze([
        'Plan backend tests against detected testing tools only',
      ]),
    },
    executionRules: {
      constraints: Object.freeze([
        'Limit changes to backend test files and test configuration',
      ]),
    },
    verificationRules: {
      requiredChecks: Object.freeze(['unit', 'api']),
      domainSpecific: Object.freeze(['api']),
      backendVerification: Object.freeze({
        responseAssertions: true,
        errorHandling: true,
        testCommands: Object.freeze(['unit', 'integration', 'api']),
      }),
    },
    versionSupport: {
      knowledgeRefs: Object.freeze([]),
    },
  }),
  validateSkill({
    id: 'backend.database-verification',
    name: 'Backend Database Verification',
    domain: 'backend',
    applicability: {
      domains: ['backend'],
    },
    requiredContext: {
      projectProfile: true,
      aiContextFiles: ['project', 'backend'],
    },
    planningRules: {
      constraints: Object.freeze([
        'Verify persistence with read-only queries only',
        'Do not plan database writes as verification',
      ]),
    },
    executionRules: {
      constraints: Object.freeze([
        'Do not issue INSERT, UPDATE, DELETE, DROP, ALTER, or TRUNCATE from verification',
      ]),
    },
    verificationRules: {
      requiredChecks: Object.freeze(['database-read-check']),
      domainSpecific: Object.freeze(['database-read-check']),
      backendVerification: Object.freeze({
        databaseVerification: true,
        requiredChecks: Object.freeze(['database-read-check']),
      }),
    },
    versionSupport: {
      knowledgeRefs: Object.freeze([]),
    },
  }),
]);

export function createDefaultSkillRegistry(): InMemorySkillRegistry {
  const registry = new InMemorySkillRegistry();
  for (const skill of DEFAULT_SKILLS) {
    registry.register(skill);
  }
  return registry;
}
