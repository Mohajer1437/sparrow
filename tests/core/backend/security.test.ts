import { RuntimeSecretHolder } from '../../../src/core/backend/runtime-secrets';
import { redactText, redactValue } from '../../../src/core/security/secret-redaction';
import { backendReportToChecks } from '../../../src/core/backend/report-to-checks';
import { formatTestCredentialRequest } from '../../../src/domain/test-credential';

describe('backend verification security', () => {
  it('holds tokens only in memory and redacts JSON dumps of the holder', () => {
    const holder = new RuntimeSecretHolder({
      adminAccessToken: 'super-secret-admin-token',
      userAccessToken: 'user-secret-token',
      databaseUrl: 'postgres://agent:p4ssw0rd@localhost:5432/app',
    });
    expect(JSON.stringify(holder)).not.toContain('super-secret-admin-token');
    expect(JSON.stringify(holder)).not.toContain('p4ssw0rd');
    expect(JSON.stringify(holder.get())).toContain('super-secret-admin-token');
    holder.clear();
    expect(holder.get().adminAccessToken).toBeUndefined();
  });

  it('redacts authorization headers, tokens and connection strings', () => {
    const text = [
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaa.bbbb',
      'token=abc123secret',
      'postgres://agent:s3cret@localhost:5432/app',
    ].join('\n');
    const redacted = redactText(text);
    expect(redacted).not.toMatch(/eyJhbGci/);
    expect(redacted).not.toContain('abc123secret');
    expect(redacted).not.toContain('s3cret');
    expect(redacted).toContain('[REDACTED]');
    expect(redactValue({ authorization: 'Bearer abc', password: 'x', dsn: 'mysql://u:p@h/db' })).toEqual({
      authorization: '[REDACTED]',
      password: '[REDACTED]',
      dsn: '[REDACTED]',
    });
  });

  it('never puts a credential value on the user-interaction contract', () => {
    const formatted = formatTestCredentialRequest({
      kind: 'REQUIRES_TEST_CREDENTIAL',
      environment: 'test',
      scope: 'admin API',
      endpoints: [{ method: 'POST', path: '/api/admin/users' }],
      requiredCredential: 'admin_access_token',
      reason: 'Admin endpoint detected',
    });
    expect(formatted).toContain('REQUIRES_TEST_CREDENTIAL');
    expect(formatted).toContain('value=[REDACTED]');
    expect(formatted).not.toMatch(/Bearer /);
    const checks = backendReportToChecks({
      endpoints: [],
      results: [],
      coverage: { discovered: 0, tested: 0, passed: 0, failed: 0, blocked: 0, skipped: 0, notTested: 0, skippedReasons: [] },
      credentialRequest: {
        kind: 'REQUIRES_TEST_CREDENTIAL',
        environment: 'test',
        scope: 'admin API',
        endpoints: ['POST /api/admin/users'],
        requiredCredential: 'admin_access_token',
      },
    });
    const blob = JSON.stringify(checks);
    expect(blob).toContain('[REDACTED]');
    expect(blob).not.toMatch(/sk-|eyJ/);
  });
});
