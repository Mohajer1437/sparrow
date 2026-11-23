import { ReadOnlyDatabase, ReadOnlyQuery, ReadOnlyQueryResult } from '../../contracts/read-only-database';
import { assertReadOnlySelect } from './read-only-query';

/**
 * Isolated fixture database. Never touches a real user database.
 */
export class InMemoryReadOnlyDatabase implements ReadOnlyDatabase {
  constructor(private readonly tables: Record<string, ReadonlyArray<Readonly<Record<string, unknown>>>>) {}

  async query(input: ReadOnlyQuery, _timeoutMs: number): Promise<ReadOnlyQueryResult> {
    const sql = assertReadOnlySelect(input.sql);
    const tableMatch = sql.match(/\bFROM\s+([A-Za-z_][\w]*)/i);
    if (!tableMatch) {
      return { rows: Object.freeze([]) };
    }
    const table = tableMatch[1];
    const rows = [...(this.tables[table] ?? [])];
    const where = sql.match(/\bWHERE\s+([A-Za-z_][\w]*)\s*=\s*'((?:[^']|'')*)'/i);
    const filtered = where
      ? rows.filter(row => String(row[where[1]] ?? '') === where[2].replace(/''/g, "'"))
      : rows;
    return { rows: Object.freeze(filtered.map(row => Object.freeze({ ...row }))) };
  }
}
