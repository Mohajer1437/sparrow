import { ReviewReport } from '../domain/review-report';
import { ImpactReport } from '../domain/impact-analysis';

export interface PatchInfo {
  readonly modifiedFiles: ReadonlyArray<string>;
  readonly plannedScope?: ReadonlyArray<string>;
}

export interface Reviewer {
  review(patch: PatchInfo, impactReport?: ImpactReport): Promise<ReviewReport>;
}
