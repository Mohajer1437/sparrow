import { SkillValidationError } from './errors/skill-errors';
import { QualityProfile } from './quality-profile';

/**
 * Milestone A1: Skill Contract
 *
 * A Skill is not a prompt. It is a deterministic contract that declares
 * domain knowledge, applicability, required context, and planning /
 * execution / verification constraints.
 *
 * Skills are framework-independent. Framework-specific behavior belongs
 * in later milestones (version intelligence, skill-aware verification).
 */

export const SKILL_DOMAINS = ['frontend', 'backend', 'testing'] as const;
export type SkillDomain = (typeof SKILL_DOMAINS)[number];

/** Namespaced id, e.g. frontend.core */
export const SKILL_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/;

export interface SkillApplicability {
  readonly domains: ReadonlyArray<SkillDomain>;
  readonly frameworks?: ReadonlyArray<string>;
  readonly languages?: ReadonlyArray<string>;
  readonly requiredCapabilities?: ReadonlyArray<string>;
}

export interface SkillRequiredContext {
  readonly projectProfile: boolean;
  readonly aiContextFiles?: ReadonlyArray<string>;
  readonly versionKnowledge?: boolean;
}

export interface SkillPlanningRules {
  readonly maxSteps?: number;
  readonly preferredStepSize?: number;
  readonly constraints: ReadonlyArray<string>;
  readonly forbiddenActions?: ReadonlyArray<string>;
}

export interface SkillExecutionRules {
  readonly allowedTools?: ReadonlyArray<string>;
  readonly forbiddenTools?: ReadonlyArray<string>;
  readonly constraints: ReadonlyArray<string>;
  readonly isolation?: boolean;
}

/**
 * Declarative backend verification rules. Skills never execute these;
 * the deterministic backend verifier does.
 */
export interface SkillBackendVerificationRules {
  readonly endpointDiscovery?: boolean;
  readonly authentication?: boolean;
  readonly authorization?: boolean;
  readonly requestGeneration?: boolean;
  readonly responseAssertions?: boolean;
  readonly errorHandling?: boolean;
  readonly databaseVerification?: boolean;
  readonly requiredChecks?: ReadonlyArray<string>;
  readonly discoveryHints?: ReadonlyArray<string>;
  readonly testCommands?: ReadonlyArray<string>;
}

export interface SkillVerificationRules {
  readonly requiredChecks: ReadonlyArray<string>;
  readonly qualityProfile?: QualityProfile;
  readonly domainSpecific?: ReadonlyArray<string>;
  readonly backendVerification?: SkillBackendVerificationRules;
}

export interface SkillVersionSupport {
  readonly knowledgeRefs: ReadonlyArray<string>;
  readonly minFrameworkVersion?: string;
  readonly maxFrameworkVersion?: string;
}

export interface SkillProjectOverrides {
  readonly disabledRules?: ReadonlyArray<string>;
  readonly additionalConstraints?: ReadonlyArray<string>;
}

export interface Skill {
  readonly id: string;
  readonly name: string;
  readonly domain: SkillDomain;
  readonly applicability: SkillApplicability;
  readonly requiredContext: SkillRequiredContext;
  readonly planningRules: SkillPlanningRules;
  readonly executionRules: SkillExecutionRules;
  readonly verificationRules: SkillVerificationRules;
  readonly versionSupport: SkillVersionSupport;
  readonly projectOverrides?: SkillProjectOverrides;
}

export function isSkillDomain(value: unknown): value is SkillDomain {
  return typeof value === 'string' && (SKILL_DOMAINS as ReadonlyArray<string>).includes(value);
}

/**
 * Validate and freeze a Skill definition.
 * Throws SkillValidationError when the contract is incomplete or malformed.
 */
export function validateSkill(input: unknown): Skill {
  const issues: string[] = [];

  if (input === null || typeof input !== 'object') {
    throw new SkillValidationError('Skill must be an object', ['skill must be an object']);
  }

  const raw = input as Record<string, unknown>;

  if (typeof raw.id !== 'string' || raw.id.trim().length === 0) {
    issues.push('id is required');
  } else if (!SKILL_ID_PATTERN.test(raw.id)) {
    issues.push(`id "${raw.id}" must be a namespaced identifier (e.g. frontend.core)`);
  }

  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
    issues.push('name is required');
  }

  if (!isSkillDomain(raw.domain)) {
    issues.push('domain must be one of: frontend, backend, testing');
  }

  const applicability = asObject(raw.applicability, 'applicability', issues);
  const requiredContext = asObject(raw.requiredContext, 'requiredContext', issues);
  const planningRules = asObject(raw.planningRules, 'planningRules', issues);
  const executionRules = asObject(raw.executionRules, 'executionRules', issues);
  const verificationRules = asObject(raw.verificationRules, 'verificationRules', issues);
  const versionSupport = asObject(raw.versionSupport, 'versionSupport', issues);

  let domains: SkillDomain[] = [];
  if (applicability) {
    domains = asDomainList(applicability.domains, 'applicability.domains', issues);
    asOptionalStringList(applicability.frameworks, 'applicability.frameworks', issues);
    asOptionalStringList(applicability.languages, 'applicability.languages', issues);
    asOptionalStringList(applicability.requiredCapabilities, 'applicability.requiredCapabilities', issues);
  }

  if (requiredContext) {
    if (typeof requiredContext.projectProfile !== 'boolean') {
      issues.push('requiredContext.projectProfile must be a boolean');
    }
    asOptionalStringList(requiredContext.aiContextFiles, 'requiredContext.aiContextFiles', issues);
    if (requiredContext.versionKnowledge !== undefined && typeof requiredContext.versionKnowledge !== 'boolean') {
      issues.push('requiredContext.versionKnowledge must be a boolean');
    }
  }

  if (planningRules) {
    asStringList(planningRules.constraints, 'planningRules.constraints', issues);
    asOptionalStringList(planningRules.forbiddenActions, 'planningRules.forbiddenActions', issues);
    asOptionalPositiveInt(planningRules.maxSteps, 'planningRules.maxSteps', issues);
    asOptionalPositiveInt(planningRules.preferredStepSize, 'planningRules.preferredStepSize', issues);
  }

  if (executionRules) {
    asStringList(executionRules.constraints, 'executionRules.constraints', issues);
    asOptionalStringList(executionRules.allowedTools, 'executionRules.allowedTools', issues);
    asOptionalStringList(executionRules.forbiddenTools, 'executionRules.forbiddenTools', issues);
    if (executionRules.isolation !== undefined && typeof executionRules.isolation !== 'boolean') {
      issues.push('executionRules.isolation must be a boolean');
    }
  }

  if (verificationRules) {
    asStringList(verificationRules.requiredChecks, 'verificationRules.requiredChecks', issues);
    asOptionalStringList(verificationRules.domainSpecific, 'verificationRules.domainSpecific', issues);
    if (
      verificationRules.qualityProfile !== undefined
      && verificationRules.qualityProfile !== 'MVP'
      && verificationRules.qualityProfile !== 'STANDARD'
      && verificationRules.qualityProfile !== 'PRODUCTION'
    ) {
      issues.push('verificationRules.qualityProfile must be MVP, STANDARD, or PRODUCTION');
    }
    validateBackendVerification(verificationRules.backendVerification, issues);
  }

  if (versionSupport) {
    asStringList(versionSupport.knowledgeRefs, 'versionSupport.knowledgeRefs', issues);
    if (versionSupport.minFrameworkVersion !== undefined && typeof versionSupport.minFrameworkVersion !== 'string') {
      issues.push('versionSupport.minFrameworkVersion must be a string');
    }
    if (versionSupport.maxFrameworkVersion !== undefined && typeof versionSupport.maxFrameworkVersion !== 'string') {
      issues.push('versionSupport.maxFrameworkVersion must be a string');
    }
  }

  let projectOverrides: SkillProjectOverrides | undefined;
  if (raw.projectOverrides !== undefined) {
    const overrides = asObject(raw.projectOverrides, 'projectOverrides', issues);
    if (overrides) {
      asOptionalStringList(overrides.disabledRules, 'projectOverrides.disabledRules', issues);
      asOptionalStringList(overrides.additionalConstraints, 'projectOverrides.additionalConstraints', issues);
      projectOverrides = freezeOverrides(overrides);
    }
  }

  if (issues.length > 0) {
    throw new SkillValidationError(`Invalid skill definition: ${issues.join('; ')}`, Object.freeze(issues));
  }

  const skill: Skill = {
    id: (raw.id as string).trim(),
    name: (raw.name as string).trim(),
    domain: raw.domain as SkillDomain,
    applicability: freezeApplicability(applicability as Record<string, unknown>, domains),
    requiredContext: freezeRequiredContext(requiredContext as Record<string, unknown>),
    planningRules: freezePlanningRules(planningRules as Record<string, unknown>),
    executionRules: freezeExecutionRules(executionRules as Record<string, unknown>),
    verificationRules: freezeVerificationRules(verificationRules as Record<string, unknown>),
    versionSupport: freezeVersionSupport(versionSupport as Record<string, unknown>),
    projectOverrides,
  };

  return Object.freeze(skill);
}

function asObject(
  value: unknown,
  label: string,
  issues: string[],
): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    issues.push(`${label} is required`);
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asDomainList(value: unknown, label: string, issues: string[]): SkillDomain[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${label} must be a non-empty array`);
    return [];
  }
  const domains: SkillDomain[] = [];
  for (const item of value) {
    if (!isSkillDomain(item)) {
      issues.push(`${label} contains invalid domain "${String(item)}"`);
    } else {
      domains.push(item);
    }
  }
  return domains;
}

function asStringList(value: unknown, label: string, issues: string[]): string[] {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array of strings`);
    return [];
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      issues.push(`${label} must contain only strings`);
    } else {
      result.push(item);
    }
  }
  return result;
}

function asOptionalStringList(value: unknown, label: string, issues: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  return asStringList(value, label, issues);
}

function asOptionalPositiveInt(value: unknown, label: string, issues: string[]): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    issues.push(`${label} must be a positive integer`);
  }
}

function freezeStringList(value: unknown): ReadonlyArray<string> | undefined {
  if (!Array.isArray(value)) return undefined;
  return Object.freeze(value.map(item => String(item)));
}

function freezeApplicability(raw: Record<string, unknown>, domains: SkillDomain[]): SkillApplicability {
  return Object.freeze({
    domains: Object.freeze([...domains]),
    frameworks: freezeStringList(raw.frameworks),
    languages: freezeStringList(raw.languages),
    requiredCapabilities: freezeStringList(raw.requiredCapabilities),
  });
}

function freezeRequiredContext(raw: Record<string, unknown>): SkillRequiredContext {
  return Object.freeze({
    projectProfile: raw.projectProfile === true,
    aiContextFiles: freezeStringList(raw.aiContextFiles),
    versionKnowledge: typeof raw.versionKnowledge === 'boolean' ? raw.versionKnowledge : undefined,
  });
}

function freezePlanningRules(raw: Record<string, unknown>): SkillPlanningRules {
  return Object.freeze({
    maxSteps: typeof raw.maxSteps === 'number' ? raw.maxSteps : undefined,
    preferredStepSize: typeof raw.preferredStepSize === 'number' ? raw.preferredStepSize : undefined,
    constraints: Object.freeze(Array.isArray(raw.constraints) ? raw.constraints.map(String) : []),
    forbiddenActions: freezeStringList(raw.forbiddenActions),
  });
}

function freezeExecutionRules(raw: Record<string, unknown>): SkillExecutionRules {
  return Object.freeze({
    allowedTools: freezeStringList(raw.allowedTools),
    forbiddenTools: freezeStringList(raw.forbiddenTools),
    constraints: Object.freeze(Array.isArray(raw.constraints) ? raw.constraints.map(String) : []),
    isolation: typeof raw.isolation === 'boolean' ? raw.isolation : undefined,
  });
}

function freezeVerificationRules(raw: Record<string, unknown>): SkillVerificationRules {
  return Object.freeze({
    requiredChecks: Object.freeze(Array.isArray(raw.requiredChecks) ? raw.requiredChecks.map(String) : []),
    qualityProfile: raw.qualityProfile as QualityProfile | undefined,
    domainSpecific: freezeStringList(raw.domainSpecific),
    backendVerification: freezeBackendVerification(raw.backendVerification),
  });
}

function validateBackendVerification(value: unknown, issues: string[]): void {
  if (value === undefined) return;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    issues.push('verificationRules.backendVerification must be an object');
    return;
  }
  const raw = value as Record<string, unknown>;
  const flags = [
    'endpointDiscovery',
    'authentication',
    'authorization',
    'requestGeneration',
    'responseAssertions',
    'errorHandling',
    'databaseVerification',
  ];
  for (const flag of flags) {
    if (raw[flag] !== undefined && typeof raw[flag] !== 'boolean') {
      issues.push(`verificationRules.backendVerification.${flag} must be a boolean`);
    }
  }
  asOptionalStringList(raw.requiredChecks, 'verificationRules.backendVerification.requiredChecks', issues);
  asOptionalStringList(raw.discoveryHints, 'verificationRules.backendVerification.discoveryHints', issues);
  asOptionalStringList(raw.testCommands, 'verificationRules.backendVerification.testCommands', issues);
}

function freezeBackendVerification(value: unknown): SkillBackendVerificationRules | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return Object.freeze({
    endpointDiscovery: typeof raw.endpointDiscovery === 'boolean' ? raw.endpointDiscovery : undefined,
    authentication: typeof raw.authentication === 'boolean' ? raw.authentication : undefined,
    authorization: typeof raw.authorization === 'boolean' ? raw.authorization : undefined,
    requestGeneration: typeof raw.requestGeneration === 'boolean' ? raw.requestGeneration : undefined,
    responseAssertions: typeof raw.responseAssertions === 'boolean' ? raw.responseAssertions : undefined,
    errorHandling: typeof raw.errorHandling === 'boolean' ? raw.errorHandling : undefined,
    databaseVerification: typeof raw.databaseVerification === 'boolean' ? raw.databaseVerification : undefined,
    requiredChecks: freezeStringList(raw.requiredChecks),
    discoveryHints: freezeStringList(raw.discoveryHints),
    testCommands: freezeStringList(raw.testCommands),
  });
}

function freezeVersionSupport(raw: Record<string, unknown>): SkillVersionSupport {
  return Object.freeze({
    knowledgeRefs: Object.freeze(Array.isArray(raw.knowledgeRefs) ? raw.knowledgeRefs.map(String) : []),
    minFrameworkVersion: typeof raw.minFrameworkVersion === 'string' ? raw.minFrameworkVersion : undefined,
    maxFrameworkVersion: typeof raw.maxFrameworkVersion === 'string' ? raw.maxFrameworkVersion : undefined,
  });
}

function freezeOverrides(raw: Record<string, unknown>): SkillProjectOverrides {
  return Object.freeze({
    disabledRules: freezeStringList(raw.disabledRules),
    additionalConstraints: freezeStringList(raw.additionalConstraints),
  });
}
