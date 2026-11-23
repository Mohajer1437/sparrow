export type KnowledgeType = 'RULE' | 'PATTERN' | 'ANTI_PATTERN' | 'BEST_PRACTICE';
export type ConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type CandidateStatus = 'pending_review' | 'approved' | 'rejected';

export interface KnowledgeCandidate {
  readonly id: string;
  readonly type: KnowledgeType;
  readonly title: string;
  readonly content: string;
  readonly reason: string;
  readonly evidence: ReadonlyArray<string>;
  readonly confidence: ConfidenceLevel;
  readonly confidenceReasons: ReadonlyArray<string>;
  readonly status: CandidateStatus;
  readonly generatedAt: string;
  readonly sourceSessionId: string;
}
