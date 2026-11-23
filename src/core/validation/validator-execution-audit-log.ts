import {
  ValidatorExecutionEvidence,
  ValidatorExecutionResult,
  ValidatorGovernanceActor,
  ValidatorLifecycleState,
  freezeActor,
} from '../../domain/validator-governance';

/**
 * In-memory record of what validators actually did.
 *
 * The governance audit log answers "who changed what". This one answers "what
 * ran, and how did it end" — including the runs that never reached the
 * validator body, because a refusal is evidence too.
 *
 * Append-only, frozen on the way out, and gone when the process is. No
 * database, no file, no lock.
 */

export type ExecutionClock = () => Date;

export interface ValidatorExecutionRecord extends ValidatorExecutionEvidence {
  /** Who ran it. In practice the runner, recorded so evidence is attributable. */
  readonly actor: ValidatorGovernanceActor;
}

export interface ValidatorExecutionEvidenceInput {
  readonly validatorName: string;
  readonly fingerprint: string;
  readonly contractVersion: string;
  readonly lifecycleState: ValidatorLifecycleState;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly result: ValidatorExecutionResult;
  readonly errorCode?: string;
  readonly actor: ValidatorGovernanceActor;
}

export class ValidatorExecutionAuditLog {
  private readonly records: ValidatorExecutionRecord[] = [];

  constructor(private readonly clock: ExecutionClock = () => new Date()) {}

  /** The clock, exposed so a caller can stamp a start before running. */
  now(): Date {
    return this.clock();
  }

  record(input: ValidatorExecutionEvidenceInput): ValidatorExecutionRecord {
    const evidence: ValidatorExecutionRecord = Object.freeze({
      validatorName: input.validatorName,
      fingerprint: input.fingerprint,
      contractVersion: input.contractVersion,
      lifecycleState: input.lifecycleState,
      startedAt: input.startedAt.toISOString(),
      completedAt: input.completedAt.toISOString(),
      result: input.result,
      errorCode: input.errorCode,
      actor: freezeActor(input.actor),
    });
    this.records.push(evidence);
    return evidence;
  }

  history(): ReadonlyArray<ValidatorExecutionRecord> {
    return Object.freeze([...this.records]);
  }

  historyForValidator(validatorName: string): ReadonlyArray<ValidatorExecutionRecord> {
    const key = validatorName.trim().toLowerCase();
    return Object.freeze(
      this.records.filter(record => record.validatorName.trim().toLowerCase() === key),
    );
  }

  size(): number {
    return this.records.length;
  }

  /** Drops all recorded evidence. For tests that need a clean history. */
  clear(): void {
    this.records.length = 0;
  }
}
