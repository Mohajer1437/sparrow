import { VerificationStrategy } from '../domain/verification-strategy';
import { ExecutionPlan } from '../domain/execution-plan';
import { ImpactReport } from '../domain/impact-analysis';

export interface VerificationStrategyEngine {
  generate(
    plan: ExecutionPlan | null,
    impactReport: ImpactReport | null,
    changedFiles: ReadonlyArray<string>
  ): Promise<VerificationStrategy>;
}
