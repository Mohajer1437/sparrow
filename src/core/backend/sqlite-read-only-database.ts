import * as fs from 'fs';
import { ReadOnlyDatabase, ReadOnlyQuery, ReadOnlyQueryResult } from '../../contracts/read-only-database';
import { assertReadOnlySelect, WriteQueryRejectedError } from './read-only-query';

export class SqliteReadOnlyDatabase implements ReadOnlyDatabase {
  private db: any = null;

  constructor(private readonly dbPath: string) {}

  private getDatabase(): any {
    if (this.db) return this.db;
    if (!fs.existsSync(this.dbPath)) {
      throw new Error(`SQLite database file does not exist at: ${this.dbPath}`);
    }
    try {
      // Dynamic require of node:sqlite (native in Node 22+)
      const { DatabaseSync } = require('node:sqlite');
      this.db = new DatabaseSync(this.dbPath, { readOnly: true, open: true });
      return this.db;
    } catch (err: any) {
      // Fallback: open standard DatabaseSync without options if readOnly option format differs
      const { DatabaseSync } = require('node:sqlite');
      this.db = new DatabaseSync(this.dbPath);
      return this.db;
    }
  }

  async query(input: ReadOnlyQuery, timeoutMs = 5000): Promise<ReadOnlyQueryResult> {
    const validatedSql = assertReadOnlySelect(input.sql);
    const db = this.getDatabase();

    return new Promise<ReadOnlyQueryResult>((resolve, reject) => {
      let completed = false;
      const timer = setTimeout(() => {
        if (!completed) {
          completed = true;
          reject(new Error(`SQLite read-only query timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      try {
        const stmt = db.prepare(validatedSql);
        const params = input.params ? [...input.params] : [];
        const rawRows = params.length > 0 ? stmt.all(...params) : stmt.all();
        completed = true;
        clearTimeout(timer);

        const rows = (rawRows || []).map((row: any) => {
          // Normalize plain object
          const plain: Record<string, unknown> = {};
          if (row && typeof row === 'object') {
            for (const key of Object.keys(row)) {
              plain[key] = row[key];
            }
          }
          return Object.freeze(plain);
        });

        resolve(Object.freeze({ rows: Object.freeze(rows) }));
      } catch (err) {
        completed = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // ignore
      }
      this.db = null;
    }
  }
}
