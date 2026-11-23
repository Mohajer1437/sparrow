import { DefaultEvidenceBuilder } from '../../../src/core/pre-execution/evidence-builder';
import { LocalWorkspace } from '../../../src/core/workspace/local-workspace';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

describe('DefaultEvidenceBuilder', () => {
  let builder: DefaultEvidenceBuilder;
  let workspace: LocalWorkspace;
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'evidence-ws-'));
    await fs.mkdir(path.join(workspacePath, 'app'), { recursive: true });
    await fs.writeFile(path.join(workspacePath, 'app', 'page.tsx'), "'use client';\n", 'utf8');
    await fs.writeFile(path.join(workspacePath, 'package.json'), '{"name":"fixture"}', 'utf8');
    workspace = new LocalWorkspace(workspacePath);
    builder = new DefaultEvidenceBuilder(workspace, workspacePath.replace(/\\/g, '/'));
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  describe('collect', () => {
    it('confirms a file against the workspace absolute path', async () => {
      const result = await builder.collect({
        evidenceTypes: ['FILE_EXISTS'],
        targets: ['app/page.tsx'],
      });
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].status).toBe('CONFIRMED');
      expect(result.evidence[0].source).toBe('app/page.tsx');
      expect(result.evidence[0].observation).toContain(path.join(workspacePath, 'app', 'page.tsx'));
    });

    it('reports a missing file from the same workspace and does not fall back elsewhere', async () => {
      const result = await builder.collect({
        evidenceTypes: ['FILE_EXISTS'],
        targets: ['app/does-not-exist.tsx'],
      });
      expect(result.evidence[0].status).toBe('NOT_FOUND');
      expect(result.evidence[0].observation).toContain(path.join(workspacePath, 'app', 'does-not-exist.tsx'));
    });

    it('does not silently substitute an unrelated existing file', async () => {
      const result = await builder.collect({
        evidenceTypes: ['FILE_EXISTS'],
        targets: ['package.json', 'app/missing.tsx'],
      });
      const pkg = result.evidence.find(item => item.source === 'package.json');
      const missing = result.evidence.find(item => item.source === 'app/missing.tsx');
      expect(pkg?.status).toBe('CONFIRMED');
      expect(missing?.status).toBe('NOT_FOUND');
    });

    it('rejects traversal instead of resolving outside the workspace', async () => {
      const result = await builder.collect({
        evidenceTypes: ['FILE_EXISTS'],
        targets: ['../secret.txt'],
      });
      expect(result.evidence[0].status).toBe('ERROR');
      expect(result.evidence[0].error).toMatch(/traversal/i);
    });

    it('should collect FILE_CONTENT evidence', async () => {
      const result = await builder.collect({
        evidenceTypes: ['FILE_CONTENT'],
        targets: ['package.json'],
      });
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].type).toBe('FILE_CONTENT');
      expect(result.evidence[0].observation).toBeDefined();
    });
  });
});
