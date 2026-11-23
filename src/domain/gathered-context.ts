import { ContextSourceType, isContextSourceType } from './context-source';
import { ContextGatheringLimits, freezeContextGatheringLimits } from './context-gathering-limits';
import { GatheredContextValidationError } from './errors/gathered-context-errors';

export const GATHERED_CONTEXT_STATUSES = [
  'AVAILABLE',
  'COLLECTED',
  'MISSING_OPTIONAL',
  'MISSING_REQUIRED',
  'LIMIT_REACHED',
  'FAILED',
  'EXCLUDED',
  'DEFERRED',
] as const;

export type GatheredContextStatus = (typeof GATHERED_CONTEXT_STATUSES)[number];

export const GATHERED_COLLECTION_METHODS = [
  'NORMALIZED_INPUT',
  'PROJECT_PROFILE',
  'AI_CONTEXT_LOAD',
  'WORKSPACE_READ',
  'CACHE_HIT',
  'UNRESOLVED_CANDIDATE',
  'STRATEGY_SKIP',
  'GRAPH_QUERY',
] as const;

export type GatheredCollectionMethod = (typeof GATHERED_COLLECTION_METHODS)[number];

export const FAILURE_CONTEXT_ROLES = ['PRIMARY', 'RELEVANT_SECONDARY', 'INCIDENTAL'] as const;
export type FailureContextRole = (typeof FAILURE_CONTEXT_ROLES)[number];

/**
 * Typed metadata for a gathered record. Not an open Record<string, unknown>.
 */
export interface GatheredContextMetadata {
  readonly workspaceRoot?: string;
  readonly fingerprint?: string;
  readonly cacheHit?: boolean;
  readonly failureRole?: FailureContextRole;
  readonly projectType?: string;
  readonly detectedDomains?: ReadonlyArray<string>;
  readonly frameworks?: ReadonlyArray<string>;
  readonly packageManager?: string;
  readonly testingTools?: ReadonlyArray<string>;
  readonly capabilities?: ReadonlyArray<string>;
  readonly candidateUnresolved?: boolean;
  readonly originalSizeBytes?: number;
  /** Structural graph query provenance (not dumped wholesale into prompts). */
  readonly graphQueryId?: string;
  readonly graphContentHash?: string;
  readonly graphNodesReturned?: number;
  readonly graphEdgesReturned?: number;
  readonly graphTruncated?: boolean;
  /** Phase 5 fusion provenance (bounded counts — not full KB). */
  readonly fusionSemanticCount?: number;
  readonly fusionExperientialCount?: number;
  readonly fusionConflictCount?: number;
  readonly fusionPromptChars?: number;
}

export interface GatheredContextRecord {
  readonly source: ContextSourceType;
  readonly reference: string;
  readonly status: GatheredContextStatus;
  readonly reason: string;
  readonly collectionMethod: GatheredCollectionMethod;
  readonly content?: string;
  readonly metadata?: GatheredContextMetadata;
  readonly truncated: boolean;
  readonly sizeBytes: number;
  readonly maxBytes?: number;
  readonly priority: number;
  readonly error?: string;
}

export interface GatheredContext {
  readonly workspaceRoot: string;
  readonly records: ReadonlyArray<GatheredContextRecord>;
  readonly totalBytes: number;
  readonly fileCount: number;
  readonly truncatedCount: number;
  readonly limitReached: boolean;
  readonly limits: ContextGatheringLimits;
}

export function isGatheredContextStatus(value: unknown): value is GatheredContextStatus {
  return typeof value === 'string' && (GATHERED_CONTEXT_STATUSES as ReadonlyArray<string>).includes(value);
}

export function isGatheredCollectionMethod(value: unknown): value is GatheredCollectionMethod {
  return typeof value === 'string' && (GATHERED_COLLECTION_METHODS as ReadonlyArray<string>).includes(value);
}

export function emptyGatheredContext(
  workspaceRoot: string,
  limits: ContextGatheringLimits,
): GatheredContext {
  return freezeGatheredContext({
    workspaceRoot,
    records: [],
    totalBytes: 0,
    fileCount: 0,
    truncatedCount: 0,
    limitReached: false,
    limits,
  });
}

export function freezeGatheredContextMetadata(
  metadata: GatheredContextMetadata,
): GatheredContextMetadata {
  return Object.freeze({
    workspaceRoot: metadata.workspaceRoot,
    fingerprint: metadata.fingerprint,
    cacheHit: metadata.cacheHit,
    failureRole: metadata.failureRole,
    projectType: metadata.projectType,
    detectedDomains: metadata.detectedDomains
      ? Object.freeze([...metadata.detectedDomains])
      : undefined,
    frameworks: metadata.frameworks ? Object.freeze([...metadata.frameworks]) : undefined,
    packageManager: metadata.packageManager,
    testingTools: metadata.testingTools ? Object.freeze([...metadata.testingTools]) : undefined,
    capabilities: metadata.capabilities ? Object.freeze([...metadata.capabilities]) : undefined,
    candidateUnresolved: metadata.candidateUnresolved,
    originalSizeBytes: metadata.originalSizeBytes,
    graphQueryId: metadata.graphQueryId,
    graphContentHash: metadata.graphContentHash,
    graphNodesReturned: metadata.graphNodesReturned,
    graphEdgesReturned: metadata.graphEdgesReturned,
    graphTruncated: metadata.graphTruncated,
    fusionSemanticCount: metadata.fusionSemanticCount,
    fusionExperientialCount: metadata.fusionExperientialCount,
    fusionConflictCount: metadata.fusionConflictCount,
    fusionPromptChars: metadata.fusionPromptChars,
  });
}

export function freezeGatheredContextRecord(record: GatheredContextRecord): GatheredContextRecord {
  return Object.freeze({
    source: record.source,
    reference: record.reference,
    status: record.status,
    reason: record.reason,
    collectionMethod: record.collectionMethod,
    content: record.content,
    metadata: record.metadata ? freezeGatheredContextMetadata(record.metadata) : undefined,
    truncated: record.truncated,
    sizeBytes: record.sizeBytes,
    maxBytes: record.maxBytes,
    priority: record.priority,
    error: record.error,
  });
}

export function freezeGatheredContext(context: GatheredContext): GatheredContext {
  return Object.freeze({
    workspaceRoot: context.workspaceRoot,
    records: Object.freeze(context.records.map(record => freezeGatheredContextRecord(record))),
    totalBytes: context.totalBytes,
    fileCount: context.fileCount,
    truncatedCount: context.truncatedCount,
    limitReached: context.limitReached,
    limits: freezeContextGatheringLimits(context.limits),
  });
}

export function validateGatheredContextRecord(input: unknown): GatheredContextRecord {
  const issues: string[] = [];

  if (input === null || typeof input !== 'object') {
    throw new GatheredContextValidationError(
      'Gathered context record must be an object',
      ['record must be an object'],
    );
  }

  const raw = input as Record<string, unknown>;

  if (!isContextSourceType(raw.source)) {
    issues.push('source must be a known context source');
  }
  if (typeof raw.reference !== 'string' || raw.reference.trim().length === 0) {
    issues.push('reference must be a non-empty string');
  }
  if (!isGatheredContextStatus(raw.status)) {
    issues.push('status must be a known gathered context status');
  }
  if (typeof raw.reason !== 'string' || raw.reason.trim().length === 0) {
    issues.push('reason must be a non-empty string');
  }
  if (!isGatheredCollectionMethod(raw.collectionMethod)) {
    issues.push('collectionMethod must be a known collection method');
  }
  if (typeof raw.truncated !== 'boolean') {
    issues.push('truncated must be a boolean');
  }
  if (typeof raw.sizeBytes !== 'number' || !Number.isInteger(raw.sizeBytes) || raw.sizeBytes < 0) {
    issues.push('sizeBytes must be a non-negative integer');
  }
  if (typeof raw.priority !== 'number' || !Number.isInteger(raw.priority) || raw.priority < 1) {
    issues.push('priority must be a positive integer');
  }
  if (raw.content !== undefined && typeof raw.content !== 'string') {
    issues.push('content must be a string when present');
  }
  if (raw.error !== undefined && typeof raw.error !== 'string') {
    issues.push('error must be a string when present');
  }
  if (raw.maxBytes !== undefined && (typeof raw.maxBytes !== 'number' || !Number.isInteger(raw.maxBytes) || raw.maxBytes < 0)) {
    issues.push('maxBytes must be a non-negative integer when present');
  }
  if (raw.metadata !== undefined) {
    if (raw.metadata === null || typeof raw.metadata !== 'object') {
      issues.push('metadata must be an object when present');
    }
  }

  const status = raw.status;
  const truncated = raw.truncated === true;
  const content = typeof raw.content === 'string' ? raw.content : undefined;
  const error = typeof raw.error === 'string' ? raw.error : undefined;

  if (status === 'COLLECTED') {
    if (content === undefined) {
      issues.push('COLLECTED requires content');
    }
  }

  if (status === 'FAILED') {
    if (!error || error.trim().length === 0) {
      issues.push('FAILED requires error');
    }
  }

  if (status === 'EXCLUDED' || status === 'DEFERRED') {
    if (content !== undefined) {
      issues.push(`${status} cannot include content`);
    }
  }

  if (truncated && content === undefined) {
    issues.push('truncated=true requires content');
  }

  if (status === 'LIMIT_REACHED' && truncated) {
    issues.push('LIMIT_REACHED cannot also be truncated; omit the file instead');
  }

  if (issues.length > 0) {
    throw new GatheredContextValidationError(
      `Invalid gathered context record: ${issues.join('; ')}`,
      Object.freeze(issues),
    );
  }

  const metadata = parseMetadata(raw.metadata);

  return freezeGatheredContextRecord({
    source: raw.source as ContextSourceType,
    reference: (raw.reference as string).trim(),
    status: status as GatheredContextStatus,
    reason: (raw.reason as string).trim(),
    collectionMethod: raw.collectionMethod as GatheredCollectionMethod,
    content,
    metadata,
    truncated,
    sizeBytes: raw.sizeBytes as number,
    maxBytes: typeof raw.maxBytes === 'number' ? raw.maxBytes : undefined,
    priority: raw.priority as number,
    error: error && error.trim().length > 0 ? error : undefined,
  });
}

export function validateGatheredContext(input: unknown): GatheredContext {
  if (input === null || typeof input !== 'object') {
    throw new GatheredContextValidationError(
      'Gathered context must be an object',
      ['context must be an object'],
    );
  }

  const raw = input as Record<string, unknown>;
  const issues: string[] = [];

  if (typeof raw.workspaceRoot !== 'string' || raw.workspaceRoot.trim().length === 0) {
    issues.push('workspaceRoot must be a non-empty string');
  }
  if (!Array.isArray(raw.records)) {
    issues.push('records must be an array');
  }
  if (typeof raw.totalBytes !== 'number' || !Number.isInteger(raw.totalBytes) || raw.totalBytes < 0) {
    issues.push('totalBytes must be a non-negative integer');
  }
  if (typeof raw.fileCount !== 'number' || !Number.isInteger(raw.fileCount) || raw.fileCount < 0) {
    issues.push('fileCount must be a non-negative integer');
  }
  if (typeof raw.truncatedCount !== 'number' || !Number.isInteger(raw.truncatedCount) || raw.truncatedCount < 0) {
    issues.push('truncatedCount must be a non-negative integer');
  }
  if (typeof raw.limitReached !== 'boolean') {
    issues.push('limitReached must be a boolean');
  }
  if (raw.limits === null || typeof raw.limits !== 'object') {
    issues.push('limits must be an object');
  }

  if (issues.length > 0) {
    throw new GatheredContextValidationError(
      `Invalid gathered context: ${issues.join('; ')}`,
      Object.freeze(issues),
    );
  }

  const records = (raw.records as unknown[]).map(record => validateGatheredContextRecord(record));
  const limitsRaw = raw.limits as Record<string, unknown>;
  const limits = freezeContextGatheringLimits({
    maxFiles: Number(limitsRaw.maxFiles),
    maxBytes: Number(limitsRaw.maxBytes),
    maxFileBytes: Number(limitsRaw.maxFileBytes),
    maxTotalContextBytes: Number(limitsRaw.maxTotalContextBytes),
  });

  if (!Number.isInteger(limits.maxFiles) || limits.maxFiles < 1) {
    throw new GatheredContextValidationError('limits.maxFiles must be a positive integer', [
      'limits.maxFiles must be a positive integer',
    ]);
  }

  const collectedFiles = records.filter(
    record => (record.source === 'SOURCE_FILES' || record.source === 'AI_CONTEXT')
      && record.status === 'COLLECTED',
  );
  const totalBytes = records.reduce((sum, record) => sum + record.sizeBytes, 0);
  const truncatedCount = records.filter(record => record.truncated).length;
  const limitReached = records.some(record => record.status === 'LIMIT_REACHED');

  return freezeGatheredContext({
    workspaceRoot: (raw.workspaceRoot as string).trim(),
    records,
    totalBytes,
    fileCount: collectedFiles.length,
    truncatedCount,
    limitReached,
    limits,
  });
}

export function formatGatheredContextSummary(context: GatheredContext): string {
  const collected = context.records.filter(record => record.status === 'COLLECTED').length;
  const limited = context.records.filter(record => record.status === 'LIMIT_REACHED').length;
  const failed = context.records.filter(record => record.status === 'FAILED').length;
  return [
    `workspace=${context.workspaceRoot}`,
    `records=${context.records.length}`,
    `collected=${collected}`,
    `files=${context.fileCount}`,
    `bytes=${context.totalBytes}`,
    `truncated=${context.truncatedCount}`,
    `limitReached=${context.limitReached} (${limited})`,
    `failed=${failed}`,
  ].join('; ');
}

function parseMetadata(value: unknown): GatheredContextMetadata | undefined {
  if (value === undefined) return undefined;
  const raw = value as Record<string, unknown>;
  const stringArray = (input: unknown): ReadonlyArray<string> | undefined => {
    if (!Array.isArray(input)) return undefined;
    return input.filter((item): item is string => typeof item === 'string');
  };
  const failureRole = raw.failureRole;
  return freezeGatheredContextMetadata({
    workspaceRoot: typeof raw.workspaceRoot === 'string' ? raw.workspaceRoot : undefined,
    fingerprint: typeof raw.fingerprint === 'string' ? raw.fingerprint : undefined,
    cacheHit: typeof raw.cacheHit === 'boolean' ? raw.cacheHit : undefined,
    failureRole: failureRole === 'PRIMARY' || failureRole === 'RELEVANT_SECONDARY' || failureRole === 'INCIDENTAL'
      ? failureRole
      : undefined,
    projectType: typeof raw.projectType === 'string' ? raw.projectType : undefined,
    detectedDomains: stringArray(raw.detectedDomains),
    frameworks: stringArray(raw.frameworks),
    packageManager: typeof raw.packageManager === 'string' ? raw.packageManager : undefined,
    testingTools: stringArray(raw.testingTools),
    capabilities: stringArray(raw.capabilities),
    candidateUnresolved: typeof raw.candidateUnresolved === 'boolean' ? raw.candidateUnresolved : undefined,
    originalSizeBytes: typeof raw.originalSizeBytes === 'number' ? raw.originalSizeBytes : undefined,
    graphQueryId: typeof raw.graphQueryId === 'string' ? raw.graphQueryId : undefined,
    graphContentHash: typeof raw.graphContentHash === 'string' ? raw.graphContentHash : undefined,
    graphNodesReturned: typeof raw.graphNodesReturned === 'number' ? raw.graphNodesReturned : undefined,
    graphEdgesReturned: typeof raw.graphEdgesReturned === 'number' ? raw.graphEdgesReturned : undefined,
    graphTruncated: typeof raw.graphTruncated === 'boolean' ? raw.graphTruncated : undefined,
    fusionSemanticCount: typeof raw.fusionSemanticCount === 'number' ? raw.fusionSemanticCount : undefined,
    fusionExperientialCount: typeof raw.fusionExperientialCount === 'number' ? raw.fusionExperientialCount : undefined,
    fusionConflictCount: typeof raw.fusionConflictCount === 'number' ? raw.fusionConflictCount : undefined,
    fusionPromptChars: typeof raw.fusionPromptChars === 'number' ? raw.fusionPromptChars : undefined,
  });
}
