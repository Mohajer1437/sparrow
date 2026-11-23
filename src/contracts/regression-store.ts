import { VerificationReport } from '../domain/verification-report';
import { FailureContract } from '../domain/failure-contract';
import { RegressionCase } from '../domain/regression-case';

export interface RegressionStore {
  record(report: VerificationReport): Promise<void>;
  loadRecent(limit?: number): Promise<ReadonlyArray<VerificationReport>>;
  loadFailures(limit?: number): Promise<ReadonlyArray<FailureContract>>;
  loadCases(limit?: number): Promise<ReadonlyArray<RegressionCase>>;
  saveCase(regressionCase: RegressionCase): Promise<void>;
}
