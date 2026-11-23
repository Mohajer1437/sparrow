/**
 * Phase 5 — bounded knowledge fusion item contract.
 * Distinguishes structural / semantic / experiential with provenance.
 */

export type KnowledgeClass = 'structural' | 'semantic' | 'experiential';

export type KnowledgeFreshnessLabel = 'FRESH' | 'STALE' | 'UNKNOWN' | 'HISTORICAL';

export type KnowledgeScope =
  | 'repository'
  | 'module'
  | 'file'
  | 'task'
  | 'role'
  | 'global';

export type KnowledgeConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

/** Optional claim about repository structure — used for conflict checks only. */
export interface StructuralClaim {
  readonly subjectFile: string;
  readonly predicate: 'imports' | 'imported_by';
  readonly objectFile: string;
}

export interface KnowledgeItem {
  readonly id: string;
  readonly knowledgeClass: KnowledgeClass;
  readonly content: string;
  readonly source: string;
  readonly freshness: KnowledgeFreshnessLabel;
  readonly scope: KnowledgeScope;
  readonly relatedFiles: ReadonlyArray<string>;
  readonly confidence?: KnowledgeConfidence;
  readonly structuralClaim?: StructuralClaim;
  readonly createdAt?: string;
}

export interface KnowledgeConflict {
  readonly id: string;
  readonly claim: StructuralClaim;
  readonly claimSourceItemId: string;
  readonly claimKnowledgeClass: KnowledgeClass;
  readonly structuralVerdict: 'contradicted' | 'supported' | 'unresolvable';
  readonly resolution: 'structural_wins';
  readonly detail: string;
}

export const FUSION_HARD_LIMITS = Object.freeze({
  maxSemanticItems: 3,
  maxExperientialItems: 3,
  maxTotalPromptChars: 6000,
  maxRelatedFilesListed: 12,
});
