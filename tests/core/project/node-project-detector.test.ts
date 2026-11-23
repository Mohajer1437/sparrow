import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NodeProjectDetector } from '../../../src/core/project/node-project-detector';
import { ProjectDetectionExtension } from '../../../src/domain/project-profile';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

describe('NodeProjectDetector', () => {
  const detector = new NodeProjectDetector();
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects a Next.js frontend project', async () => {
    const dir = makeTempDir('sparrow-next-');
    dirs.push(dir);
    writeJson(path.join(dir, 'package.json'), {
      name: 'web',
      dependencies: { next: '14.2.0', react: '18.0.0' },
      devDependencies: { jest: '29.0.0' },
    });
    fs.writeFileSync(path.join(dir, 'next.config.js'), 'module.exports = {};');
    fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'app', 'page.tsx'), 'export default function Page() { return null; }');
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');

    const profile = await detector.detect(dir);

    expect(profile.projectType).toBe('frontend');
    expect(profile.detectedFrameworks).toEqual(['nextjs']);
    expect(profile.detectedDomains).toEqual(expect.arrayContaining(['frontend', 'testing']));
    expect(profile.capabilities).toEqual(expect.arrayContaining(['frontend', 'nextjs', 'testing.jest']));
    expect(profile.languages).toEqual(expect.arrayContaining(['typescript', 'javascript']));
    expect(profile.availableTestingTools).toEqual(['jest']);
    expect(profile.packageManager).toBe('npm');
  });

  it('detects a NestJS backend project', async () => {
    const dir = makeTempDir('sparrow-nest-');
    dirs.push(dir);
    writeJson(path.join(dir, 'package.json'), {
      name: 'api',
      dependencies: { '@nestjs/core': '10.0.0', '@nestjs/common': '10.0.0' },
    });
    writeJson(path.join(dir, 'nest-cli.json'), { collection: '@nestjs/schematics' });
    fs.mkdirSync(path.join(dir, 'src', 'modules'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'modules', 'app.module.ts'), 'export class AppModule {}');

    const profile = await detector.detect(dir);

    expect(profile.projectType).toBe('backend');
    expect(profile.detectedFrameworks).toEqual(['nestjs']);
    expect(profile.detectedDomains).toEqual(['backend']);
    expect(profile.capabilities).toEqual(expect.arrayContaining(['backend', 'nestjs']));
  });

  it('handles an unknown project', async () => {
    const dir = makeTempDir('sparrow-unknown-');
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'README.md'), '# notes');

    const profile = await detector.detect(dir);

    expect(profile.projectType).toBe('unknown');
    expect(profile.detectedFrameworks).toEqual([]);
    expect(profile.detectedDomains).toEqual([]);
    expect(profile.capabilities).toEqual([]);
    expect(profile.packageManager).toBe('unknown');
  });

  it('returns unknown for a missing directory', async () => {
    const profile = await detector.detect(path.join(os.tmpdir(), 'sparrow-missing-' + Date.now()));
    expect(profile.projectType).toBe('unknown');
    expect(profile.detectedFrameworks).toEqual([]);
  });

  it('detects fullstack when both Next.js and NestJS signals exist', async () => {
    const dir = makeTempDir('sparrow-full-');
    dirs.push(dir);
    writeJson(path.join(dir, 'package.json'), {
      name: 'mono',
      dependencies: { next: '14.2.0', '@nestjs/core': '10.0.0' },
    });
    fs.writeFileSync(path.join(dir, 'next.config.mjs'), 'export default {};');
    writeJson(path.join(dir, 'nest-cli.json'), {});

    const profile = await detector.detect(dir);
    expect(profile.projectType).toBe('fullstack');
    expect(profile.detectedFrameworks).toEqual(expect.arrayContaining(['nextjs', 'nestjs']));
  });

  it('applies detection extensions without replacing core signals', async () => {
    const dir = makeTempDir('sparrow-ext-');
    dirs.push(dir);
    writeJson(path.join(dir, 'package.json'), { name: 'web', dependencies: { next: '14.0.0' } });

    const extension: ProjectDetectionExtension = {
      async contribute() {
        return { languages: ['css'], capabilities: ['storybook'] };
      },
    };

    const extended = new NodeProjectDetector({ extensions: [extension] });
    const profile = await extended.detect(dir);
    expect(profile.detectedFrameworks).toEqual(['nextjs']);
    expect(profile.languages).toEqual(expect.arrayContaining(['css', 'javascript']));
    expect(profile.capabilities).toEqual(expect.arrayContaining(['frontend', 'storybook']));
  });
});
