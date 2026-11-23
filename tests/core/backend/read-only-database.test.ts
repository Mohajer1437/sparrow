import { assertReadOnlySelect, WriteQueryRejectedError } from '../../../src/core/backend/read-only-query';
import { ReadOnlyDatabaseVerifier } from '../../../src/core/backend/read-only-database';
import { InMemoryReadOnlyDatabase } from '../../../src/core/backend/in-memory-read-only-database';

describe('read-only database verification', () => {
  it('accepts SELECT and matches expected fields', async () => {
    const verifier = new ReadOnlyDatabaseVerifier(new InMemoryReadOnlyDatabase({
      users: [{ id: '42', email: 'a@example.com' }],
    }));
    const result = await verifier.verify({
      assertion: {
        table: 'users',
        keyField: 'id',
        keyValue: '42',
        expectedFields: { email: 'a@example.com' },
      },
      timeoutMs: 1000,
      maxRows: 10,
    });
    expect(result.status).toBe('PASS');
    expect(result.queried).toBe(true);
  });

  it('fails when the record is missing or a field is wrong', async () => {
    const verifier = new ReadOnlyDatabaseVerifier(new InMemoryReadOnlyDatabase({
      users: [{ id: '42', email: 'other@example.com' }],
    }));
    const missing = await verifier.verify({
      assertion: { table: 'users', keyField: 'id', keyValue: '99', expectedFields: { email: 'a@example.com' } },
      timeoutMs: 1000,
      maxRows: 10,
    });
    expect(missing.status).toBe('FAIL');
    const wrong = await verifier.verify({
      assertion: { table: 'users', keyField: 'id', keyValue: '42', expectedFields: { email: 'a@example.com' } },
      timeoutMs: 1000,
      maxRows: 10,
    });
    expect(wrong.status).toBe('FAIL');
    expect(wrong.reason).toMatch(/email/);
  });

  it('rejects write and destructive queries before they run', () => {
    expect(() => assertReadOnlySelect('INSERT INTO users VALUES (1)')).toThrow(WriteQueryRejectedError);
    expect(() => assertReadOnlySelect('UPDATE users SET email=1')).toThrow(WriteQueryRejectedError);
    expect(() => assertReadOnlySelect('DELETE FROM users')).toThrow(WriteQueryRejectedError);
    expect(() => assertReadOnlySelect('DROP TABLE users')).toThrow(WriteQueryRejectedError);
    expect(() => assertReadOnlySelect('ALTER TABLE users ADD x int')).toThrow(WriteQueryRejectedError);
    expect(() => assertReadOnlySelect('TRUNCATE users')).toThrow(WriteQueryRejectedError);
    expect(() => assertReadOnlySelect('CREATE TABLE x (id int)')).toThrow(WriteQueryRejectedError);
    expect(() => assertReadOnlySelect('SELECT 1; DROP TABLE users')).toThrow(WriteQueryRejectedError);
    expect(() => assertReadOnlySelect('SELECT * FROM users FOR UPDATE')).toThrow(WriteQueryRejectedError);
    expect(assertReadOnlySelect('SELECT id FROM users')).toBe('SELECT id FROM users');
  });
});
