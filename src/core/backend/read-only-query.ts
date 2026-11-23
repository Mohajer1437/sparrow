const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|MERGE|GRANT|REVOKE|COPY|LOAD|CALL|DO|EXECUTE|INTO|VACUUM|ATTACH|DETACH)\b/i;
const FOR_UPDATE = /\bFOR\s+(UPDATE|SHARE)\b/i;

export class WriteQueryRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WriteQueryRejectedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Verification may only run a single SELECT. Any mutation or multi-statement
 * payload is rejected before it reaches a driver.
 */
export function assertReadOnlySelect(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) {
    throw new WriteQueryRejectedError('Empty verification query');
  }
  const withoutTrailing = trimmed.replace(/;+\s*$/, '');
  if (withoutTrailing.includes(';')) {
    throw new WriteQueryRejectedError('Multiple SQL statements are not allowed');
  }
  if (!/^\s*SELECT\b/i.test(withoutTrailing)) {
    throw new WriteQueryRejectedError('Verification queries must be SELECT');
  }
  if (FORBIDDEN.test(withoutTrailing) || FOR_UPDATE.test(withoutTrailing)) {
    throw new WriteQueryRejectedError('Verification queries must be read-only SELECT');
  }
  return withoutTrailing;
}
