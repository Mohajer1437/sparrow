import {
  KnowledgeFusionResult,
  KnowledgeFusionRetriever,
} from '../../contracts/knowledge-fusion';
import { KnowledgeSynchronizer, KnowledgeSyncResult } from '../../contracts/knowledge-synchronizer';
import {
  StructuralKnowledgeQuery,
  StructuralKnowledgeQueryResult,
} from '../../contracts/structural-knowledge-query';
import { MutationLedger } from '../../domain/execution/mutation-safety';
import { PlanStep } from '../../domain/execution-plan';

export type PlanStepKnowledgeEventType =
  | 'before_step_query'
  | 'after_step_sync'
  | 'sync_skipped'
  | 'ordering_marker';

export interface PlanStepKnowledgeEvent {
  readonly type: PlanStepKnowledgeEventType;
  readonly at: string;
  readonly sequence: number;
  readonly sessionId: string;
  readonly stepId: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

/**
 * Canonical PlanStep knowledge boundary:
 *   beforeStep → KnowledgeQuery / optional KnowledgeFusion (bounded)
 *   after mutations/verification → KnowledgeSynchronizer (fail-open)
 *   then checkpoint / next step
 *
 * Does not call LLM or KnowledgePipeline.
 */
export class PlanStepKnowledgeBridge {
  private sequence = 0;
  private readonly events: PlanStepKnowledgeEvent[] = [];
  /** Last query result per step — proves Step N+1 can see prior sync. */
  private readonly lastQueryByStep = new Map<string, StructuralKnowledgeQueryResult>();
  private readonly lastFusionByStep = new Map<string, KnowledgeFusionResult>();
  private lastSync: KnowledgeSyncResult | null = null;

  constructor(
    private readonly synchronizer?: KnowledgeSynchronizer,
    private readonly queryService?: StructuralKnowledgeQuery,
    private readonly onEvent?: (event: PlanStepKnowledgeEvent) => void,
    private readonly fusionRetriever?: KnowledgeFusionRetriever,
  ) {}

  getEvents(): ReadonlyArray<PlanStepKnowledgeEvent> {
    return Object.freeze([...this.events]);
  }

  getLastSync(): KnowledgeSyncResult | null {
    return this.lastSync;
  }

  getLastQuery(stepId: string): StructuralKnowledgeQueryResult | undefined {
    return this.lastQueryByStep.get(stepId);
  }

  getLastFusion(stepId: string): KnowledgeFusionResult | undefined {
    return this.lastFusionByStep.get(stepId);
  }

  /**
   * Before PlanStep execution: bounded structural (+ optional fused) query for seed paths.
   */
  async beforeStep(input: {
    readonly sessionId: string;
    readonly step: PlanStep;
    readonly seedPaths: ReadonlyArray<string>;
  }): Promise<{
    promptSection: string;
    relatedFiles: ReadonlyArray<string>;
    query: StructuralKnowledgeQueryResult | null;
    fusion: KnowledgeFusionResult | null;
  }> {
    this.emit({
      type: 'ordering_marker',
      sessionId: input.sessionId,
      stepId: input.step.id,
      detail: { marker: 'before_step_query_start' },
    });

    if (input.seedPaths.length === 0) {
      return { promptSection: '', relatedFiles: [], query: null, fusion: null };
    }

    // Phase 5: prefer bounded fusion when wired (delegates structural query).
    if (this.fusionRetriever) {
      const fusion = await this.fusionRetriever.retrieve({
        seeds: input.seedPaths,
        taskText: `${input.step.description ?? ''} ${input.step.objective ?? ''}`,
        consumer: 'executor',
        queryId: `executor-fusion-${input.step.id}`,
        sessionId: input.sessionId,
        stepId: input.step.id,
        reason: 'executor PlanStep beforeStep — bounded structural+semantic+experiential fusion',
        experientialScope: 'module',
      });

      let promptSection = fusion.promptSection;
      if (
        fusion.structuralQuery
        && fusion.structuralQuery.provenance.freshness !== 'FRESH'
        && promptSection
      ) {
        promptSection =
          `## KNOWLEDGE FRESHNESS WARNING\nStructural graph freshness=${fusion.structuralQuery.provenance.freshness}; claimCertainty=false. Prefer verifying critical paths with targeted reads.\n\n`
          + promptSection;
      }

      if (fusion.structuralQuery) {
        this.lastQueryByStep.set(input.step.id, fusion.structuralQuery);
      }
      this.lastFusionByStep.set(input.step.id, fusion);
      this.emit({
        type: 'before_step_query',
        sessionId: input.sessionId,
        stepId: input.step.id,
        detail: {
          fusion: true,
          provenance: fusion.provenance,
          structuralProvenance: fusion.structuralQuery?.provenance ?? null,
          relatedFiles: fusion.relatedFiles,
          promptChars: fusion.promptSection.length,
          semanticCount: fusion.semantic.length,
          experientialCount: fusion.experiential.length,
          conflictCount: fusion.conflicts.length,
        },
      });

      return {
        promptSection,
        relatedFiles: fusion.relatedFiles,
        query: fusion.structuralQuery,
        fusion,
      };
    }

    if (!this.queryService) {
      return { promptSection: '', relatedFiles: [], query: null, fusion: null };
    }

    const query = await this.queryService.query({
      seeds: input.seedPaths,
      direction: 'both',
      maxDepth: 1,
      maxNodes: 16,
      maxFiles: 8,
      includeSymbols: true,
      queryId: `executor-before-${input.step.id}`,
      sessionId: input.sessionId,
      stepId: input.step.id,
      reason: 'executor PlanStep beforeStep — direct neighborhood of high-confidence seeds',
    });

    // Stale knowledge: still inject for awareness, but prepend uncertainty notice
    let promptSection = query.promptSection;
    if (query.provenance.freshness !== 'FRESH' && promptSection) {
      promptSection =
        `## KNOWLEDGE FRESHNESS WARNING\nStructural graph freshness=${query.provenance.freshness}; claimCertainty=false. Prefer verifying critical paths with targeted reads.\n\n`
        + promptSection;
    }

    this.lastQueryByStep.set(input.step.id, query);
    this.emit({
      type: 'before_step_query',
      sessionId: input.sessionId,
      stepId: input.step.id,
      detail: {
        provenance: query.provenance,
        relatedFiles: query.relatedFiles,
        promptChars: query.promptSection.length,
      },
    });

    return {
      promptSection,
      relatedFiles: query.relatedFiles,
      query,
      fusion: null,
    };
  }

  /**
   * After PlanStep mutations (success or failed-with-remaining), before checkpoint.
   */
  async afterStepSync(input: {
    readonly sessionId: string;
    readonly stepId: string;
    readonly todoId?: string;
    readonly ledger: MutationLedger;
    readonly outcome: 'success' | 'failed' | 'rolled_back' | 'skipped';
  }): Promise<KnowledgeSyncResult | null> {
    this.emit({
      type: 'ordering_marker',
      sessionId: input.sessionId,
      stepId: input.stepId,
      detail: { marker: 'after_step_sync_start', beforeCheckpoint: true },
    });

    if (!this.synchronizer) {
      return null;
    }

    const candidates = this.synchronizer.candidatesFromLedger(input.ledger);
    if (candidates.length === 0) {
      const skipped = await this.synchronizer.syncFailOpen({
        sessionId: input.sessionId,
        stepId: input.stepId,
        todoId: input.todoId,
        candidatePaths: [],
        outcome: 'skipped',
      });
      this.lastSync = skipped;
      this.emit({
        type: 'sync_skipped',
        sessionId: input.sessionId,
        stepId: input.stepId,
        detail: { reason: skipped.reason, ok: skipped.ok },
      });
      return skipped;
    }

    const result = await this.synchronizer.syncFailOpen({
      sessionId: input.sessionId,
      stepId: input.stepId,
      todoId: input.todoId,
      candidatePaths: candidates,
      outcome: input.outcome,
    });
    this.lastSync = result;
    this.emit({
      type: 'after_step_sync',
      sessionId: input.sessionId,
      stepId: input.stepId,
      detail: {
        ok: result.ok,
        stale: result.stale,
        skipped: result.skipped,
        analyzedFileCount: result.analyzedFileCount,
        affectedFileCount: result.affectedFileCount,
        repositoryFileCount: result.repositoryFileCount,
        fallbackUsed: result.fallbackUsed,
        changedNodes: result.changedNodes,
        contentHash: result.graph?.meta.contentHash ?? null,
      },
    });

    this.emit({
      type: 'ordering_marker',
      sessionId: input.sessionId,
      stepId: input.stepId,
      detail: { marker: 'after_step_sync_done', beforeCheckpoint: true },
    });

    return result;
  }

  markCheckpoint(sessionId: string, stepId: string): void {
    this.emit({
      type: 'ordering_marker',
      sessionId,
      stepId,
      detail: { marker: 'checkpoint' },
    });
  }

  private emit(partial: Omit<PlanStepKnowledgeEvent, 'at' | 'sequence'>): void {
    const event: PlanStepKnowledgeEvent = {
      ...partial,
      at: new Date().toISOString(),
      sequence: ++this.sequence,
    };
    this.events.push(event);
    this.onEvent?.(event);
  }
}
