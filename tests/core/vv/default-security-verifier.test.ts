import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DefaultSecurityVerifier } from '../../../src/core/vv/default-security-verifier';

describe('DefaultSecurityVerifier', () => {
  it('fails when a hardcoded secret is present', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-sec-'));
    const src = path.join(dir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'config.ts'), 'export const token = "supersecretvalue";\n');

    const verifier = new DefaultSecurityVerifier();
    const checks = await verifier.verify({
      workspacePath: dir,
      profile: 'STANDARD',
      changedFiles: ['src/config.ts'],
    });
    fs.rmSync(dir, { recursive: true, force: true });

    expect(checks.find(c => c.id === 'security-secrets')?.passed).toBe(false);
  });

  it('fails dangerous sinks only in PRODUCTION', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-sec-'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'html.ts'), 'el.innerHTML = userInput;\n');

    const verifier = new DefaultSecurityVerifier();
    const standard = await verifier.verify({ workspacePath: dir, profile: 'STANDARD', changedFiles: ['src/html.ts'] });
    const production = await verifier.verify({ workspacePath: dir, profile: 'PRODUCTION', changedFiles: ['src/html.ts'] });
    fs.rmSync(dir, { recursive: true, force: true });

    expect(standard.find(c => c.id === 'security-dangerous-sinks')?.passed).toBe(true);
    expect(production.find(c => c.id === 'security-dangerous-sinks')?.passed).toBe(false);
  });
});
