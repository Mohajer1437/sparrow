import { AiContextLoader } from '../../contracts/ai-context';
import { ContextCache } from '../../contracts/context-cache';
import { ContextGatherer, ContextGatheringInput } from '../../contracts/context-gatherer';
import { KnowledgeFusionRetriever } from '../../contracts/knowledge-fusion';
import { StructuralKnowledgeQuery } from '../../contracts/structural-knowledge-query';
import { ContextSourceDescriptor, ContextSourceType } from '../../domain/context-source';
import {
  ContextGatheringLimits,
  DEFAULT_CONTEXT_GATHERING_LIMITS,
  mergeContextGatheringLimits,
} from '../../domain/context-gathering-limits';
import { FailureContract } from '../../domain/failure-contract';
import {
  freezeGatheredContext,
  GatheredCollectionMethod,
  GatheredContext,
  GatheredContextRecord,
  validateGatheredContextRecord,
} from '../../domain/gathered-context';
import { FailureContractContext, ProductQaContext } from '../../domain/planner-context';
import { ProjectProfile } from '../../domain/project-profile';
import { WorkspacePathError } from '../workspace/workspace-paths';
import { selectRelevantAiFiles } from './context-gathering/ai-context-relevance';
import { discoverSourceFileCandidates } from './context-gathering/source-file-candidates';
import { WorkspaceContextReader } from './context-gathering/workspace-context-reader';

export interface TargetedContextGathererDeps {
  readonly cache: ContextCache;
  readonly aiContextLoader: AiContextLoader;
  readonly limits?: Partial<ContextGatheringLimits>;
  /** Phase 3: optional bounded structural graph query for CODEBASE_MAP. */
  readonly structuralQuery?: StructuralKnowledgeQuery;
  /** Phase 5: optional bounded fusion (delegates structural). Prefer over structural-only. */
  readonly fusionRetriever?: KnowledgeFusionRetriever;
}

/**
 * Deterministic targeted context gatherer.
 * Follows ContextStrategy. Does not call an LLM. Does not walk the repository.
 */
export class TargetedContextGatherer implements ContextGatherer {
  constructor(private readonly deps: TargetedContextGathererDeps) {}

  async gather(input: ContextGatheringInput): Promise<GatheredContext> {
    const limits = mergeContextGatheringLimits({
      ...DEFAULT_CONTEXT_GATHERING_LIMITS,
      ...this.deps.limits,
      ...input.limits,
    });
    const reader = new WorkspaceContextReader(input.workspaceRoot);
    const workspaceRoot = reader.root;
    const records: GatheredContextRecord[] = [];
    const budget = { files: 0, bytes: 0, total: 0 };

    if (input.refresh) {
      this.deps.cache.invalidateFiles(workspaceRoot);
    }

    const sources = [...input.strategy.sources].sort((a, b) => a.priority - b.priority);
    let selectedAiContents: Array<{ relativePath: string; content: string }> = [];

    for (const source of sources) {
      if (source.status === 'EXCLUDED') {
        records.push(skipRecord(source, 'EXCLUDED', source.exclusionReason ?? 'Excluded by strategy'));
        continue;
      }
      if (source.status === 'DEFERRED') {
        records.push(skipRecord(source, 'DEFERRED', source.deferralReason ?? 'Deferred by strategy'));
        continue;
      }
      if (source.status === 'MISSING_REQUIRED') {
        records.push(skipRecord(source, 'MISSING_REQUIRED', source.missingReason ?? 'Required source missing'));
        continue;
      }
      if (source.status === 'MISSING_OPTIONAL') {
        records.push(skipRecord(source, 'MISSING_OPTIONAL', source.missingReason ?? 'Optional source missing'));
        continue;
      }
      if (source.status === 'AVAILABLE_BUT_NOT_SELECTED' || source.status === 'AVAILABLE') {
        records.push(skipRecord(source, 'AVAILABLE', source.selectionReason ?? 'Available but not selected'));
        continue;
      }
      if (source.status !== 'SELECTED') {
        continue;
      }

      switch (source.type) {
        case 'USER_TASK':
          records.push(normalizeUserTask(input.userTask, budget, limits));
          break;
        case 'PRODUCT_QA':
          records.push(normalizeProductQa(input.productQa, budget, limits));
          break;
        case 'FAILURE_CONTRACT':
          records.push(...normalizeFailureContract(
            input.failureContract,
            input.failureContractView,
            budget,
            limits,
          ));
          break;
        case 'PROJECT_METADATA':
          records.push(normalizeProjectMetadata(input.projectProfile, workspaceRoot, budget, limits));
          break;
        case 'AI_CONTEXT': {
          const gathered = await this.gatherAiContext(input, reader, workspaceRoot, budget, limits);
          selectedAiContents = gathered.loaded;
          records.push(...gathered.records);
          break;
        }
        case 'SOURCE_FILES':
          records.push(...await this.gatherSourceFiles(
            input,
            reader,
            workspaceRoot,
            selectedAiContents,
            budget,
            limits,
          ));
          break;
        case 'CODEBASE_MAP':
          records.push(await this.gatherStructuralMap(input, source, budget, limits));
          break;
        default:
          break;
      }
    }

    const frozenRecords = records.map(record => validateGatheredContextRecord(record));
    const fileCount = frozenRecords.filter(
      record => (record.source === 'SOURCE_FILES' || record.source === 'AI_CONTEXT')
        && record.status === 'COLLECTED',
    ).length;

    return freezeGatheredContext({
      workspaceRoot,
      records: frozenRecords,
      totalBytes: frozenRecords.reduce((sum, record) => sum + record.sizeBytes, 0),
      fileCount,
      truncatedCount: frozenRecords.filter(record => record.truncated).length,
      limitReached: frozenRecords.some(record => record.status === 'LIMIT_REACHED'),
      limits,
    });
  }

  private async gatherStructuralMap(
    input: ContextGatheringInput,
    source: ContextSourceDescriptor,
    budget: Budget,
    limits: ContextGatheringLimits,
  ): Promise<GatheredContextRecord> {
    if (!this.deps.structuralQuery && !this.deps.fusionRetriever) {
      return skipRecord(source, 'MISSING_OPTIONAL', 'Structural knowledge query is not wired');
    }

    const seeds = extractPathSeeds(input.userTask, input.repairCandidateFiles);
    if (seeds.length === 0) {
      return validateGatheredContextRecord({
        source: 'CODEBASE_MAP',
        reference: 'structural-graph',
        status: 'MISSING_OPTIONAL',
        reason: 'No deterministic seed paths for structural graph query',
        collectionMethod: 'GRAPH_QUERY',
        truncated: false,
        sizeBytes: 0,
        priority: source.priority,
      });
    }

    // Phase 5: bounded fusion for planner when wired (delegates structural query)
    if (this.deps.fusionRetriever) {
      const fusion = await this.deps.fusionRetriever.retrieve({
        seeds,
        taskText: input.userTask,
        consumer: 'planner',
        queryId: `planner-fusion-${seeds.join('+').slice(0, 60)}`,
        reason: 'planner CODEBASE_MAP — bounded structural+semantic+experiential fusion',
        experientialScope: 'module',
      });

      if (!fusion.promptSection) {
        return validateGatheredContextRecord({
          source: 'CODEBASE_MAP',
          reference: 'knowledge-fusion',
          status: 'MISSING_OPTIONAL',
          reason: 'Fusion query returned no bounded context for seeds',
          collectionMethod: 'GRAPH_QUERY',
          truncated: false,
          sizeBytes: 0,
          priority: source.priority,
          metadata: {
            graphQueryId: fusion.provenance.queryId,
            fusionSemanticCount: fusion.provenance.semanticItemCount,
            fusionExperientialCount: fusion.provenance.experientialItemCount,
          },
        });
      }

      let fusionContent = fusion.promptSection;
      const fusionOriginalSize = Buffer.byteLength(fusionContent, 'utf8');
      let fusionTruncated = fusion.provenance.truncated;
      const fusionRemaining = Math.min(
        limits.maxFileBytes,
        Math.max(0, limits.maxBytes - budget.bytes),
        Math.max(0, limits.maxTotalContextBytes - budget.total),
      );
      if (fusionOriginalSize > fusionRemaining && fusionRemaining > 0) {
        fusionContent = truncateUtf8(fusionContent, fusionRemaining);
        fusionTruncated = true;
      }
      const fusionSizeBytes = Buffer.byteLength(fusionContent, 'utf8');
      budget.files += 1;
      budget.bytes += fusionSizeBytes;
      budget.total += fusionSizeBytes;

      return validateGatheredContextRecord({
        source: 'CODEBASE_MAP',
        reference: 'knowledge-fusion',
        status: 'COLLECTED',
        reason: source.selectionReason ?? 'Bounded fused knowledge for planner',
        collectionMethod: 'GRAPH_QUERY',
        content: fusionContent,
        truncated: fusionTruncated,
        sizeBytes: fusionSizeBytes,
        maxBytes: limits.maxFileBytes,
        priority: source.priority,
        metadata: {
          graphQueryId: fusion.provenance.queryId,
          graphContentHash: fusion.structuralQuery?.provenance.graphContentHash ?? undefined,
          graphNodesReturned: fusion.structuralQuery?.provenance.nodesReturned,
          graphEdgesReturned: fusion.structuralQuery?.provenance.edgesReturned,
          graphTruncated: fusion.provenance.truncated,
          workspaceRoot: input.workspaceRoot,
          fusionSemanticCount: fusion.provenance.semanticItemCount,
          fusionExperientialCount: fusion.provenance.experientialItemCount,
          fusionConflictCount: fusion.provenance.conflictCount,
          fusionPromptChars: fusion.provenance.promptChars,
        },
      });
    }

    const result = await this.deps.structuralQuery!.query({
      seeds,
      direction: 'both',
      maxDepth: 1,
      maxNodes: 20,
      maxFiles: 10,
      includeSymbols: true,
      queryId: `planner-${seeds.join('+').slice(0, 80)}`,
      reason: 'planner CODEBASE_MAP — bounded structural neighborhood for TodoPlan formation',
    });

    if (!result.promptSection) {
      return validateGatheredContextRecord({
        source: 'CODEBASE_MAP',
        reference: 'structural-graph',
        status: 'MISSING_OPTIONAL',
        reason: 'Structural graph query returned no bounded subgraph for seeds',
        collectionMethod: 'GRAPH_QUERY',
        truncated: false,
        sizeBytes: 0,
        priority: source.priority,
        metadata: {
          graphQueryId: result.provenance.queryId,
          graphContentHash: result.provenance.graphContentHash ?? undefined,
          graphNodesReturned: 0,
          graphEdgesReturned: 0,
        },
      });
    }

    let content = result.promptSection;
    const originalSize = Buffer.byteLength(content, 'utf8');
    let truncated = result.provenance.truncated;
    const remaining = Math.min(
      limits.maxFileBytes,
      Math.max(0, limits.maxBytes - budget.bytes),
      Math.max(0, limits.maxTotalContextBytes - budget.total),
    );
    if (originalSize > remaining && remaining > 0) {
      content = truncateUtf8(content, remaining);
      truncated = true;
    }
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    budget.files += 1;
    budget.bytes += sizeBytes;
    budget.total += sizeBytes;

    return validateGatheredContextRecord({
      source: 'CODEBASE_MAP',
      reference: 'structural-graph',
      status: 'COLLECTED',
      reason: source.selectionReason ?? 'Bounded structural graph subgraph for planner',
      collectionMethod: 'GRAPH_QUERY',
      content,
      truncated,
      sizeBytes,
      maxBytes: limits.maxFileBytes,
      priority: source.priority,
      metadata: {
        graphQueryId: result.provenance.queryId,
        graphContentHash: result.provenance.graphContentHash ?? undefined,
        graphNodesReturned: result.provenance.nodesReturned,
        graphEdgesReturned: result.provenance.edgesReturned,
        graphTruncated: result.provenance.truncated,
        workspaceRoot: input.workspaceRoot,
      },
    });
  }

  private async gatherAiContext(
    input: ContextGatheringInput,
    reader: WorkspaceContextReader,
    workspaceRoot: string,
    budget: Budget,
    limits: ContextGatheringLimits,
  ): Promise<{ records: GatheredContextRecord[]; loaded: Array<{ relativePath: string; content: string }> }> {
    const productQaText = input.productQa
      ? [input.productQa.objective, ...input.productQa.acceptanceCriteria].join('\n')
      : undefined;
    const selections = selectRelevantAiFiles({
      aiContext: input.aiContext,
      resolvedSkills: input.resolvedSkills,
      userTask: input.userTask,
      productQaText,
      requestedDomains: input.executionDirective.requestedDomains,
    });

    if (selections.length === 0) {
      return {
        records: [validateGatheredContextRecord({
          source: 'AI_CONTEXT',
          reference: '.ai',
          status: 'MISSING_OPTIONAL',
          reason: 'No relevant .ai files matched domain/skill/task signals',
          collectionMethod: 'AI_CONTEXT_LOAD',
          truncated: false,
          sizeBytes: 0,
          priority: 5,
        })],
        loaded: [],
      };
    }

    const records: GatheredContextRecord[] = [];
    const loaded: Array<{ relativePath: string; content: string }> = [];

    for (const selection of selections) {
      const record = await this.readBoundedFile({
        source: 'AI_CONTEXT',
        relativePath: selection.relativePath,
        reason: selection.reason,
        priority: selection.priority,
        reader,
        workspaceRoot,
        budget,
        limits,
        collectionMethod: 'AI_CONTEXT_LOAD',
        allowMissing: true,
      });
      records.push(record);
      if (record.status === 'COLLECTED' && record.content !== undefined) {
        loaded.push({ relativePath: selection.relativePath, content: record.content });
      }
    }

    return { records, loaded };
  }

  private async gatherSourceFiles(
    input: ContextGatheringInput,
    reader: WorkspaceContextReader,
    workspaceRoot: string,
    selectedAiContents: ReadonlyArray<{ relativePath: string; content: string }>,
    budget: Budget,
    limits: ContextGatheringLimits,
  ): Promise<GatheredContextRecord[]> {
    const candidates = discoverSourceFileCandidates({
      reader,
      userTask: input.userTask,
      productQa: input.productQa,
      failureContract: input.failureContract,
      projectProfile: input.projectProfile,
      resolvedSkills: input.resolvedSkills,
      selectedAiContents,
      extraCandidates: input.repairCandidateFiles,
    });

    const records: GatheredContextRecord[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      const key = candidate.relativePath.replace(/\\/g, '/');
      if (seen.has(key)) continue;
      seen.add(key);
      records.push(await this.readBoundedFile({
        source: 'SOURCE_FILES',
        relativePath: candidate.relativePath,
        reason: candidate.reason,
        priority: candidate.priority,
        reader,
        workspaceRoot,
        budget,
        limits,
        collectionMethod: 'WORKSPACE_READ',
        allowMissing: true,
        unresolvedIfMissing: true,
      }));
    }

    if (records.length === 0) {
      records.push(validateGatheredContextRecord({
        source: 'SOURCE_FILES',
        reference: '(none)',
        status: 'MISSING_OPTIONAL',
        reason: 'No deterministic source-file candidates were discovered',
        collectionMethod: 'UNRESOLVED_CANDIDATE',
        truncated: false,
        sizeBytes: 0,
        priority: 6,
      }));
    }

    return records;
  }

  private async readBoundedFile(args: {
    readonly source: ContextSourceType;
    readonly relativePath: string;
    readonly reason: string;
    readonly priority: number;
    readonly reader: WorkspaceContextReader;
    readonly workspaceRoot: string;
    readonly budget: Budget;
    readonly limits: ContextGatheringLimits;
    readonly collectionMethod: GatheredCollectionMethod;
    readonly allowMissing: boolean;
    readonly unresolvedIfMissing?: boolean;
  }): Promise<GatheredContextRecord> {
    const { source, relativePath, reason, priority, reader, workspaceRoot, budget, limits } = args;

    try {
      const resolved = reader.resolve(relativePath);
      const posix = resolved.relative;

      if (budget.files >= limits.maxFiles) {
        return validateGatheredContextRecord({
          source,
          reference: posix,
          status: 'LIMIT_REACHED',
          reason: `${reason}; skipped because maxFiles=${limits.maxFiles} reached`,
          collectionMethod: args.collectionMethod,
          truncated: false,
          sizeBytes: 0,
          maxBytes: limits.maxFileBytes,
          priority,
        });
      }

      let stat;
      try {
        stat = reader.stat(posix);
      } catch (error) {
        if (error instanceof WorkspacePathError) {
          return failedRecord(source, relativePath, reason, priority, error.message);
        }
        throw error;
      }

      if (!stat.exists || stat.isDirectory) {
        return validateGatheredContextRecord({
          source,
          reference: posix,
          status: args.unresolvedIfMissing ? 'MISSING_OPTIONAL' : 'FAILED',
          reason: stat.isDirectory
            ? `${reason}; path is a directory`
            : `${reason}; candidate does not exist`,
          collectionMethod: 'UNRESOLVED_CANDIDATE',
          truncated: false,
          sizeBytes: 0,
          priority,
          error: stat.exists ? 'path is a directory' : 'path does not exist',
          metadata: {
            workspaceRoot,
            candidateUnresolved: true,
          },
        });
      }

      if (budget.bytes >= limits.maxBytes || budget.total >= limits.maxTotalContextBytes) {
        return validateGatheredContextRecord({
          source,
          reference: posix,
          status: 'LIMIT_REACHED',
          reason: `${reason}; skipped because byte budget reached`,
          collectionMethod: args.collectionMethod,
          truncated: false,
          sizeBytes: 0,
          maxBytes: limits.maxFileBytes,
          priority,
        });
      }

      const remainingTotal = Math.min(
        limits.maxFileBytes,
        limits.maxBytes - budget.bytes,
        limits.maxTotalContextBytes - budget.total,
      );
      if (remainingTotal <= 0) {
        return validateGatheredContextRecord({
          source,
          reference: posix,
          status: 'LIMIT_REACHED',
          reason: `${reason}; skipped because byte budget reached`,
          collectionMethod: args.collectionMethod,
          truncated: false,
          sizeBytes: 0,
          maxBytes: limits.maxFileBytes,
          priority,
        });
      }

      const cached = this.deps.cache.getFile(workspaceRoot, posix);
      let content: string;
      let collectionMethod: GatheredCollectionMethod = args.collectionMethod;
      let cacheHit = false;

      if (cached && cached.fingerprint === stat.fingerprint) {
        content = cached.content;
        collectionMethod = 'CACHE_HIT';
        cacheHit = true;
      } else {
        content = reader.read(posix);
        this.deps.cache.setFile(workspaceRoot, posix, {
          path: posix,
          content,
          fingerprint: stat.fingerprint,
          sizeBytes: Buffer.byteLength(content, 'utf8'),
          metadata: { modifiedAt: stat.modifiedAt },
        });
      }

      const originalSize = Buffer.byteLength(content, 'utf8');
      let truncated = false;
      if (originalSize > remainingTotal) {
        content = truncateUtf8(content, remainingTotal);
        truncated = true;
      }

      const sizeBytes = Buffer.byteLength(content, 'utf8');
      budget.files += 1;
      budget.bytes += sizeBytes;
      budget.total += sizeBytes;

      return validateGatheredContextRecord({
        source,
        reference: posix,
        status: 'COLLECTED',
        reason,
        collectionMethod,
        content,
        truncated,
        sizeBytes,
        maxBytes: limits.maxFileBytes,
        priority,
        metadata: {
          workspaceRoot,
          fingerprint: stat.fingerprint,
          cacheHit,
          originalSizeBytes: originalSize,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = error instanceof WorkspacePathError ? 'FAILED' : (args.allowMissing ? 'FAILED' : 'FAILED');
      return validateGatheredContextRecord({
        source,
        reference: relativePath,
        status,
        reason,
        collectionMethod: args.collectionMethod,
        truncated: false,
        sizeBytes: 0,
        priority,
        error: message,
        metadata: { workspaceRoot },
      });
    }
  }
}

interface Budget {
  files: number;
  bytes: number;
  total: number;
}

function skipRecord(
  source: ContextSourceDescriptor,
  status: GatheredContextRecord['status'],
  reason: string,
  extra?: { content?: string; collectionMethod?: GatheredCollectionMethod },
): GatheredContextRecord {
  return validateGatheredContextRecord({
    source: source.type,
    reference: source.type,
    status,
    reason,
    collectionMethod: extra?.collectionMethod ?? 'STRATEGY_SKIP',
    content: extra?.content,
    truncated: false,
    sizeBytes: extra?.content ? Buffer.byteLength(extra.content, 'utf8') : 0,
    priority: source.priority,
  });
}

function failedRecord(
  source: ContextSourceType,
  reference: string,
  reason: string,
  priority: number,
  error: string,
): GatheredContextRecord {
  return validateGatheredContextRecord({
    source,
    reference,
    status: 'FAILED',
    reason,
    collectionMethod: 'WORKSPACE_READ',
    truncated: false,
    sizeBytes: 0,
    priority,
    error,
  });
}

function normalizeUserTask(
  userTask: string,
  _budget: Budget,
  limits: ContextGatheringLimits,
): GatheredContextRecord {
  const content = userTask;
  const sizeBytes = Buffer.byteLength(content, 'utf8');
  return validateGatheredContextRecord({
    source: 'USER_TASK',
    reference: 'user-task',
    status: 'COLLECTED',
    reason: 'User task is already-available context',
    collectionMethod: 'NORMALIZED_INPUT',
    content,
    truncated: false,
    sizeBytes,
    maxBytes: limits.maxTotalContextBytes,
    priority: 1,
  });
}

function normalizeProductQa(
  productQa: ProductQaContext | undefined,
  _budget: Budget,
  limits: ContextGatheringLimits,
): GatheredContextRecord {
  const content = [
    `Objective: ${productQa?.objective ?? ''}`,
    'Acceptance criteria:',
    ...(productQa?.acceptanceCriteria ?? []).map(item => `- ${item}`),
    'Verification requirements:',
    ...(productQa?.verificationRequirements ?? []).map(item => `- ${item}`),
  ].join('\n');
  const sizeBytes = Buffer.byteLength(content, 'utf8');
  return validateGatheredContextRecord({
    source: 'PRODUCT_QA',
    reference: 'product-qa',
    status: 'COLLECTED',
    reason: 'Product QA is already-available context',
    collectionMethod: 'NORMALIZED_INPUT',
    content,
    truncated: false,
    sizeBytes,
    maxBytes: limits.maxTotalContextBytes,
    priority: 2,
  });
}

function normalizeFailureContract(
  contract: FailureContract | undefined,
  view: FailureContractContext | undefined,
  _budget: Budget,
  limits: ContextGatheringLimits,
): GatheredContextRecord[] {
  const records: GatheredContextRecord[] = [];
  const incidentalIds = new Set((contract?.incidentalFailures ?? []).map(item => item.check.id));
  const primaryId = contract?.primaryFailure?.check.id ?? view?.primaryFailureId;

  if (contract?.primaryFailure || primaryId) {
    const primary = contract?.primaryFailure;
    const content = [
      `PRIMARY FAILURE ${primary?.check.id ?? primaryId ?? ''}`,
      primary ? `Expected: ${primary.expectedBehavior}` : '',
      primary ? `Actual: ${primary.actualBehavior}` : '',
      primary ? `Required outcome: ${primary.requiredOutcome}` : '',
      contract?.location?.file ? `File: ${contract.location.file}` : '',
      contract?.implicatedFiles?.length ? `Implicated files: ${contract.implicatedFiles.join(', ')}` : '',
      `Attempt: ${contract?.attempt ?? 1}`,
      `Summary: ${contract?.summary ?? view?.summary ?? ''}`,
    ].filter(Boolean).join('\n');
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    records.push(validateGatheredContextRecord({
      source: 'FAILURE_CONTRACT',
      reference: `failure:${primary?.check.id ?? primaryId ?? contract?.id ?? 'primary'}`,
      status: 'COLLECTED',
      reason: 'Primary failure context preserved for repair',
      collectionMethod: 'NORMALIZED_INPUT',
      content,
      truncated: false,
      sizeBytes,
      maxBytes: limits.maxTotalContextBytes,
      priority: 3,
      metadata: { failureRole: 'PRIMARY' },
    }));
  }

  if (contract) {
    for (const check of contract.failedChecks) {
      if (check.id === primaryId || incidentalIds.has(check.id)) continue;
      const content = [
        `RELEVANT SECONDARY FAILURE ${check.id}`,
        `${check.category}/${check.name}: ${check.evidence}`,
      ].join('\n');
      const sizeBytes = Buffer.byteLength(content, 'utf8');
      records.push(validateGatheredContextRecord({
        source: 'FAILURE_CONTRACT',
        reference: `failure:${check.id}`,
        status: 'COLLECTED',
        reason: 'Relevant secondary failure preserved; not incidental noise',
        collectionMethod: 'NORMALIZED_INPUT',
        content,
        truncated: false,
        sizeBytes,
        maxBytes: limits.maxTotalContextBytes,
        priority: 3,
        metadata: { failureRole: 'RELEVANT_SECONDARY' },
      }));
    }

    for (const incidental of contract.incidentalFailures ?? []) {
      const content = [
        `INCIDENTAL FAILURE ${incidental.check.id}`,
        `${incidental.category}/${incidental.check.name}: ${incidental.evidence}`,
        'Not a repository search target.',
      ].join('\n');
      const sizeBytes = Buffer.byteLength(content, 'utf8');
      records.push(validateGatheredContextRecord({
        source: 'FAILURE_CONTRACT',
        reference: `failure:${incidental.check.id}`,
        status: 'COLLECTED',
        reason: 'Incidental/noise failure recorded; not used as a file search target',
        collectionMethod: 'NORMALIZED_INPUT',
        content,
        truncated: false,
        sizeBytes,
        maxBytes: limits.maxTotalContextBytes,
        priority: 3,
        metadata: { failureRole: 'INCIDENTAL' },
      }));
    }
  }

  if (records.length === 0) {
    const content = view?.summary ?? contract?.summary ?? '';
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    records.push(validateGatheredContextRecord({
      source: 'FAILURE_CONTRACT',
      reference: `failure:${view?.id ?? contract?.id ?? 'unknown'}`,
      status: 'COLLECTED',
      reason: 'Failure contract preserved for repair',
      collectionMethod: 'NORMALIZED_INPUT',
      content,
      truncated: false,
      sizeBytes,
      maxBytes: limits.maxTotalContextBytes,
      priority: 3,
      metadata: { failureRole: 'PRIMARY' },
    }));
  }

  return records;
}

function normalizeProjectMetadata(
  profile: ProjectProfile,
  workspaceRoot: string,
  _budget: Budget,
  limits: ContextGatheringLimits,
): GatheredContextRecord {
  const content = [
    `projectRoot=${profile.workspaceRoot || workspaceRoot}`,
    `projectType=${profile.projectType}`,
    `domains=${profile.detectedDomains.join(', ') || '(none)'}`,
    `frameworks=${profile.detectedFrameworks.join(', ') || '(none)'}`,
    `languages=${profile.languages.join(', ') || '(none)'}`,
    `packageManager=${profile.packageManager}`,
    `testingTools=${profile.availableTestingTools.join(', ') || '(none)'}`,
    `capabilities=${profile.capabilities.join(', ') || '(none)'}`,
  ].join('\n');
  const sizeBytes = Buffer.byteLength(content, 'utf8');
  return validateGatheredContextRecord({
    source: 'PROJECT_METADATA',
    reference: 'project-profile',
    status: 'COLLECTED',
    reason: 'Project Profile is the authoritative lightweight project description',
    collectionMethod: 'PROJECT_PROFILE',
    content,
    truncated: false,
    sizeBytes,
    maxBytes: limits.maxTotalContextBytes,
    priority: 4,
    metadata: {
      workspaceRoot: profile.workspaceRoot || workspaceRoot,
      projectType: profile.projectType,
      detectedDomains: [...profile.detectedDomains],
      frameworks: [...profile.detectedFrameworks],
      packageManager: profile.packageManager,
      testingTools: [...profile.availableTestingTools],
      capabilities: [...profile.capabilities],
    },
  });
}

function truncateUtf8(content: string, maxBytes: number): string {
  const buffer = Buffer.from(content, 'utf8');
  if (buffer.length <= maxBytes) return content;
  return buffer.subarray(0, maxBytes).toString('utf8');
}

/** Deterministic seed extraction for structural queries — not a repo walk. */
function extractPathSeeds(
  userTask: string,
  repairCandidates?: ReadonlyArray<string>,
): string[] {
  const seeds = new Set<string>();
  for (const p of repairCandidates ?? []) {
    const n = p.replace(/\\/g, '/');
    if (/\.(ts|tsx|js|jsx)$/.test(n)) seeds.add(n);
  }
  const re = /(?:^|[\s"'`(\[])(?![\*.])([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx))\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(userTask ?? '')) !== null) {
    let path = match[1];
    if (path.startsWith('./')) path = path.slice(2);
    if (path.includes('*') || path.includes('://')) continue;
    seeds.add(path.replace(/\\/g, '/'));
  }
  return [...seeds].sort();
}
