/**
 * R1.21, R1.25-R1.28 — verification that inspects must not mutate, and any
 * mutation it does perform has to be declared and visible.
 */

import * as http from 'http';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DefaultApiVerifier } from '../../../src/core/vv/default-api-verifier';
import { ensureProductionServer } from '../../../src/core/vv/production-app-server';
import { loadIntentContract, saveIntentContract } from '../../../src/core/vv/intent-contract-store';
import { buildSideEffectLedger } from '../../../src/domain/verification-side-effect';
import { ProductAnalysis } from '../../../src/domain/product-analysis';

jest.setTimeout(30000);

async function withApiServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
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

async function makeApiWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'r1-sideeffect-'));
  const routeDir = path.join(dir, 'app', 'api', 'cards');
  await fs.mkdir(routeDir, { recursive: true });
  await fs.writeFile(
    path.join(routeDir, 'route.ts'),
    'export async function GET() { return Response.json([]); }\n'
    + 'export async function POST(request: Request) { return Response.json({ id: 1 }, { status: 201 }); }\n',
    'utf8',
  );
  return dir;
}

describe('API verification side effects (R1.21, R1.28)', () => {
  it('refuses mutating HTTP probes under a READ_ONLY policy and records them as BLOCKED', async () => {
    const dir = await makeApiWorkspace();
    const methods: string[] = [];
    try {
      await withApiServer(
        (req, res) => {
          methods.push(req.method || '');
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end('[]');
        },
        async () => {
          const verifier = new DefaultApiVerifier();
          await verifier.verify({
            workspacePath: dir,
            profile: 'PRODUCTION',
            task: 'POST /api/cards saves a card',
            sideEffectPolicy: 'READ_ONLY',
          });

          const effects = verifier.drainSideEffects?.() ?? [];
          expect(effects.length).toBeGreaterThan(0);
          expect(effects.every(effect => effect.status === 'BLOCKED')).toBe(true);
          expect(effects.every(effect => effect.declared)).toBe(true);
          expect(effects.every(effect => effect.kind === 'HTTP_MUTATION')).toBe(true);
        },
      );

      // The structural proof: the live server never saw a mutating verb.
      expect(methods.filter(method => !['GET', 'HEAD', 'OPTIONS'].includes(method))).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('performs and declares mutating probes under CONTROLLED_MUTATION', async () => {
    const dir = await makeApiWorkspace();
    const methods: string[] = [];
    try {
      await withApiServer(
        (req, res) => {
          methods.push(req.method || '');
          res.statusCode = req.method === 'POST' ? 201 : 200;
          res.setHeader('content-type', 'application/json');
          res.end(req.method === 'POST' ? '{"id":1}' : '[]');
        },
        async () => {
          const verifier = new DefaultApiVerifier();
          await verifier.verify({
            workspacePath: dir,
            profile: 'PRODUCTION',
            task: 'POST /api/cards saves a card',
            sideEffectPolicy: 'CONTROLLED_MUTATION',
          });

          const effects = verifier.drainSideEffects?.() ?? [];
          const ledger = buildSideEffectLedger({ policy: 'CONTROLLED_MUTATION', effects });
          expect(ledger.performedCount).toBeGreaterThan(0);
          expect(ledger.undeclaredCount).toBe(0);
        },
      );

      expect(methods).toContain('POST');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Intent contract persistence (R1.26, R1.27)', () => {
  const analysis = { intent: { userGoal: 'add a comment' } } as unknown as ProductAnalysis;
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'r1-intent-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes nothing under READ_ONLY and reports the effect as BLOCKED', async () => {
    const effect = await saveIntentContract(dir, analysis, 'READ_ONLY');

    expect(effect?.status).toBe('BLOCKED');
    expect(effect?.declared).toBe(true);
    await expect(fs.access(path.join(dir, '.ai'))).rejects.toBeTruthy();
    await expect(loadIntentContract(dir)).resolves.toBeUndefined();
  });

  it('writes and declares the effect under CONTROLLED_MUTATION', async () => {
    const effect = await saveIntentContract(dir, analysis, 'CONTROLLED_MUTATION');

    expect(effect?.status).toBe('PERFORMED');
    expect(effect?.declared).toBe(true);
    expect(effect?.reversible).toBe(true);
    expect(effect?.target).toContain('.ai');
    await expect(loadIntentContract(dir)).resolves.toMatchObject({ intent: { userGoal: 'add a comment' } });
  });

  it('confines the write to .ai and leaves project files untouched', async () => {
    await fs.writeFile(path.join(dir, 'page.tsx'), 'original', 'utf8');
    await saveIntentContract(dir, analysis, 'CONTROLLED_MUTATION');
    await expect(fs.readFile(path.join(dir, 'page.tsx'), 'utf8')).resolves.toBe('original');
  });
});

describe('Production server side effects (R1.21, R1.27)', () => {
  it('refuses to build or spawn under READ_ONLY and leaves the build directory alone', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'r1-prod-'));
    try {
      await fs.writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'x', scripts: { build: 'echo build', start: 'echo start' } }),
        'utf8',
      );
      await fs.mkdir(path.join(dir, '.next'), { recursive: true });
      await fs.writeFile(path.join(dir, '.next', 'marker'), 'kept', 'utf8');

      const session = await ensureProductionServer({
        workspacePath: dir,
        // Nothing is listening here, so the reachability branch is skipped.
        baseUrl: 'http://127.0.0.1:3010',
        sideEffectPolicy: 'READ_ONLY',
      });

      expect(session.started).toBe(false);
      expect(session.error).toContain('READ_ONLY');
      expect(session.sideEffects?.every(effect => effect.status === 'BLOCKED')).toBe(true);
      expect(session.sideEffects?.map(effect => effect.kind).sort()).toEqual(['FILE_WRITE', 'PROCESS_SPAWN']);
      await expect(fs.readFile(path.join(dir, '.next', 'marker'), 'utf8')).resolves.toBe('kept');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
