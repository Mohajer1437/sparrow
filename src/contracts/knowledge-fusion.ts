import {
  KnowledgeConflict,
  KnowledgeItem,
} from '../domain/knowledge-fusion';
import {
  StructuralKnowledgeQueryRequest,
  StructuralKnowledgeQueryResult,
} from './structural-knowledge-query';

export type FusionConsumer = 'planner' | 'executor';

export interface KnowledgeFusionRequest {
  readonly seeds: ReadonlyArray<string>;
  readonly taskText?: string;
  readonly consumer: FusionConsumer;
  /** Passed through to structural query. */
  readonly structural?: Partial<StructuralKnowledgeQueryRequest>;
  readonly queryId?: string;
  readonly sessionId?: string;
  readonly stepId?: string;
  readonly reason?: string;
  /**
   * Optional scope filter for experiential items.
   * When set to 'module' or 'file', global-only lessons are excluded unless relatedFiles overlap.
   */
  readonly experientialScope?: 'repository' | 'module' | 'file' | 'global';
}

export interface KnowledgeFusionProvenance {
  readonly queryId: string;
  readonly consumer: FusionConsumer;
  readonly structuralSource: string;
  readonly structuralFreshness: string;
  readonly structuralClaimCertainty: boolean;
  readonly structuralItemCount: number;
  readonly semanticItemCount: number;
  readonly experientialItemCount: number;
  readonly conflictCount: number;
  readonly truncated: boolean;
  readonly promptChars: number;
  readonly relatedFiles: ReadonlyArray<string>;
}

export interface KnowledgeFusionResult {
  readonly structural: ReadonlyArray<KnowledgeItem>;
  readonly semantic: ReadonlyArray<KnowledgeItem>;
  readonly experiential: ReadonlyArray<KnowledgeItem>;
  readonly conflicts: ReadonlyArray<KnowledgeConflict>;
  readonly relatedFiles: ReadonlyArray<string>;
  /** Bounded, typed sections — never a full dump. */
  readonly promptSection: string;
  readonly structuralQuery: StructuralKnowledgeQueryResult | null;
  readonly provenance: KnowledgeFusionProvenance;
}

/**
 * Bounded fusion retrieval. Delegates structural traversal to StructuralKnowledgeQuery.
 * LLM-free. Does not concatenate entire knowledge bases.
 */
export interface KnowledgeFusionRetriever {
  retrieve(request: KnowledgeFusionRequest): Promise<KnowledgeFusionResult>;
}
