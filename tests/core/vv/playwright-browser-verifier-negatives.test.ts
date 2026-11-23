import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { PlaywrightBrowserVerifier } from '../../../src/core/vv/playwright-browser-verifier';

jest.setTimeout(60000);

function html(body: string): string {
  return '<!doctype html><html><head><title>fixture</title></head><body>' + body + '</body></html>';
}

async function withServer(
  routes: Record<string, { status?: number; body?: string; destroy?: boolean }>,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    const pathname = url.split('?')[0];
    const route = routes[pathname] || (pathname === '/' ? routes['/'] : undefined);
    if (!route) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    if (route.destroy) {
      req.socket.destroy();
      return;
    }
    res.statusCode = route.status ?? 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(route.body ?? '');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const previous = process.env.AGENT_VV_BASE_URL;
  process.env.AGENT_VV_BASE_URL = 'http://127.0.0.1:' + port;
  try {
    await fn('http://127.0.0.1:' + port);
  } finally {
    if (previous === undefined) delete process.env.AGENT_VV_BASE_URL;
    else process.env.AGENT_VV_BASE_URL = previous;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

function tempApp(extraPages: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-br-neg-'));
  fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app', 'page.tsx'), 'export default function Page() { return <div>home</div>; }');
  for (const page of extraPages) {
    const folder = path.join(dir, 'app', page);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'page.tsx'), 'export default function Page() { return <div>' + page + '</div>; }');
  }
  return dir;
}

describe('PlaywrightBrowserVerifier negatives', () => {
  const verifier = new PlaywrightBrowserVerifier();

  it('fails pageerror / uncaught exception', async () => {
    const dir = tempApp();
    await withServer({
      '/': { body: html('<script>throw new Error("controlled pageerror")</script><div>home</div>') },
    }, async () => {
      const checks = await verifier.verify({ workspacePath: dir, profile: 'STANDARD', task: 'home page' });
      expect(checks.some(c => c.id.startsWith('browser-pageerror') && !c.passed)).toBe(true);
      expect(checks.find(c => c.id.startsWith('browser-pageerror'))?.evidence).toMatch(/pageerror:/);
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fails console.error without pageerror', async () => {
    const dir = tempApp();
    await withServer({
      '/': { body: html('<script>console.error("controlled console failure")</script><div>home</div>') },
    }, async () => {
      const checks = await verifier.verify({ workspacePath: dir, profile: 'STANDARD', task: 'home page' });
      expect(checks.some(c => c.id.startsWith('browser-pageerror') && c.passed)).toBe(true);
      expect(checks.some(c => c.id.startsWith('browser-console-error') && !c.passed)).toBe(true);
      expect(checks.find(c => c.id.startsWith('browser-console-error'))?.evidence).toMatch(/controlled console failure/);
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fails a missing required DOM element with structured evidence', async () => {
    const dir = tempApp();
    await withServer({
      '/': { body: html('<div>home</div>') },
    }, async () => {
      const checks = await verifier.verify({
        workspacePath: dir,
        profile: 'STANDARD',
        task: 'home page data-testid=sandbox-vv-footer',
      });
      const failed = checks.find(c => c.id.startsWith('browser-dom') && !c.passed);
      expect(failed).toBeDefined();
      expect(failed?.evidence).toMatch(/Expected: \[data-testid="sandbox-vv-footer"\]/);
      expect(failed?.evidence).toMatch(/Actual: element not found/);
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fails missing expected text using a locator, not only body dump', async () => {
    const dir = tempApp();
    await withServer({
      '/': { body: html('<div>other copy</div>') },
    }, async () => {
      const checks = await verifier.verify({
        workspacePath: dir,
        profile: 'STANDARD',
        task: 'home page exact visible text Sandbox VnV repair marker',
      });
      const failed = checks.find(c => c.id.startsWith('browser-dom') && !c.passed);
      expect(failed).toBeDefined();
      expect(failed?.evidence).toMatch(/Expected: exact visible text "Sandbox VnV repair marker"/);
      expect(failed?.evidence).toMatch(/Actual: element not found/);
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fails a destroyed XHR/fetch request', async () => {
    const dir = tempApp();
    await withServer({
      '/': { body: html('<div>home</div><script>fetch("/drop")</script>') },
      '/drop': { destroy: true },
    }, async () => {
      const checks = await verifier.verify({ workspacePath: dir, profile: 'STANDARD', task: 'home page' });
      expect(checks.some(c => c.id.startsWith('browser-network') && !c.passed)).toBe(true);
      expect(checks.find(c => c.id.startsWith('browser-network'))?.evidence).toMatch(/requestfailed:/);
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fails unexpected HTTP 5xx on fetch and records it in evidence', async () => {
    const dir = tempApp();
    await withServer({
      '/': { body: html('<div>home</div><script>fetch("/api/boom")</script>') },
      '/api/boom': { status: 500, body: '{"error":true}' },
    }, async () => {
      const checks = await verifier.verify({ workspacePath: dir, profile: 'STANDARD', task: 'home page' });
      const network = checks.find(c => c.id.startsWith('browser-network'));
      expect(network?.passed).toBe(false);
      expect(network?.evidence).toMatch(/http5xx:/);
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fails a broken document route as navigation failure', async () => {
    const dir = tempApp(['broken']);
    await withServer({
      '/': { body: html('<div>home</div>') },
      '/broken': { status: 404, body: 'missing' },
    }, async () => {
      const checks = await verifier.verify({
        workspacePath: dir,
        profile: 'STANDARD',
        task: 'page /broken must load',
      });
      expect(checks.some(c => c.id.includes('browser-nav-broken') && !c.passed)).toBe(true);
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
