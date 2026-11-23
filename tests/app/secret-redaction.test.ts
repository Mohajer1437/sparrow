import { REDACTED, isSensitiveKey, redactText, redactValue } from '../../src/app/secret-redaction';

describe('secret redaction', () => {
  it('redacts bearer tokens and provider keys inside free text', () => {
    const text = 'request failed: Authorization: Bearer abcdef1234567890 and key sk-abcdefghijklmnopqr';
    const redacted = redactText(text);
    expect(redacted).not.toContain('abcdef1234567890');
    expect(redacted).not.toContain('sk-abcdefghijklmnopqr');
    expect(redacted).toContain(REDACTED);
  });

  it('keeps the key but removes the value in assignment shapes', () => {
    const redacted = redactText('DATABASE_PASSWORD=hunter2super ADMIN_TOKEN=zzzz9999');
    expect(redacted).toContain('DATABASE_PASSWORD=');
    expect(redacted).not.toContain('hunter2super');
    expect(redacted).not.toContain('zzzz9999');
  });

  it('redacts credentials embedded in connection strings', () => {
    const redacted = redactText('postgres://app:sup3rs3cret@db.internal:5432/app');
    expect(redacted).not.toContain('sup3rs3cret');
    expect(redacted).toContain('postgres://app:');
  });

  it('redacts sensitive object keys at any depth', () => {
    const value = redactValue({
      safe: 'ok',
      nested: { apiKey: 'abc123', cookie: 'session=1', deeper: { password: 'p' } },
      list: [{ token: 'xyz' }],
    });
    expect(value.safe).toBe('ok');
    expect(value.nested.apiKey).toBe(REDACTED);
    expect(value.nested.cookie).toBe(REDACTED);
    expect(value.nested.deeper.password).toBe(REDACTED);
    expect(value.list[0].token).toBe(REDACTED);
  });

  it('recognizes sensitive key names', () => {
    expect(isSensitiveKey('ADMIN_TOKEN')).toBe(true);
    expect(isSensitiveKey('authorization')).toBe(true);
    expect(isSensitiveKey('stepId')).toBe(false);
  });

  it('does not treat verification or usage fields as secrets', () => {
    expect(isSensitiveKey('passed')).toBe(false);
    expect(isSensitiveKey('tokens')).toBe(false);
    expect(isSensitiveKey('totalTokens')).toBe(false);
    expect(redactValue({ passed: true, tokens: 120 })).toEqual({ passed: true, tokens: 120 });
  });

  it('leaves ordinary pipeline text untouched', () => {
    const text = 'todo-2 failed: tsc exited 2 in app/page.tsx';
    expect(redactText(text)).toBe(text);
  });
});
