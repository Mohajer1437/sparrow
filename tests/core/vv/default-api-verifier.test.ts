import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { DefaultApiVerifier } from '../../../src/core/vv/default-api-verifier';

jest.setTimeout(20000);

async function withApiServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
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

describe('DefaultApiVerifier', () => {
  it('skips API checks for MVP', async () => {
    const verifier = new DefaultApiVerifier();
    const checks = await verifier.verify({ workspacePath: os.tmpdir(), profile: 'MVP' });
    expect(checks).toEqual([]);
  });

  it('treats unreachable API as a STANDARD gap and a PRODUCTION failure when routes exist', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-api-'));
    const routeDir = path.join(dir, 'app', 'api', 'health');
    fs.mkdirSync(routeDir, { recursive: true });
    fs.writeFileSync(path.join(routeDir, 'route.ts'), 'export async function GET() { return Response.json({ ok: true }); }');
    const previous = process.env.AGENT_VV_BASE_URL;
    process.env.AGENT_VV_BASE_URL = 'http://127.0.0.1:1';

    const verifier = new DefaultApiVerifier();
    const standard = await verifier.verify({ workspacePath: dir, profile: 'STANDARD', task: 'GET /api/health' });
    const production = await verifier.verify({ workspacePath: dir, profile: 'PRODUCTION' });
    fs.rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.AGENT_VV_BASE_URL;
    else process.env.AGENT_VV_BASE_URL = previous;

    expect(standard.some(c => c.id === 'api-route-discovery' && c.passed)).toBe(true);
    expect(standard.find(c => c.id === 'api-runtime')?.passed).toBe(true);
    expect(production.find(c => c.id === 'api-runtime')?.passed).toBe(false);
  });

  it('does not probe live endpoints on STANDARD when the task is UI-only', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-api-ui-'));
    const routeDir = path.join(dir, 'app', 'api', 'health');
    fs.mkdirSync(routeDir, { recursive: true });
    fs.writeFileSync(path.join(routeDir, 'route.ts'), 'export async function GET() { return Response.json({ ok: true }); }');
    const previous = process.env.AGENT_VV_BASE_URL;
    process.env.AGENT_VV_BASE_URL = 'http://127.0.0.1:1';
    const verifier = new DefaultApiVerifier();
    const checks = await verifier.verify({
      workspacePath: dir,
      profile: 'STANDARD',
      task: 'set the home-page footer exact visible text to Ready',
    });
    if (previous === undefined) delete process.env.AGENT_VV_BASE_URL;
    else process.env.AGENT_VV_BASE_URL = previous;
    fs.rmSync(dir, { recursive: true, force: true });
    expect(checks.every(c => c.id === 'api-route-discovery')).toBe(true);
    expect(checks.some(c => c.id === 'api-runtime')).toBe(false);
  });

  it('fails missing, invalid, malformed, unauthorized, duplicate, and 5xx paths with structured evidence', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-api-live-'));
    const saveDir = path.join(dir, 'app', 'api', 'save');
    fs.mkdirSync(saveDir, { recursive: true });
    fs.writeFileSync(path.join(saveDir, 'route.ts'), `
export async function POST(req: Request) {
  const { id } = await req.json();
  return Response.json({ success: true, id });
}
`);
    const authDir = path.join(dir, 'app', 'api', 'private');
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(path.join(authDir, 'route.ts'), `
export async function GET() {
  const session = cookies();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json({ ok: true });
}
`);

    await withApiServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/private') {
        if (!req.headers.cookie) {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.pathname === '/api/save' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          if (!body) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Failed to save card' }));
            return;
          }
          try {
            JSON.parse(body);
          } catch {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Failed to save card' }));
            return;
          }
          res.end(JSON.stringify({ success: true }));
        });
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
    }, async () => {
      const verifier = new DefaultApiVerifier();
      const checks = await verifier.verify({
        workspacePath: dir,
        profile: 'PRODUCTION',
        task: 'POST /api/save must reject missing JSON with 400',
      });
      const missing = checks.find(c => c.id.includes('missing-input'));
      const malformed = checks.find(c => c.id.includes('malformed-input'));
      const invalid = checks.find(c => c.id.includes('invalid-input'));
      expect(missing?.passed).toBe(false);
      expect(malformed?.passed).toBe(false);
      expect(invalid).toBeDefined();
      expect(missing?.evidence).toMatch(/method: POST/);
      expect(missing?.evidence).toMatch(/scenario: missing-input/);
      expect(missing?.evidence).toMatch(/Actual: 500/);
      expect(missing?.evidence).toMatch(/Expected:/);

      const privateChecks = await verifier.verify({
        workspacePath: dir,
        profile: 'PRODUCTION',
        task: 'GET /api/private',
      });
      const unauth = privateChecks.find(c => c.id.includes('unauthorized'));
      expect(unauth).toBeDefined();
      expect(unauth?.evidence).toMatch(/scenario: unauthorized/);
    });

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
