import { QualityProfile } from './quality-profile';
import { VerificationCheck } from './verification-check';

export interface FailureExpectation {
  readonly acceptanceCriterion?: string;
  readonly expectedBehavior?: string;
}

export interface FailureActual {
  readonly actualBehavior?: string;
  readonly observedState?: string;
}

export interface FailureLocation {
  readonly url?: string;
  readonly route?: string;
  readonly file?: string;
  readonly selector?: string;
  readonly testId?: string;
  readonly method?: string;
}

export interface FailureReproduction {
  readonly preconditions?: ReadonlyArray<string>;
  readonly actions?: ReadonlyArray<string>;
  readonly requestData?: string;
  readonly environment?: string;
}

export interface FailureEvidencePack {
  readonly pageErrors?: ReadonlyArray<string>;
  readonly consoleEntries?: ReadonlyArray<string>;
  readonly failedRequests?: ReadonlyArray<string>;
  readonly logRefs?: ReadonlyArray<string>;
}

export interface RepairContract {
  readonly requiredOutcome: string;
  readonly constraints?: ReadonlyArray<string>;
  readonly mustNotChange?: ReadonlyArray<string>;
}

export type FailureRole = 'PRIMARY' | 'SECONDARY' | 'INCIDENTAL';
export type FailureClassification = FailureRole;

export interface PrimaryFailure {
  readonly role: 'PRIMARY';
  readonly check: VerificationCheck;
  readonly category: string;
  readonly acceptanceCriterion?: string;
  readonly expectedBehavior: string;
  readonly actualBehavior: string;
  readonly requiredOutcome: string;
}

export interface SecondaryFailure {
  readonly role: 'SECONDARY';
  readonly check: VerificationCheck;
  readonly category: string;
  readonly severity: string;
  readonly evidence: string;
  readonly acceptanceCriterion?: string;
}

export interface IncidentalFailure {
  readonly role: 'INCIDENTAL';
  readonly check: VerificationCheck;
  readonly category: string;
  readonly severity: string;
  readonly evidence: string;
  readonly acceptanceCriterion?: string;
}

export interface FailureVerificationSpec {
  readonly originalCheck: string;
  readonly regressionScope?: string;
}

export interface FailureContract {
  readonly id: string;
  readonly createdAt: string;
  readonly qualityProfile: QualityProfile;
  readonly summary: string;
  readonly category?: string;
  readonly severity?: string;
  readonly failedChecks: ReadonlyArray<VerificationCheck>;
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly repairInstructions: string;
  readonly attempt: number;
  readonly expectation?: FailureExpectation;
  readonly actual?: FailureActual;
  readonly location?: FailureLocation;
  readonly reproduction?: FailureReproduction;
  readonly evidencePack?: FailureEvidencePack;
  readonly repairContract?: RepairContract;
  readonly verification?: FailureVerificationSpec;
  readonly implicatedFiles?: ReadonlyArray<string>;
  readonly primaryFailure?: PrimaryFailure;
  readonly secondaryFailures?: ReadonlyArray<SecondaryFailure>;
  readonly incidentalFailures?: ReadonlyArray<IncidentalFailure>;
  readonly failedTodoId?: string;
  readonly failedStepId?: string;
  readonly failureType?: string;
  readonly attemptId?: string;
  readonly classification?: FailureClassification;
  readonly evidenceRefs?: ReadonlyArray<string>;
  readonly endpointId?: string;
  readonly expectedStatus?: string;
  readonly actualStatus?: number;
  readonly databaseVerificationStatus?: string;
  readonly impactEvidence?: ReadonlyArray<string>;
  readonly affectedArtifact?: string;
  readonly regressionCheck?: string;
}

export function formatFailureContract(contract: FailureContract): string {
  const lines: string[] = [
    `FAILURE CONTRACT ${contract.id}`,
    `Profile: ${contract.qualityProfile}`,
    `Attempt: ${contract.attempt}`,
    `Summary: ${contract.summary}`,
  ];
  if (contract.attemptId) lines.push(`Attempt id: ${contract.attemptId}`);
  if (contract.failedTodoId) lines.push(`Failed todo: ${contract.failedTodoId}`);
  if (contract.failedStepId) lines.push(`Failed step: ${contract.failedStepId}`);
  if (contract.failureType) lines.push(`Failure type: ${contract.failureType}`);
  if (contract.endpointId) lines.push(`Endpoint: ${contract.endpointId}`);
  if (contract.affectedArtifact) lines.push(`Affected artifact: ${contract.affectedArtifact}`);
  if (contract.regressionCheck) lines.push(`Regression check: ${contract.regressionCheck}`);
  if (contract.impactEvidence && contract.impactEvidence.length > 0) {
    lines.push(`Impact evidence: ${contract.impactEvidence.join('; ')}`);
  }
  if (contract.expectedStatus) lines.push(`Expected status: ${contract.expectedStatus}`);
  if (contract.actualStatus !== undefined) lines.push(`Actual status: ${contract.actualStatus}`);
  if (contract.databaseVerificationStatus) {
    lines.push(`Database verification: ${contract.databaseVerificationStatus}`);
  }
  if (contract.classification) lines.push(`Classification: ${contract.classification}`);
  if (contract.category) lines.push(`Category: ${contract.category}`);
  if (contract.severity) lines.push(`Severity: ${contract.severity}`);
  if (contract.primaryFailure) {
    lines.push('', 'PRIMARY FAILURE:');
    lines.push('Check: ' + contract.primaryFailure.check.id);
    lines.push('Category: ' + contract.primaryFailure.category);
    if (contract.primaryFailure.acceptanceCriterion) {
      lines.push('Acceptance criterion: ' + contract.primaryFailure.acceptanceCriterion);
    }
    lines.push('Expected behavior: ' + contract.primaryFailure.expectedBehavior);
    lines.push('Actual behavior: ' + contract.primaryFailure.actualBehavior);
    lines.push('Required outcome: ' + contract.primaryFailure.requiredOutcome);
    lines.push('The following acceptance criterion is the reason this result was rejected.');
  }
  if (contract.secondaryFailures && contract.secondaryFailures.length > 0) {
    lines.push('', 'SECONDARY FAILURES (relevant, but must not override the primary):');
    for (const item of contract.secondaryFailures) {
      lines.push(
        '- [' + item.severity + '] ' + item.category + '/' + item.check.name
        + ': ' + item.evidence,
      );
    }
  }
  if (contract.incidentalFailures && contract.incidentalFailures.length > 0) {
    lines.push('', 'INCIDENTAL FAILURES (do not override the primary product objective):');
    for (const item of contract.incidentalFailures) {
      lines.push(
        '- [' + item.severity + '] ' + item.category + '/' + item.check.name
        + ': ' + item.evidence,
      );
    }
  } else if (contract.primaryFailure) {
    lines.push('', 'INCIDENTAL FAILURES: none.');
  }
  if (contract.repairContract?.requiredOutcome) {
    lines.push('Required outcome: ' + contract.repairContract.requiredOutcome);
  }
  if (contract.location?.file) {
    lines.push('File: ' + contract.location.file);
  }
  const implicatedFiles = contract.implicatedFiles && contract.implicatedFiles.length > 0
    ? contract.implicatedFiles
    : (() => {
      const match = contract.repairInstructions.match(/Implicated files \(must be in the repair plan\): (.+)$/m);
      return match ? match[1].split(',').map(s => s.trim()).filter(Boolean) : [];
    })();
  if (implicatedFiles.length > 0) {
    lines.push('Implicated files: ' + implicatedFiles.join(', '));
  }
  if (contract.evidenceRefs && contract.evidenceRefs.length > 0) {
    lines.push('Evidence refs: ' + contract.evidenceRefs.join(', '));
  }
  lines.push('', 'Failed checks:');
  for (const check of contract.failedChecks) {
    lines.push(`- [${check.severity}] ${check.category}/${check.name}: ${check.evidence}`);
    if (check.acceptanceCriterion) {
      lines.push(`  AC: ${check.acceptanceCriterion}`);
    }
  }
  if (contract.expectation?.expectedBehavior) {
    lines.push('', 'Expected: ' + contract.expectation.expectedBehavior);
  }
  if (contract.actual?.actualBehavior) {
    lines.push('Actual: ' + contract.actual.actualBehavior);
  }
  if (contract.location?.url) {
    lines.push('Location: ' + contract.location.url);
  }
  if (contract.location?.testId) {
    lines.push('Test id: ' + contract.location.testId);
  }
  if (contract.location?.selector) {
    lines.push('Selector: ' + contract.location.selector);
  }
  if (contract.location?.method) {
    lines.push('Method: ' + contract.location.method);
  }
  if (contract.reproduction?.requestData) {
    lines.push('Request: ' + contract.reproduction.requestData);
  }
  if (contract.repairContract) {
    lines.push('', 'Required outcome: ' + contract.repairContract.requiredOutcome);
    if (contract.repairContract.constraints?.length) {
      lines.push('Constraints: ' + contract.repairContract.constraints.join('; '));
    }
    if (contract.repairContract.mustNotChange?.length) {
      lines.push('Must not change: ' + contract.repairContract.mustNotChange.join('; '));
    }
  }
  if (contract.acceptanceCriteria.length > 0) {
    lines.push('');
    lines.push('Acceptance criteria:');
    for (const criterion of contract.acceptanceCriteria) {
      lines.push(`- ${criterion}`);
    }
  }
  lines.push('');
  lines.push('Repair instructions:');
  lines.push(contract.repairInstructions);
  return lines.join('\n');
}
