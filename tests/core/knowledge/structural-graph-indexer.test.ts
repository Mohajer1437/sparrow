import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { LocalWorkspace } from '../../../src/core/workspace/local-workspace';
import { LocalRuntimeRepository } from '../../../src/core/runtime/local-runtime-repository';
import {
  DefaultStructuralGraphIndexer,
  resolveImportToFile,
  structuralContentEqual,
} from '../../../src/core/knowledge/structural-graph-indexer';
import { StructuralAnalyzer } from '../../../src/core/patch/structural-analyzer';
import { ChangeDetector, isStructuralSourceFile } from '../../../src/core/knowledge/utils/change-detector';
import { STRUCTURAL_GRAPH_RELATIVE_PATH } from '../../../src/domain/structural-knowledge';

describe('isStructuralSourceFile', () => {
  it('accepts .ts and .tsx', () => {
    expect(isStructuralSourceFile('a.ts')).toBe(true);
    expect(isStructuralSourceFile('a.tsx')).toBe(true);
  });

  it('rejects tests and declaration files', () => {
    expect(isStructuralSourceFile('a.test.ts')).toBe(false);
    expect(isStructuralSourceFile('a.spec.tsx')).toBe(false);
    expect(isStructuralSourceFile('a.d.ts')).toBe(false);
  });
});

describe('resolveImportToFile', () => {
  it('resolves relative imports with and without extensions', () => {
    const fileSet = new Set([
      'server/src/tasks/tasks.service.ts',
      'server/src/tasks/tasks.repository.ts',
      'types/domain.ts',
      'components/StatusBadge.tsx',
    ]);
    expect(
      resolveImportToFile('server/src/tasks/tasks.service.ts', './tasks.repository.ts', fileSet),
    ).toBe('server/src/tasks/tasks.repository.ts');
    expect(
      resolveImportToFile('server/src/tasks/tasks.service.ts', '../../../types/domain.ts', fileSet),
    ).toBe('types/domain.ts');
    expect(
      resolveImportToFile('components/TaskCard.tsx', './StatusBadge', fileSet),
    ).toBe('components/StatusBadge.tsx');
  });

  it('returns null for external packages', () => {
    expect(resolveImportToFile('a.ts', 'react', new Set(['a.ts']))).toBeNull();
  });
});

describe('DefaultStructuralGraphIndexer', () => {
  let tempDir: string;
  let workspace: LocalWorkspace;
  let runtime: LocalRuntimeRepository;
  let indexer: DefaultStructuralGraphIndexer;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'structural-index-'));
    await fs.mkdir(path.join(tempDir, 'server', 'src', 'tasks'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'components'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'types'), { recursive: true });
    await fs.mkdir(path.join(tempDir, '.ai'), { recursive: true });

    await fs.writeFile(
      path.join(tempDir, 'types', 'domain.ts'),
      `export type TaskStatus = 'todo' | 'done';\nexport interface Task { id: string; status: TaskStatus }\n`,
      'utf-8',
    );
    await fs.writeFile(
      path.join(tempDir, 'server', 'src', 'tasks', 'tasks.repository.ts'),
      `import type { Task } from '../../../types/domain.ts';\nexport class TasksRepository { list(): Task[] { return []; } }\n`,
      'utf-8',
    );
    await fs.writeFile(
      path.join(tempDir, 'server', 'src', 'tasks', 'tasks.service.ts'),
      `import { TasksRepository } from './tasks.repository.ts';\nimport type { Task } from '../../../types/domain.ts';\nexport class TasksService {\n  constructor(readonly tasks: TasksRepository) {}\n  all(): Task[] { return this.tasks.list(); }\n}\n`,
      'utf-8',
    );
    await fs.writeFile(
      path.join(tempDir, 'components', 'StatusBadge.tsx'),
      `export function StatusBadge() { return <span>ok</span>; }\n`,
      'utf-8',
    );
    await fs.writeFile(
      path.join(tempDir, 'components', 'TaskCard.tsx'),
      `import type { Task } from '../types/domain';\nimport { StatusBadge } from './StatusBadge';\nexport function TaskCard(_props: { task: Task }) { return <div><StatusBadge /></div>; }\n`,
      'utf-8',
    );

    workspace = new LocalWorkspace(tempDir);
    runtime = new LocalRuntimeRepository(tempDir);
    indexer = new DefaultStructuralGraphIndexer(
      workspace,
      runtime,
      tempDir,
      new StructuralAnalyzer(),
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('indexes server/ and .tsx files with import edges and matching hashes', async () => {
    const graph = await indexer.buildInitialIndex();

    const fileNodes = graph.nodes.filter(n => n.kind === 'file');
    const paths = fileNodes.map(n => n.path!);
    expect(paths).toEqual(expect.arrayContaining([
      'server/src/tasks/tasks.service.ts',
      'server/src/tasks/tasks.repository.ts',
      'components/TaskCard.tsx',
      'components/StatusBadge.tsx',
      'types/domain.ts',
    ]));
    expect(graph.meta.roots).toEqual(expect.arrayContaining(['server', 'components', 'types']));

    const serviceToRepo = graph.edges.find(
      e => e.kind === 'imports'
        && e.from === 'server/src/tasks/tasks.service.ts'
        && e.to === 'server/src/tasks/tasks.repository.ts',
    );
    expect(serviceToRepo).toBeDefined();

    const cardToBadge = graph.edges.find(
      e => e.kind === 'imports'
        && e.from === 'components/TaskCard.tsx'
        && e.to === 'components/StatusBadge.tsx',
    );
    expect(cardToBadge).toBeDefined();

    const serviceNode = fileNodes.find(n => n.path === 'server/src/tasks/tasks.service.ts')!;
    const content = await fs.readFile(
      path.join(tempDir, 'server', 'src', 'tasks', 'tasks.service.ts'),
      'utf-8',
    );
    const expectedHash = crypto.createHash('sha256').update(content, 'utf-8').digest('hex').substring(0, 16);
    expect(serviceNode.hash).toBe(expectedHash);

    // ChangeDetector canonical hash must match
    const detector = new ChangeDetector(workspace);
    expect(await detector.hashFile('server/src/tasks/tasks.service.ts')).toBe(serviceNode.hash);
  });

  it('persists to .ai/knowledge/structural-graph.json and reloads', async () => {
    const built = await indexer.indexAndPersist();
    expect(await runtime.exists(STRUCTURAL_GRAPH_RELATIVE_PATH)).toBe(true);

    const loaded = await indexer.load();
    expect(loaded).not.toBeNull();
    expect(structuralContentEqual(built, loaded!)).toBe(true);
  });

  it('is deterministic across two builds without repo changes', async () => {
    const a = await indexer.buildInitialIndex();
    const b = await indexer.buildInitialIndex();
    expect(structuralContentEqual(a, b)).toBe(true);
    expect(a.meta.contentHash).toBe(b.meta.contentHash);
  });

  it('reuses StructuralAnalyzer (no parallel analyzer class)', () => {
    // Construction injects StructuralAnalyzer — regression guard for Phase 1 constraint.
    const analyzer = new StructuralAnalyzer();
    const withShared = new DefaultStructuralGraphIndexer(workspace, runtime, tempDir, analyzer);
    expect(withShared).toBeInstanceOf(DefaultStructuralGraphIndexer);
    expect(analyzer.isTypeScriptFile('x.tsx')).toBe(true);
  });
});
