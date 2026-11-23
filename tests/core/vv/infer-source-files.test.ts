import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  extractFilePaths,
  inferFilesFromNextChunks,
  inferImplicatedFiles,
  expectedBehaviorFromCheck,
  pageSlug,
} from '../../../src/core/vv/infer-source-files';
import { buildFailureContract } from '../../../src/core/vv/failure-contract-builder';
import { VerificationCheck } from '../../../src/domain/verification-check';

describe('infer source files', () => {
  it('maps Next.js app layout chunks to app/layout.tsx', () => {
    const evidence = 'console.error: Error: controlled VnV crash beacon at o (http://127.0.0.1:3010/_next/static/chunks/app/layout-2ea69f61f36c48b0.js:1:220)';
    expect(inferFilesFromNextChunks(evidence)).toEqual(expect.arrayContaining([
      'app/layout.tsx',
    ]));
    expect(pageSlug('/')).toBe('home');
  });

  it('finds the throwing source file from the error message', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-src-'));
    fs.mkdirSync(path.join(dir, 'app'));
    fs.writeFileSync(path.join(dir, 'app', 'CrashBeacon.tsx'), 'throw new Error(\'controlled VnV crash beacon\');\n');
    fs.writeFileSync(path.join(dir, 'app', 'layout.tsx'), 'export default function Layout() { return null; }\n');
    fs.writeFileSync(path.join(dir, 'app', 'page.tsx'), 'export default function Page() { return null; }\n');
    const files = inferImplicatedFiles(
      'pageerror: Error: controlled VnV crash beacon; console.error: Error: controlled VnV crash beacon at http://127.0.0.1:3010/_next/static/chunks/app/layout-abc12345.js',
      dir,
    );
    fs.rmSync(dir, { recursive: true, force: true });
    expect(files).toContain('app/CrashBeacon.tsx');
    expect(files.some(f => /layout\.tsx$/.test(f))).toBe(false);
    expect(files.some(f => f.endsWith('.jsx') || f.startsWith('src/'))).toBe(false);
  });

  it('extracts relative source paths and ignores node_modules', () => {
    expect(extractFilePaths('edit app/page.tsx and node_modules/foo.ts')).toContain('app/page.tsx');
    expect(extractFilePaths('see Next.js and load-manifest.js and app/layout-2ea69f61f36c48b0.js')).not.toEqual(
      expect.arrayContaining(['Next.js', 'load-manifest.js', 'app/layout-2ea69f61f36c48b0.js']),
    );
  });

  it('collapses phantom App Router route/route.ts paths', () => {
    expect(inferImplicatedFiles('source: app/api/save/route/route.ts')).toEqual(['app/api/save/route.ts']);
    expect(inferImplicatedFiles('source: app/api/save/route.ts')).toEqual(['app/api/save/route.ts']);
  });
});

describe('buildFailureContract source inference', () => {
  it('ranks pageerror above missing test id and records implicated files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-fc-'));
    fs.mkdirSync(path.join(dir, 'app'));
    fs.writeFileSync(
      path.join(dir, 'app', 'layout.tsx'),
      'throw new Error(\'controlled VnV crash beacon\');\n',
    );
    const checks: VerificationCheck[] = [
      {
        id: 'browser-dom-testid-home',
        category: 'browser',
        name: 'DOM assertion on /',
        passed: false,
        severity: 'HIGH',
        evidence: 'missing visible test id: sandbox-vv-footer',
        acceptanceCriterion: 'missing visible test id: sandbox-vv-footer',
      },
      {
        id: 'browser-pageerror-home',
        category: 'browser',
        name: 'Uncaught page error on /',
        passed: false,
        severity: 'HIGH',
        evidence: 'goto http://127.0.0.1:3010/ via msedge -> status 200; pageerror: Error: controlled VnV crash beacon; console.error: Error: controlled VnV crash beacon at http://127.0.0.1:3010/_next/static/chunks/app/layout-2ea69f61f36c48b0.js',
        acceptanceCriterion: 'Page / must not throw uncaught runtime exceptions',
      },
    ];
    const contract = buildFailureContract({
      profile: 'PRODUCTION',
      checks,
      attempt: 1,
      workspacePath: dir,
    });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(contract!.verification?.originalCheck).toBe('browser-pageerror-home');
    expect(contract!.repairContract?.requiredOutcome).toMatch(/uncaught runtime exceptions/i);
    expect(contract!.location?.file).toMatch(/layout\.tsx|CrashBeacon/i);
    expect(contract!.implicatedFiles?.some(f => /layout\.tsx|CrashBeacon/i.test(f))).toBe(true);
    expect(contract!.repairInstructions).toMatch(/Implicated files/);
    expect(expectedBehaviorFromCheck('browser-pageerror-home', checks[1].evidence)).toMatch(/uncaught runtime exceptions/i);
  });
});
