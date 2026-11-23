/**
 * Phase 2.9 live scenario validation.
 * Creates temp OmniRoute key, runs A–E, restores prior .ai/providers if any.
 */
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  addProviderProfile,
  createProviderProfileStore,
} from '../src/cli/commands/provider-profiles';

const WORKSPACE = path.resolve(process.env.AGENT_WORKSPACE_ROOT || process.cwd());
const PROVIDERS_DIR = path.join(WORKSPACE, '.ai', 'providers');
const BACKUP_DIR = path.join(WORKSPACE, '.ai', 'providers-backup-p29');

function runAgent(args: string[]): { code: number; out: string } {
  const r = spawnSync('npx', ['tsx', path.join(WORKSPACE, 'src/cli/main.ts'), ...args], {
    cwd: WORKSPACE,
    env: { ...process.env, AGENT_WORKSPACE_ROOT: WORKSPACE },
    encoding: 'utf8',
    timeout: 180_000,
    shell: true,
  });
  return { code: r.status ?? 1, out: `${r.stdout || ''}\n${r.stderr || ''}` };
}

function pick(out: string, patterns: RegExp[]): string {
  return patterns
    .map((p) => {
      const m = p.exec(out);
      return m ? m[0].trim() : null;
    })
    .filter(Boolean)
    .join(' | ');
}

async function loginCookie(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 20128,
        path: '/api/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        res.resume();
        const sc = (res.headers['set-cookie'] || []) as string[];
        resolve(sc.map((c) => c.split(';')[0]).join('; '));
      },
    );
    req.on('error', reject);
    req.write(JSON.stringify({ password }));
    req.end();
  });
}

async function createOmniKey(cookie: string): Promise<{ id: string; key: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 20128,
        path: '/api/keys',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode || 0) >= 300) {
            reject(new Error(`create key HTTP ${res.statusCode}: ${text.slice(0, 120)}`));
            return;
          }
          const j = JSON.parse(text);
          resolve({ id: j.id, key: j.key });
        });
      },
    );
    req.on('error', reject);
    req.write(JSON.stringify({ name: `sparrow-p29-${Date.now()}` }));
    req.end();
  });
}

async function deleteOmniKey(cookie: string, id: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 20128,
        path: `/api/keys/${id}`,
        method: 'DELETE',
        headers: { Cookie: cookie },
      },
      (res) => {
        res.resume();
        resolve();
      },
    );
    req.on('error', () => resolve());
    req.end();
  });
}

async function main(): Promise<void> {
  const hadProviders = fs.existsSync(PROVIDERS_DIR);
  if (hadProviders) {
    fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
    fs.cpSync(PROVIDERS_DIR, BACKUP_DIR, { recursive: true });
  }
  fs.rmSync(PROVIDERS_DIR, { recursive: true, force: true });

  const pkgEnv = path.join(process.env.APPDATA || '', 'npm/node_modules/omniroute/.env');
  const password = fs
    .readFileSync(pkgEnv, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('INITIAL_PASSWORD='))
    ?.slice('INITIAL_PASSWORD='.length);
  if (!password) throw new Error('OmniRoute INITIAL_PASSWORD missing');

  const cookie = await loginCookie(password);
  const created = await createOmniKey(cookie);
  const store = createProviderProfileStore(WORKSPACE);

  try {
    await addProviderProfile(store, {
      name: 'ollama-local',
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'qwen2.5:3b',
    });
    await addProviderProfile(store, {
      name: 'omniroute-local',
      type: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:20128/v1',
      model: 'auto',
      apiKey: created.key,
    });
    await addProviderProfile(store, {
      name: 'bad-omni',
      type: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:20128/v1',
      model: 'auto',
      apiKey: 'sk-invalid-key-for-scenario-c',
    });

    // Ensure secrets.json has no accidental print in later outs
    const secretsRaw = fs.readFileSync(path.join(PROVIDERS_DIR, 'secrets.json'), 'utf8');

    // A — Ollama
    await store.setActive('ollama-local');
    const aCurrent = runAgent(['provider', 'current']);
    const aHealth = runAgent(['provider', 'health']);
    const aTest = runAgent(['provider', 'test']);
    const A =
      aCurrent.code === 0 &&
      aHealth.code === 0 &&
      /Status:\s+healthy/i.test(aHealth.out) &&
      aTest.code === 0 &&
      /Success:\s+yes/i.test(aTest.out)
        ? 'PASS'
        : `FAIL current=${aCurrent.code} health=${aHealth.code} test=${aTest.code}`;

    // B — OmniRoute
    await store.setActive('omniroute-local');
    const bCurrent = runAgent(['provider', 'current']);
    const bHealth = runAgent(['provider', 'health']);
    const bTest = runAgent(['provider', 'test']);
    const B =
      bCurrent.code === 0 &&
      bHealth.code === 0 &&
      /Status:\s+healthy/i.test(bHealth.out) &&
      bTest.code === 0 &&
      /Success:\s+yes/i.test(bTest.out) &&
      !bCurrent.out.includes(created.key) &&
      !bHealth.out.includes(created.key) &&
      !bTest.out.includes(created.key)
        ? 'PASS'
        : `FAIL current=${bCurrent.code} health=${bHealth.code} test=${bTest.code}`;

    // C — invalid key: OmniRoute rejects /models (health) with 401; chat may still
    // succeed when REQUIRE_API_KEY=false, so typed unauthorized is asserted via health.
    await store.setActive('bad-omni');
    const cHealth = runAgent(['provider', 'health']);
    const cTest = runAgent(['provider', 'test']);
    const C =
      cHealth.code !== 0 &&
      (/Status:\s+unauthorized/i.test(cHealth.out) || /Auth:\s+failed/i.test(cHealth.out))
        ? 'PASS'
        : `FAIL health=${pick(cHealth.out, [/Status:.*/, /Auth:.*/, /Note:.*/])} test=${pick(cTest.out, [/Success:.*/, /Failure:.*/])}`;

    // D — missing provider
    const d = runAgent(['provider', 'use', 'missing-profile-xyz']);
    const D = d.code !== 0 && /not found/i.test(d.out) ? 'PASS' : 'FAIL';

    // E — persistence
    await store.setActive('omniroute-local');
    const reloaded = createProviderProfileStore(WORKSPACE);
    const E = (await reloaded.loadProfiles()).activeProvider === 'omniroute-local' ? 'PASS' : 'FAIL';

    // Security check: secrets not in providers.json / CLI outs already checked in B
    const providersRaw = fs.readFileSync(path.join(PROVIDERS_DIR, 'providers.json'), 'utf8');
    const security =
      !providersRaw.includes(created.key) &&
      !providersRaw.includes('apiKey') &&
      secretsRaw.includes(created.key)
        ? 'PASS'
        : 'FAIL';

    console.log(
      JSON.stringify(
        {
          workspace: WORKSPACE,
          A_ollama: A,
          B_omniroute: B,
          C_unauthorized: C,
          D_missing: D,
          E_persist: E,
          security_storage: security,
          notes: {
            aHealth: pick(aHealth.out, [/Status:.*/, /Type:.*/, /Latency:.*/]),
            aTest: pick(aTest.out, [/Success:.*/, /Type:.*/, /Response:.*/]),
            bHealth: pick(bHealth.out, [/Status:.*/, /Type:.*/, /Auth:.*/, /Latency:.*/]),
            bTest: pick(bTest.out, [/Success:.*/, /Type:.*/, /Response:.*/]),
            cTest: pick(cTest.out, [/Success:.*/, /Failure:.*/, /Note:.*/]),
          },
        },
        null,
        2,
      ),
    );

    await deleteOmniKey(cookie, created.id);
  } finally {
    if (hadProviders) {
      fs.rmSync(PROVIDERS_DIR, { recursive: true, force: true });
      fs.cpSync(BACKUP_DIR, PROVIDERS_DIR, { recursive: true });
      fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
    } else {
      fs.rmSync(PROVIDERS_DIR, { recursive: true, force: true });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
