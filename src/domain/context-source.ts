import { ContextSourceValidationError } from './errors/context-strategy-errors';

/**
 * Milestone B1: explicit planner context sources.
 * Content is not loaded here — only type, priority, availability, and decision state.
 */

export const CONTEXT_SOURCE_TYPES = [
  'USER_TASK',
  'PRODUCT_QA',
  'FAILURE_CONTRACT',
  'PROJECT_METADATA',
  'AI_CONTEXT',
  'SOURCE_FILES',
  'CODEBASE_MAP',
] as const;

export type ContextSourceType = (typeof CONTEXT_SOURCE_TYPES)[number];

/**
 * Lower number = higher priority. Order is fixed; repair mode changes
 * status/required, not this ranking.
 */
export const CONTEXT_SOURCE_PRIORITY: Record<ContextSourceType, number> = {
  USER_TASK: 1,
  PRODUCT_QA: 2,
  FAILURE_CONTRACT: 3,
  PROJECT_METADATA: 4,
  AI_CONTEXT: 5,
  SOURCE_FILES: 6,
  CODEBASE_MAP: 7,
};

export const CONTEXT_SOURCE_STATUSES = [
  'SELECTED',
  'EXCLUDED',
  'DEFERRED',
  'AVAILABLE',
  'AVAILABLE_BUT_NOT_SELECTED',
  'MISSING_REQUIRED',
  'MISSING_OPTIONAL',
] as const;

export type ContextSourceStatus = (typeof CONTEXT_SOURCE_STATUSES)[number];

export interface ContextSourceDescriptor {
  readonly type: ContextSourceType;
  readonly priority: number;
  readonly required: boolean;
  readonly available: boolean;
  readonly status: ContextSourceStatus;
  readonly selectionReason?: string;
  readonly exclusionReason?: string;
  readonly deferralReason?: string;
  readonly missingReason?: string;
}

export function isContextSourceType(value: unknown): value is ContextSourceType {
  return typeof value === 'string' && (CONTEXT_SOURCE_TYPES as ReadonlyArray<string>).includes(value);
}

export function isContextSourceStatus(value: unknown): value is ContextSourceStatus {
  return typeof value === 'string' && (CONTEXT_SOURCE_STATUSES as ReadonlyArray<string>).includes(value);
}

export function isHigherPriority(a: ContextSourceType, b: ContextSourceType): boolean {
  return CONTEXT_SOURCE_PRIORITY[a] < CONTEXT_SOURCE_PRIORITY[b];
}

export function compareContextSourcePriority(a: ContextSourceType, b: ContextSourceType): number {
  return CONTEXT_SOURCE_PRIORITY[a] - CONTEXT_SOURCE_PRIORITY[b];
}

export function validateContextSource(input: unknown): ContextSourceDescriptor {
  const issues: string[] = [];

  if (input === null || typeof input !== 'object') {
    throw new ContextSourceValidationError('Context source must be an object', ['source must be an object']);
  }

  const raw = input as Record<string, unknown>;

  if (!isContextSourceType(raw.type)) {
    issues.push('type must be a known context source');
  }
  if (!isContextSourceStatus(raw.status)) {
    issues.push('status must be a known context source status');
  }
  if (typeof raw.required !== 'boolean') {
    issues.push('required must be a boolean');
  }
  if (typeof raw.available !== 'boolean') {
    issues.push('available must be a boolean');
  }
  if (typeof raw.priority !== 'number' || !Number.isInteger(raw.priority) || raw.priority < 1) {
    issues.push('priority must be a positive integer');
  }

  if (isContextSourceType(raw.type) && typeof raw.priority === 'number') {
    const expected = CONTEXT_SOURCE_PRIORITY[raw.type];
    if (raw.priority !== expected) {
      issues.push(`priority for ${raw.type} must be ${expected}`);
    }
  }

  const status = raw.status;
  const required = raw.required === true;
  const available = raw.available === true;

  if (status === 'SELECTED') {
    if (!available) issues.push('SELECTED requires available=true');
    if (typeof raw.selectionReason !== 'string' || raw.selectionReason.trim().length === 0) {
      issues.push('SELECTED requires selectionReason');
    }
    if (raw.exclusionReason !== undefined) issues.push('SELECTED cannot include exclusionReason');
  }

  if (status === 'EXCLUDED') {
    if (required) issues.push('required sources cannot be EXCLUDED');
    if (typeof raw.exclusionReason !== 'string' || raw.exclusionReason.trim().length === 0) {
      issues.push('EXCLUDED requires exclusionReason');
    }
  }

  if (status === 'DEFERRED') {
    if (required) issues.push('required sources cannot be DEFERRED');
    if (typeof raw.deferralReason !== 'string' || raw.deferralReason.trim().length === 0) {
      issues.push('DEFERRED requires deferralReason');
    }
  }

  if (status === 'MISSING_REQUIRED') {
    if (available) issues.push('MISSING_REQUIRED requires available=false');
    if (!required) issues.push('MISSING_REQUIRED requires required=true');
    if (typeof raw.missingReason !== 'string' || raw.missingReason.trim().length === 0) {
      issues.push('MISSING_REQUIRED requires missingReason');
    }
  }

  if (status === 'MISSING_OPTIONAL') {
    if (available) issues.push('MISSING_OPTIONAL requires available=false');
    if (required) issues.push('MISSING_OPTIONAL requires required=false');
    if (typeof raw.missingReason !== 'string' || raw.missingReason.trim().length === 0) {
      issues.push('MISSING_OPTIONAL requires missingReason');
    }
  }

  if (status === 'AVAILABLE' || status === 'AVAILABLE_BUT_NOT_SELECTED') {
    if (!available) issues.push(`${status} requires available=true`);
    if (required) issues.push(`${status} cannot be used for required sources`);
  }

  if (issues.length > 0) {
    throw new ContextSourceValidationError(
      `Invalid context source: ${issues.join('; ')}`,
      Object.freeze(issues),
    );
  }

  return freezeContextSource({
    type: raw.type as ContextSourceType,
    priority: raw.priority as number,
    required,
    available,
    status: status as ContextSourceStatus,
    selectionReason: typeof raw.selectionReason === 'string' ? raw.selectionReason : undefined,
    exclusionReason: typeof raw.exclusionReason === 'string' ? raw.exclusionReason : undefined,
    deferralReason: typeof raw.deferralReason === 'string' ? raw.deferralReason : undefined,
    missingReason: typeof raw.missingReason === 'string' ? raw.missingReason : undefined,
  });
}

export function freezeContextSource(source: ContextSourceDescriptor): ContextSourceDescriptor {
  return Object.freeze({ ...source });
}
