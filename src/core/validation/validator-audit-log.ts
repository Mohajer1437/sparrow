/**
 * In-memory audit trail for validator contract governance.
 *
 * Every registration decision is recorded, accepted or refused, so the set of
 * validators the process is running can be reconstructed and explained after
 * the fact. There is no database, no file, and no lock: the log lives and dies
 * with the process, and is deliberately append-only from the inside and
 * read-only from the outside.
 */

import { ValidatorGovernanceActor, freezeActor } from '../../domain/validator-governance';

export const VALIDATOR_AUDIT_ACTIONS = [
  'REGISTERED',
  'UPDATED',
  'REJECTED',
  'DEPRECATED',
  'ENABLED',
  'DISABLED',
  /** A deprecated validator was allowed to run; recorded so use can be traced. */
  'EXECUTED_DEPRECATED',
] as const;

export type ValidatorAuditAction = (typeof VALIDATOR_AUDIT_ACTIONS)[number];

export interface ValidatorAuditEvent {
  readonly validatorName: string;
  readonly action: ValidatorAuditAction;
  readonly contractVersion: string;
  readonly fingerprint: string;
  /** ISO-8601 instant the decision was recorded. */
  readonly timestamp: string;
  /** Who asked for the change. The authoritative attribution. */
  readonly actor: ValidatorGovernanceActor;
  /**
   * Free-form label derived from the actor id.
   *
   * Retained so existing readers keep working; `actor` is what governance
   * decisions are attributed to.
   */
  readonly source: string;
  /** Why a REJECTED decision was made. Absent on accepted ones. */
  readonly reason?: string;
}

export interface ValidatorAuditEventInput {
  readonly validatorName: string;
  readonly action: ValidatorAuditAction;
  readonly contractVersion: string;
  readonly fingerprint: string;
  readonly actor: ValidatorGovernanceActor;
  readonly reason?: string;
}

export type AuditClock = () => Date;

/**
 * Append-only history of governance decisions.
 *
 * `history()` and `historyFor()` return frozen copies of frozen events, so a
 * caller can read and even try to edit the result without the log changing.
 */
export class ValidatorAuditLog {
  private readonly events: ValidatorAuditEvent[] = [];

  constructor(private readonly clock: AuditClock = () => new Date()) {}

  record(input: ValidatorAuditEventInput): ValidatorAuditEvent {
    const event: ValidatorAuditEvent = Object.freeze({
      validatorName: input.validatorName,
      action: input.action,
      contractVersion: input.contractVersion,
      fingerprint: input.fingerprint,
      timestamp: this.clock().toISOString(),
      actor: freezeActor(input.actor),
      source: input.actor.id,
      reason: input.reason,
    });
    this.events.push(event);
    return event;
  }

  history(): ReadonlyArray<ValidatorAuditEvent> {
    return Object.freeze([...this.events]);
  }

  historyFor(validatorName: string): ReadonlyArray<ValidatorAuditEvent> {
    const key = validatorName.trim().toLowerCase();
    return Object.freeze(
      this.events.filter(event => event.validatorName.trim().toLowerCase() === key),
    );
  }

  size(): number {
    return this.events.length;
  }

  /** Drops all recorded events. For tests that need a clean history. */
  clear(): void {
    this.events.length = 0;
  }
}
