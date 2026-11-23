import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PlaywrightBrowserVerifier } from '../../../src/core/vv/playwright-browser-verifier';

describe('PlaywrightBrowserVerifier', () => {
  it('records no-pages as a pass instead of inventing /', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-br-'));
    const verifier = new PlaywrightBrowserVerifier();
    const checks = await verifier.verify({ workspacePath: dir, profile: 'STANDARD' });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(checks.some(c => c.id === 'browser-no-pages' && c.passed)).toBe(true);
  });

  it('fails PRODUCTION when Playwright cannot launch against discovered pages', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-br-'));
    const pageDir = path.join(dir, 'app');
    fs.mkdirSync(pageDir, { recursive: true });
    fs.writeFileSync(path.join(pageDir, 'page.tsx'), 'export default function Page() { return <div>hi</div>; }');

    const verifier = new PlaywrightBrowserVerifier();
    const checks = await verifier.verify({ workspacePath: dir, profile: 'PRODUCTION' });
    fs.rmSync(dir, { recursive: true, force: true });

    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every(c => c.category === 'browser')).toBe(true);
  });
});
