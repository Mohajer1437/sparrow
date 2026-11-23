/**
 * Milestone F: Impact & Regression Intelligence domain models.
 * Grounded in observable evidence without guessing or inventing relations.
 */

export const IMPACT_CONFIDENCE_LEVELS = ['CONFIRMED', 'INFERRED', 'UNKNOWN'] as const;
export type ImpactConfidence = (typeof IMPACT_CONFIDENCE_LEVELS)[number];

export const IMPACT_RELATION_TYPES = [
  'imports',
  'imported_by',
  'exports',
  'route_handler',
  'page_component',
  'controller_endpoint',
  'service_dependency',
  'test_reference',
  'config_reference',
  'dependency_reference',
] as const;
export type ImpactRelationType = (typeof IMPACT_RELATION_TYPES)[number];

export interface ImpactRelation {
  readonly source: string;
  readonly target: string;
  readonly relationType: ImpactRelationType;
  readonly confidence: ImpactConfidence;
  readonly evidenceRef?: string;
  readonly reason: string;
}

export interface ImpactLimits {
  readonly maxImpactNodes: number;
  readonly maxImpactDepth: number;
  readonly maxRelations: number;
  readonly maxAffectedTests: number;
  readonly maxAffectedEndpoints: number;
}

export const DEFAULT_IMPACT_LIMITS: ImpactLimits = Object.freeze({
  maxImpactNodes: 50,
  maxImpactDepth: 4,
  maxRelations: 100,
  maxAffectedTests: 20,
  maxAffectedEndpoints: 20,
});

export interface ImpactAnalysis {
  readonly changedFiles: ReadonlyArray<string>;
  readonly directlyAffected: ReadonlyArray<string>;
  readonly indirectlyAffected: ReadonlyArray<string>;
  readonly affectedEndpoints: ReadonlyArray<string>;
  readonly affectedTests: ReadonlyArray<string>;
  readonly affectedModules: ReadonlyArray<string>;
  readonly affectedDomains: ReadonlyArray<string>;
  readonly relations: ReadonlyArray<ImpactRelation>;
  readonly unknowns: ReadonlyArray<string>;
  readonly confidence: ImpactConfidence;
  readonly limitsReached: boolean;
  readonly summary: string;
  readonly generatedAt: string;
}

// Legacy interfaces for backwards compatibility
export interface ImpactTarget {
  readonly filePath: string;
}

export interface ImpactEvidence {
  readonly source: string;
  readonly target: string;
  readonly type: 'import' | 'module-dependency' | 'test-reference';
}

export interface ImpactReport {
  readonly targets: ReadonlyArray<ImpactTarget>;
  readonly directImpacts: ReadonlyArray<string>;
  readonly indirectImpacts: ReadonlyArray<string>;
  readonly affectedModules: ReadonlyArray<string>;
  readonly relatedTests: ReadonlyArray<string>;
  readonly verificationScope: ReadonlyArray<string>;
  readonly architecturalBoundariesCrossed: ReadonlyArray<string>;
  readonly evidence: ReadonlyArray<ImpactEvidence>;
  readonly analysis?: ImpactAnalysis;
  readonly generatedAt: string;
}

export function freezeImpactRelation(rel: ImpactRelation): ImpactRelation {
  return Object.freeze({
    source: rel.source,
    target: rel.target,
    relationType: rel.relationType,
    confidence: rel.confidence,
    evidenceRef: rel.evidenceRef,
    reason: rel.reason,
  });
}

export function freezeImpactAnalysis(analysis: ImpactAnalysis): ImpactAnalysis {
  return Object.freeze({
    changedFiles: Object.freeze([...analysis.changedFiles]),
    directlyAffected: Object.freeze([...analysis.directlyAffected]),
    indirectlyAffected: Object.freeze([...analysis.indirectlyAffected]),
    affectedEndpoints: Object.freeze([...analysis.affectedEndpoints]),
    affectedTests: Object.freeze([...analysis.affectedTests]),
    affectedModules: Object.freeze([...analysis.affectedModules]),
    affectedDomains: Object.freeze([...analysis.affectedDomains]),
    relations: Object.freeze(analysis.relations.map(freezeImpactRelation)),
    unknowns: Object.freeze([...analysis.unknowns]),
    confidence: analysis.confidence,
    limitsReached: analysis.limitsReached,
    summary: analysis.summary,
    generatedAt: analysis.generatedAt,
  });
}

export function formatImpactAnalysisSummary(analysis: ImpactAnalysis): string {
  const parts: string[] = [
    `confidence=${analysis.confidence}`,
    `changed=${analysis.changedFiles.length}`,
    `direct=${analysis.directlyAffected.length}`,
    `indirect=${analysis.indirectlyAffected.length}`,
    `endpoints=${analysis.affectedEndpoints.length}`,
    `tests=${analysis.affectedTests.length}`,
    `relations=${analysis.relations.length}`,
  ];
  if (analysis.unknowns.length > 0) {
    parts.push(`unknowns=${analysis.unknowns.length}`);
  }
  if (analysis.limitsReached) {
    parts.push('LIMIT_REACHED');
  }
  return parts.join('; ');
}
