import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FilesystemProjectFingerprinter } from '../../../src/core/project/filesystem-project-fingerprinter';

describe('Version Context Cache Invalidation', () => {
  let tempDir: string;
  let fingerprinter: FilesystemProjectFingerprinter;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-test-'));
    fingerprinter = new FilesystemProjectFingerprinter();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('produces stable fingerprint when dependency files remain unchanged', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ dependencies: { next: '14.2.0' } }),
    );

    const fp1 = await fingerprinter.compute(tempDir);
    const fp2 = await fingerprinter.compute(tempDir);
    expect(fp1).toBe(fp2);
  });

  it('invalidates fingerprint when package.json is modified', async () => {
    const pkgPath = path.join(tempDir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({ dependencies: { next: '14.2.0' } }));
    const fp1 = await fingerprinter.compute(tempDir);

    // Sleep briefly to ensure mtime changes
    const laterTime = new Date(Date.now() + 2000);
    fs.writeFileSync(pkgPath, JSON.stringify({ dependencies: { next: '15.0.0' } }));
    fs.utimesSync(pkgPath, laterTime, laterTime);

    const fp2 = await fingerprinter.compute(tempDir);
    expect(fp1).not.toBe(fp2);
  });

  it('invalidates fingerprint when lockfile is modified', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ dependencies: { next: '^14.2.0' } }),
    );
    const lockPath = path.join(tempDir, 'package-lock.json');
    fs.writeFileSync(lockPath, JSON.stringify({ lockfileVersion: 3 }));
    const fp1 = await fingerprinter.compute(tempDir);

    const laterTime = new Date(Date.now() + 2000);
    fs.writeFileSync(lockPath, JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/next': { version: '14.2.35' } } }));
    fs.utimesSync(lockPath, laterTime, laterTime);

    const fp2 = await fingerprinter.compute(tempDir);
    expect(fp1).not.toBe(fp2);
  });

  it('invalidates fingerprint when .ai/dependencies file is added or changed', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ dependencies: { next: '^14.2.0' } }),
    );
    const fp1 = await fingerprinter.compute(tempDir);

    const depDir = path.join(tempDir, '.ai', 'dependencies');
    fs.mkdirSync(depDir, { recursive: true });
    const overrideFile = path.join(depDir, 'nextjs.md');
    fs.writeFileSync(overrideFile, '# Custom Next Rules');

    const fp2 = await fingerprinter.compute(tempDir);
    expect(fp1).not.toBe(fp2);
  });
});
