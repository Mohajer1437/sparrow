import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { classifyStartup, isLoopbackVerifierPort, looksLikeVerifierOwnedServer } from '../../../src/core/vv/production-app-server';
import { ensureProductionServer } from '../../../src/core/vv/production-app-server';

describe('production server lifecycle', () => {
  it('classifies an already listening port as externally managed', () => {
    expect(classifyStartup(true)).toBe('externally_managed');
    expect(classifyStartup(false)).toBe('needs_start');
  });

  it('treats 127.0.0.1:3010 as the loopback verifier port', () => {
    expect(isLoopbackVerifierPort('http://127.0.0.1:3010')).toBe(true);
    expect(isLoopbackVerifierPort('http://127.0.0.1:3000')).toBe(false);
  });

  it('recognizes leftover npm/next start even when CommandLine omits the workspace path', () => {
    expect(looksLikeVerifierOwnedServer(
      'C:\\Windows\\system32\\cmd.exe /d /s /c npm.cmd run start -- -p 3010',
      'E:\\new-test-2',
    )).toBe(true);
    expect(looksLikeVerifierOwnedServer(
      'node.exe E:\\new-test-2\\node_modules\\next\\dist\\bin\\next start -p 3010',
      'E:\\new-test-2',
    )).toBe(true);
    expect(looksLikeVerifierOwnedServer(
      'python.exe -m http.server 3010',
      'E:\\new-test-2',
    )).toBe(false);
  });

  it('does not spawn when package.json has no start script', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-life-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { build: 'echo' } }));
    const session = await ensureProductionServer({ workspacePath: dir, baseUrl: 'http://127.0.0.1:65531' });
    expect(session.started).toBe(false);
    expect(session.crashClassification).toBe('unexpected_crash');
    expect(session.error).toMatch(/start script/i);
    const shutdown = await session.stop();
    expect(shutdown.classification).toBe('externally_managed');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
