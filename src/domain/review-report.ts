export type ReviewSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'NOT_EVALUATED';
export type ReviewStatus = 'PASSED' | 'FAILED' | 'WARNING' | 'NOT_EVALUATED';

export interface ReviewEvidence {
  readonly rule: string;
  readonly source: string;
  readonly target: string;
  readonly description: string;
}

export interface ReviewCheck {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly severity: ReviewSeverity;
  readonly status: ReviewStatus;
  readonly evidence: ReadonlyArray<ReviewEvidence>;
}

export interface ReviewReport {
  readonly timestamp: string;
  readonly reviewedFiles: ReadonlyArray<string>;
  readonly checks: ReadonlyArray<ReviewCheck>;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly warningCount: number;
  readonly notEvaluatedCount: number;
}
