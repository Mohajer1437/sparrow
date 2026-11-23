import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectOverrideLoader } from '../../../src/core/version/project-override-loader';

describe('Project .ai Overrides Loader', () => {
  let tempDir: string;
  let loader: ProjectOverrideLoader;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'override-test-'));
    loader = new ProjectOverrideLoader();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads markdown overrides from .ai/dependencies/*.md with frontmatter', async () => {
    const aiDepDir = path.join(tempDir, '.ai', 'dependencies');
    fs.mkdirSync(aiDepDir, { recursive: true });

    fs.writeFileSync(
      path.join(aiDepDir, 'prisma.md'),
      `---
technology: prisma
applicableVersion: ^7.0.0
lastVerified: 2026-08-01
scope: backend
summary: Custom project Prisma 7 migration rules
---

# Prisma Rules
- Do not apply Prisma 6 migration patterns.
- Always use TypedSQL for complex aggregation queries.
`,
    );

    const overrides = await loader.loadOverrides(tempDir);
    expect(overrides.length).toBe(1);
    expect(overrides[0].technology).toBe('prisma');
    expect(overrides[0].applicableVersion).toBe('^7.0.0');
    expect(overrides[0].summary).toBe('Custom project Prisma 7 migration rules');
    expect(overrides[0].guidance).toContain('Do not apply Prisma 6 migration patterns.');
    expect(overrides[0].guidance).toContain('Always use TypedSQL for complex aggregation queries.');
    expect(overrides[0].filePath).toBe('.ai/dependencies/prisma.md');
    expect(overrides[0].source).toBe('project-override');
  });

  it('loads json overrides from .ai/dependencies/*.json', async () => {
    const aiDepDir = path.join(tempDir, '.ai', 'dependencies');
    fs.mkdirSync(aiDepDir, { recursive: true });

    fs.writeFileSync(
      path.join(aiDepDir, 'nextjs.json'),
      JSON.stringify({
        technology: 'nextjs',
        applicableVersion: '>=14.0.0 <15.0.0',
        summary: 'Next 14 internal UI conventions',
        guidance: [
          'Use Page Router styling conventions for legacy views.',
          'App Router pages must use layout wrappers.',
        ],
      }),
    );

    const overrides = await loader.loadOverrides(tempDir);
    expect(overrides.length).toBe(1);
    expect(overrides[0].technology).toBe('nextjs');
    expect(overrides[0].applicableVersion).toBe('>=14.0.0 <15.0.0');
    expect(overrides[0].guidance.length).toBe(2);
  });

  it('loads multi-dependency definitions from single .ai/dependencies.md', async () => {
    const aiDir = path.join(tempDir, '.ai');
    fs.mkdirSync(aiDir, { recursive: true });

    fs.writeFileSync(
      path.join(aiDir, 'dependencies.md'),
      `# Project Dependency Rules

## Prisma
Applicable Version: 7.x
- Use Prisma 7 Driver Adapters with PgBouncer.

## Next.js
Applicable Version: 14.x
- Server actions are prohibited in customer auth flows.
`,
    );

    const overrides = await loader.loadOverrides(tempDir);
    expect(overrides.length).toBe(2);
    expect(overrides.map(o => o.technology).sort()).toEqual(['nextjs', 'prisma']);
  });

  it('ignores non-dependency .ai files', async () => {
    const aiDir = path.join(tempDir, '.ai');
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(path.join(aiDir, 'project.md'), '# General Project Rules');

    const overrides = await loader.loadOverrides(tempDir);
    expect(overrides.length).toBe(0);
  });
});
