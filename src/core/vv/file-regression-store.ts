import { RegressionStore } from '../../contracts/regression-store';
import { RuntimeRepository } from '../../contracts/runtime-repository';
import { VerificationReport } from '../../domain/verification-report';
import { FailureContract } from '../../domain/failure-contract';
import { RegressionCase } from '../../domain/regression-case';

const REPORTS_PATH = 'vv/regression-reports.json';
const FAILURES_PATH = 'vv/failure-contracts.json';
const CASES_PATH = 'vv/regression-cases.json';

export class FileRegressionStore implements RegressionStore {
  constructor(private readonly runtime: RuntimeRepository) {}

  async record(report: VerificationReport): Promise<void> {
    const reports = [...await this.loadRecent(100), report].slice(-100);
    await this.runtime.writeFile(REPORTS_PATH, JSON.stringify(reports, null, 2));
    if (report.failureContract) {
      const failures = [...await this.loadFailures(100), report.failureContract].slice(-100);
      await this.runtime.writeFile(FAILURES_PATH, JSON.stringify(failures, null, 2));
    }
  }

  async loadRecent(limit: number = 20): Promise<ReadonlyArray<VerificationReport>> {
    return this.readArray(REPORTS_PATH, limit);
  }

  async loadFailures(limit: number = 20): Promise<ReadonlyArray<FailureContract>> {
    return this.readArray(FAILURES_PATH, limit);
  }

  async loadCases(limit: number = 20): Promise<ReadonlyArray<RegressionCase>> {
    return this.readArray(CASES_PATH, limit);
  }

  async saveCase(regressionCase: RegressionCase): Promise<void> {
    const existing = [...await this.loadCases(100)];
    const key = caseKey(regressionCase);
    const next = existing.filter(item => caseKey(item) !== key);
    next.push(regressionCase);
    await this.runtime.writeFile(CASES_PATH, JSON.stringify(next.slice(-100), null, 2));
  }

  private async readArray<T>(filePath: string, limit: number): Promise<T[]> {
    try {
      if (!(await this.runtime.exists(filePath))) return [];
      const raw = await this.runtime.readFile(filePath);
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(-limit);
    } catch {
      return [];
    }
  }
}

function caseKey(regressionCase: RegressionCase): string {
  return [
    regressionCase.category,
    regressionCase.checkId,
    regressionCase.method || '',
    regressionCase.route || '',
    regressionCase.scenario || '',
  ].join('|');
}
