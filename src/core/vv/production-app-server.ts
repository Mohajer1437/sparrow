import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  VerificationSideEffect,
  VerificationSideEffectPolicy,
} from '../../domain/verification-side-effect';

export type ServerOwnership = 'started_by_verifier' | 'externally_managed';
export type ShutdownClassification = 'expected_shutdown' | 'unexpected_crash' | 'externally_managed';

export interface ProductionServerSession {
  readonly started: boolean;
  readonly ownership: ServerOwnership;
  readonly error?: string;
  readonly crashClassification?: 'unexpected_crash';
  readonly stop: () => Promise<{ classification: ShutdownClassification }>;
  /** R1.25-R1.27: build artifacts and spawned processes are declared, not silent. */
  readonly sideEffects?: ReadonlyArray<VerificationSideEffect>;
}

export async function isUrlReachable(baseUrl: string, timeoutMs = 2500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(baseUrl, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    return res.status > 0;
  } catch {
    return false;
  }
}

export function classifyStartup(alreadyReachable: boolean): ServerOwnership | 'needs_start' {
  return alreadyReachable ? 'externally_managed' : 'needs_start';
}

export function isLoopbackVerifierPort(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    return (host === '127.0.0.1' || host === 'localhost') && url.port === '3010';
  } catch {
    return false;
  }
}

/** Leftover `npm start` / `next start` often omits the workspace path from Win32 CommandLine. */
export function looksLikeVerifierOwnedServer(commandLine: string, workspacePath: string): boolean {
  const line = (commandLine || '').trim();
  if (!line || line === 'none') return false;
  const lower = line.toLowerCase();
  const marker = workspacePath.replace(/\\/g, '/').toLowerCase();
  const markerWin = workspacePath.replace(/\//g, '\\').toLowerCase();
  if (marker && (lower.includes(marker) || lower.includes(markerWin))) return true;
  if (/\bnpm(\.cmd)?\b/.test(lower) && /\bstart\b/.test(lower)) return true;
  if (/\bnext(\.cmd|\.exe)?\b/.test(lower) && /\bstart\b/.test(lower)) return true;
  if (/\bnode(\.exe)?\b/.test(lower) && /next/i.test(line)) return true;
  return false;
}

export async function ensureProductionServer(input: {
  readonly workspacePath: string;
  readonly baseUrl: string;
  readonly sideEffectPolicy?: VerificationSideEffectPolicy;
}): Promise<ProductionServerSession> {
  const policy: VerificationSideEffectPolicy = input.sideEffectPolicy ?? 'CONTROLLED_MUTATION';
  const sideEffects: VerificationSideEffect[] = [];
  if (await isUrlReachable(input.baseUrl)) {
    const recycled = await recycleLeftoverVerifierServer(input.baseUrl, input.workspacePath);
    if (!recycled && isLoopbackVerifierPort(input.baseUrl)) {
      const port = new URL(input.baseUrl).port || '3010';
      await killPortListeners(port);
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        if (!(await isUrlReachable(input.baseUrl, 800))) break;
        await new Promise(r => setTimeout(r, 300));
      }
    } else if (!recycled) {
      return {
        started: false,
        ownership: 'externally_managed',
        stop: async () => ({ classification: 'externally_managed' }),
      };
    }
  }

  if (!(await hasStartScript(input.workspacePath))) {
    return {
      started: false,
      ownership: 'started_by_verifier',
      crashClassification: 'unexpected_crash',
      error: 'PRODUCTION live verification needs an npm start script after build, and none was found',
      stop: async () => ({ classification: 'externally_managed' }),
    };
  }

  const port = new URL(input.baseUrl).port || '3000';
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  // A PRODUCTION profile needs a real build, which rewrites `.next` and spawns
  // `npm start`. READ_ONLY verification refuses both rather than pretending the
  // build directory is not project state (R1.21, R1.27).
  if (policy === 'READ_ONLY') {
    return {
      started: false,
      ownership: 'externally_managed',
      error: 'PRODUCTION live verification needs a build, which READ_ONLY verification will not perform',
      stop: async () => ({ classification: 'externally_managed' }),
      sideEffects: Object.freeze([
        buildArtifactEffect(input.workspacePath, policy, 'BLOCKED'),
        serverProcessEffect(input.workspacePath, policy, 'BLOCKED'),
      ]),
    };
  }

  sideEffects.push(buildArtifactEffect(input.workspacePath, policy, 'PERFORMED'));
  await fs.rm(path.join(input.workspacePath, '.next'), { recursive: true, force: true }).catch(() => undefined);
  const built = await runNpm(input.workspacePath, ['run', 'build']);
  if (!built.ok) {
    return {
      started: false,
      ownership: 'started_by_verifier',
      crashClassification: 'unexpected_crash',
      error: 'PRODUCTION build failed before start: ' + built.detail,
      stop: async () => ({ classification: 'unexpected_crash' }),
      sideEffects: Object.freeze([...sideEffects]),
    };
  }
  sideEffects.push(serverProcessEffect(input.workspacePath, policy, 'PERFORMED'));
  const child: ChildProcess = spawn(command, ['run', 'start', '--', '-p', port], {
    cwd: input.workspacePath,
    windowsHide: true,
    stdio: 'pipe',
    shell: process.platform === 'win32',
    env: { ...process.env, PORT: port, CI: 'true' },
  });

  let crashed = false;
  child.once('exit', (code) => {
    if (code !== 0 && code !== null) crashed = true;
  });

  const stopOwned = async (): Promise<{ classification: ShutdownClassification }> => {
    if (child.exitCode !== null) {
      return { classification: crashed || child.exitCode !== 0 ? 'unexpected_crash' : 'expected_shutdown' };
    }
    if (child.pid && process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await killPortListeners(port);
    } else if (child.pid) {
      child.kill('SIGTERM');
    }
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (!(await isUrlReachable(input.baseUrl, 800))) break;
      await new Promise(r => setTimeout(r, 400));
    }
    return { classification: 'expected_shutdown' };
  };

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      return {
        started: false,
        ownership: 'started_by_verifier',
        crashClassification: 'unexpected_crash',
        error: 'next start exited before becoming ready (code ' + child.exitCode + ')',
        stop: async () => ({ classification: 'unexpected_crash' }),
        sideEffects: Object.freeze([...sideEffects]),
      };
    }
    if (await isUrlReachable(input.baseUrl, 1500)) {
      await new Promise(r => setTimeout(r, 2000));
      return {
        started: true,
        ownership: 'started_by_verifier',
        stop: stopOwned,
        sideEffects: Object.freeze([...sideEffects]),
      };
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  await stopOwned();
  return {
    started: false,
    ownership: 'started_by_verifier',
    crashClassification: 'unexpected_crash',
    error: 'Timed out waiting for ' + input.baseUrl,
    stop: async () => ({ classification: 'unexpected_crash' }),
    sideEffects: Object.freeze([...sideEffects]),
  };
}

function buildArtifactEffect(
  workspacePath: string,
  policy: VerificationSideEffectPolicy,
  status: 'PERFORMED' | 'BLOCKED',
): VerificationSideEffect {
  return Object.freeze({
    id: 'vv-production-build',
    source: 'production-app-server',
    kind: 'FILE_WRITE' as const,
    target: path.join(workspacePath, '.next'),
    policy,
    status,
    declared: true,
    reversible: true,
    detail: 'PRODUCTION verification rebuilds the Next.js output directory; it holds no source of truth and is regenerated by any build',
  });
}

function serverProcessEffect(
  workspacePath: string,
  policy: VerificationSideEffectPolicy,
  status: 'PERFORMED' | 'BLOCKED',
): VerificationSideEffect {
  return Object.freeze({
    id: 'vv-production-server',
    source: 'production-app-server',
    kind: 'PROCESS_SPAWN' as const,
    target: workspacePath,
    policy,
    status,
    declared: true,
    reversible: true,
    detail: 'PRODUCTION verification starts npm start and stops the process it owns at the end of the run',
  });
}

async function runNpm(workspacePath: string, args: string[]): Promise<{ ok: boolean; detail: string }> {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: workspacePath,
      windowsHide: true,
      stdio: 'pipe',
      shell: process.platform === 'win32',
      env: { ...process.env, CI: 'true' },
    });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += String(chunk); });
    child.stderr?.on('data', (chunk) => { output += String(chunk); });
    const timer = setTimeout(() => {
      if (child.pid && process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
      resolve({ ok: false, detail: 'timed out: ' + args.join(' ') });
    }, 180000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, detail: output.slice(-1500) });
    });
  });
}

function recycleLeftoverVerifierServer(baseUrl: string, workspacePath: string): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false);
  const port = new URL(baseUrl).port || '3000';
  const marker = workspacePath.replace(/'/g, '');
  return new Promise((resolve) => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-Command',
        "$c = Get-NetTCPConnection -LocalPort " + port + " -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; "
        + "if (-not $c) { Write-Output 'none'; exit 0 }; "
        + "$p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $c.OwningProcess) -ErrorAction SilentlyContinue; "
        + "Write-Output ($p.CommandLine)",
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let out = '';
    const timer = setTimeout(() => {
      ps.kill();
      resolve(false);
    }, 8000);
    ps.stdout?.on('data', (chunk) => { out += String(chunk); });
    ps.once('exit', async () => {
      clearTimeout(timer);
      const commandLine = out.trim();
      const owned = looksLikeVerifierOwnedServer(commandLine, marker);
      if (!owned) {
        resolve(false);
        return;
      }
      await killPortListeners(port);
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (!(await isUrlReachable(baseUrl, 800))) break;
        await new Promise(r => setTimeout(r, 300));
      }
      resolve(!(await isUrlReachable(baseUrl, 800)));
    });
  });
}

function killPortListeners(port: string): Promise<void> {
  if (process.platform !== 'win32') return Promise.resolve();
  return new Promise((resolve) => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-Command',
        "Get-NetTCPConnection -LocalPort " + port + " -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }",
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    const timer = setTimeout(() => {
      ps.kill();
      resolve();
    }, 8000);
    ps.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function hasStartScript(workspacePath: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(path.join(workspacePath, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw);
    return typeof pkg?.scripts?.start === 'string';
  } catch {
    return false;
  }
}
