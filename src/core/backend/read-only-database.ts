import { ReadOnlyDatabase, ReadOnlyQuery, ReadOnlyQueryResult } from '../../contracts/read-only-database';
import { PersistenceAssertion, PersistenceResult } from '../../domain/endpoint-verification';
import { redactText } from '../security/secret-redaction';
import { assertReadOnlySelect, WriteQueryRejectedError } from './read-only-query';

export class ReadOnlyDatabaseVerifier {
  constructor(private readonly database?: ReadOnlyDatabase) {}

  async verify(input: {
    readonly assertion: PersistenceAssertion;
    readonly timeoutMs: number;
    readonly maxRows: number;
  }): Promise<PersistenceResult> {
    if (!this.database) {
      return Object.freeze({
        status: 'NOT_TESTED',
        queried: false,
        reason: 'no database connection available for read-only verification',
        evidence: 'persistence: NOT_TESTED; reason=no database connection',
      });
    }
    const sql = buildSelect(input.assertion);
    try {
      assertReadOnlySelect(sql);
      const result = await this.database.query({ sql, params: [] }, input.timeoutMs);
      return matchAssertion(input.assertion, result, input.maxRows);
    } catch (error) {
      if (error instanceof WriteQueryRejectedError) {
        return Object.freeze({
          status: 'BLOCKED',
          queried: false,
          reason: error.message,
          evidence: 'persistence: BLOCKED; reason=' + error.message,
        });
      }
      return Object.freeze({
        status: 'FAIL',
        queried: false,
        reason: String((error as Error).message || error),
        evidence: 'persistence: FAIL; reason=' + redactText(String((error as Error).message || error)),
      });
    }
  }

  async executeReadOnly(query: ReadOnlyQuery, timeoutMs: number): Promise<ReadOnlyQueryResult> {
    assertReadOnlySelect(query.sql);
    if (!this.database) {
      throw new WriteQueryRejectedError('no database connection available');
    }
    return this.database.query({ sql: assertReadOnlySelect(query.sql), params: query.params }, timeoutMs);
  }
}

function buildSelect(assertion: PersistenceAssertion): string {
  const table = sanitizeIdent(assertion.table);
  const columns = Object.keys(assertion.expectedFields).map(sanitizeIdent);
  const selectList = columns.length > 0 ? columns.join(', ') : '*';
  if (assertion.keyField && assertion.keyValue !== undefined) {
    return `SELECT ${selectList} FROM ${table} WHERE ${sanitizeIdent(assertion.keyField)} = '${escapeLiteral(String(assertion.keyValue))}'`;
  }
  return `SELECT ${selectList} FROM ${table}`;
}

function matchAssertion(
  assertion: PersistenceAssertion,
  result: ReadOnlyQueryResult,
  maxRows: number,
): PersistenceResult {
  const rows = result.rows.slice(0, maxRows);
  if (rows.length === 0) {
    return Object.freeze({
      status: 'FAIL',
      queried: true,
      reason: 'expected record not found',
      evidence: `persistence: FAIL; table=${assertion.table}; reason=missing record`,
    });
  }
  const row = rows[0];
  for (const [field, expected] of Object.entries(assertion.expectedFields)) {
    if (!deepEqual(row[field], expected)) {
      return Object.freeze({
        status: 'FAIL',
        queried: true,
        reason: `field ${field} did not match`,
        evidence: `persistence: FAIL; table=${assertion.table}; field=${field}; expected=${fmt(expected)}; actual=${fmt(row[field])}`,
      });
    }
  }
  return Object.freeze({
    status: 'PASS',
    queried: true,
    evidence: `persistence: PASS; table=${assertion.table}; rows=${rows.length}`,
  });
}

function sanitizeIdent(value: string): string {
  if (!/^[A-Za-z_][\w]*$/.test(value)) {
    throw new WriteQueryRejectedError('Invalid identifier in persistence assertion');
  }
  return value;
}

function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function fmt(value: unknown): string {
  return redactText(JSON.stringify(value) ?? 'undefined').slice(0, 80);
}

function deepEqual(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (actual == null || expected == null) return actual == expected;
  return String(actual) === String(expected);
}
