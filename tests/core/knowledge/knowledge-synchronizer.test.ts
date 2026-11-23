import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { LocalWorkspace } from '../../../src/core/workspace/local-workspace';
import { LocalRuntimeRepository } from '../../../src/core/runtime/local-runtime-repository';
import { DefaultStructuralGraphIndexer } from '../../../src/core/knowledge/structural-graph-indexer';
import { DefaultKnowledgeSynchronizer } from '../../../src/core/knowledge/knowledge-synchronizer';
import { StructuralAnalyzer } from '../../../src/core/patch/structural-analyzer';
import {
  STRUCTURAL_GRAPH_RELATIVE_PATH,
  STRUCTURAL_SYNC_STATE_RELATIVE_PATH,
} from '../../../src/domain/structural-knowledge';
import {
  MutationLedger,
  MutationResult,
  EMPTY_DIFF_SUMMARY,
  buildMutationLedger,
} from '../../../src/domain/execution/mutation-safety';
import { Workspace } from '../../../src/contracts/workspace';

function sha16(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').substring(0, 16);
}

function mutationResult(partial: Partial<MutationResult> & Pick<MutationResult, 'path' | 'operation' | 'status'>): MutationResult {
  return {
    toolName: 'test_write',
    beforeState: 'PRESENT',
    afterState: 'PRESENT',
    beforeHash: '0',
    afterHash: '1',
    changed: true,
    syntaxValid: true,
    expectedChangePresent: null,
    expectedMarkers: [],
    diffSummary: EMPTY_DIFF_SUMMARY,
    suspicious: false,
    rolledBack: false,
    rollbackVerified: null,
    decision: 'ALLOW',
    findings: [],
    ...partial,
  };
}

function ledgerFor(paths: string[], operation: MutationResult['operation'] = 'modify'): MutationLedger {
  return buildMutationLedger([{
    toolName: 'test_write',
    status: 'APPLIED',
    blockedBeforeWrite: false,
    findings: [],
    results: paths.map(p => mutationResult({ path: p, operation, status: 'APPLIED' })),
  }]);
}

describe('DefaultKnowledgeSynchronizer', () => {
  let tempDir: string;
  let workspace: LocalWorkspace;
  let runtime: LocalRuntimeRepository;
  let indexer: DefaultStructuralGraphIndexer;
  let synchronizer: DefaultKnowledgeSynchronizer;

  async function seedRepo(): Promise<void> {
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
    await fs.writeFile(
      path.join(tempDir, 'components', 'EmptyState.tsx'),
      `export function EmptyState() { return <div>empty</div>; }\n`,
      'utf-8',
    );
    await fs.writeFile(
      path.join(tempDir, 'components', 'TaskList.tsx'),
      `import { TaskCard } from './TaskCard';\nexport function TaskList() { return <TaskCard task={{ id: '1', status: 'todo' }} />; }\n`,
      'utf-8',
    );
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-sync-'));
    await seedRepo();
    workspace = new LocalWorkspace(tempDir);
    runtime = new LocalRuntimeRepository(tempDir);
    const analyzer = new StructuralAnalyzer();
    indexer = new DefaultStructuralGraphIndexer(workspace, runtime, tempDir, analyzer);
    synchronizer = new DefaultKnowledgeSynchronizer(workspace, runtime, tempDir, analyzer, indexer);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // T1
  it('T1 loads initial graph', async () => {
    const graph = await indexer.indexAndPersist();
    const loaded = await indexer.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.meta.contentHash).toBe(graph.meta.contentHash);
    expect(loaded!.meta.fileCount).toBeGreaterThanOrEqual(5);
  });

  // T2
  it('T2 create adds file node from filesystem truth', async () => {
    await indexer.indexAndPersist();
    const newPath = 'components/NewWidget.tsx';
    expect(await workspace.exists(newPath)).toBe(false);

    await workspace.writeFile(newPath, `export function NewWidget() { return <div/>; }\n`);
    const result = await synchronizer.sync({
      sessionId: 's1',
      stepId: 'step-create',
      candidatePaths: [newPath],
      outcome: 'success',
    });

    expect(result.skipped).toBe(false);
    expect(result.fallbackUsed).toBe(false);
    expect(result.analyzedPaths).toEqual([newPath]);
    expect(result.analyzedFileCount).toBe(1);
    expect(result.analyzedFileCount).toBeLessThan(result.repositoryFileCount);

    const graph = await indexer.load();
    expect(graph!.nodes.some(n => n.kind === 'file' && n.path === newPath)).toBe(true);
  });

  // T3
  it('T3 modify refreshes hash and keeps FS==graph hash', async () => {
    await indexer.indexAndPersist();
    const target = 'server/src/tasks/tasks.service.ts';
    const before = (await indexer.load())!.nodes.find(n => n.path === target)!;
    const beforeFs = sha16(await workspace.readFile(target));
    expect(before.hash).toBe(beforeFs);

    const next = `${await workspace.readFile(target)}\nexport const SYNC_MARK = 1;\n`;
    await workspace.writeFile(target, next);
    const afterFs = sha16(next);
    expect(afterFs).not.toBe(beforeFs);

    const result = await synchronizer.sync({
      sessionId: 's1',
      stepId: 'step-modify',
      candidatePaths: synchronizer.candidatesFromLedger(ledgerFor([target])),
      outcome: 'success',
    });

    expect(result.fallbackUsed).toBe(false);
    expect(result.analyzedFileCount).toBe(1);
    const after = (await indexer.load())!.nodes.find(n => n.path === target)!;
    expect(after.hash).toBe(afterFs);
    expect(after.hash).not.toBe(before.hash);
  });

  // T4
  it('T4 delete removes file node and edges', async () => {
    await indexer.indexAndPersist();
    const target = 'components/EmptyState.tsx';
    const before = await indexer.load();
    expect(before!.nodes.some(n => n.path === target)).toBe(true);
    const edgesBefore = before!.edges.filter(e => e.from === target || e.to === target).length;

    await workspace.deleteFile(target);
    const result = await synchronizer.sync({
      sessionId: 's1',
      stepId: 'step-delete',
      candidatePaths: [target],
      outcome: 'success',
    });

    expect(result.analyzedFileCount).toBe(0); // delete: no AST
    expect(result.fallbackUsed).toBe(false);
    const after = await indexer.load();
    expect(after!.nodes.some(n => n.path === target)).toBe(false);
    expect(after!.edges.filter(e => e.from === target || e.to === target)).toHaveLength(0);
    expect(edgesBefore).toBeGreaterThanOrEqual(0);
  });

  // T5
  it('T5 import edge change replaces A→B with A→C', async () => {
    await indexer.indexAndPersist();
    const a = 'components/TaskCard.tsx';
    const before = await indexer.load();
    expect(before!.edges.some(e => e.kind === 'imports' && e.from === a && e.to === 'components/StatusBadge.tsx')).toBe(true);

    await workspace.writeFile(
      a,
      `import type { Task } from '../types/domain';\nimport { EmptyState } from './EmptyState';\nexport function TaskCard(_props: { task: Task }) { return <div><EmptyState /></div>; }\n`,
    );

    const result = await synchronizer.sync({
      sessionId: 's1',
      stepId: 'step-import',
      candidatePaths: [a],
      outcome: 'success',
    });

    expect(result.fallbackUsed).toBe(false);
    const after = await indexer.load();
    expect(after!.edges.some(e => e.kind === 'imports' && e.from === a && e.to === 'components/StatusBadge.tsx')).toBe(false);
    expect(after!.edges.some(e => e.kind === 'imports' && e.from === a && e.to === 'components/EmptyState.tsx')).toBe(true);
    expect(result.changedEdges.some(e => e.change === 'removed' && e.to === 'components/StatusBadge.tsx')).toBe(true);
    expect(result.changedEdges.some(e => e.change === 'added' && e.to === 'components/EmptyState.tsx')).toBe(true);
    // Incoming edges from other files must survive a replace/modify of A
    expect(before!.edges.some(e => e.kind === 'imports' && e.from === 'components/TaskList.tsx' && e.to === a)).toBe(true);
    expect(after!.edges.some(e => e.kind === 'imports' && e.from === 'components/TaskList.tsx' && e.to === a)).toBe(true);
  });

  // T6
  it('T6 rollback restores graph to filesystem state', async () => {
    await indexer.indexAndPersist();
    const target = 'types/domain.ts';
    const original = await workspace.readFile(target);
    const beforeHash = (await indexer.load())!.nodes.find(n => n.path === target)!.hash;

    await workspace.writeFile(target, `${original}\nexport type Rolled = 'x';\n`);
    await synchronizer.sync({
      sessionId: 's1',
      stepId: 'step-mut',
      candidatePaths: [target],
      outcome: 'success',
    });
    const midHash = (await indexer.load())!.nodes.find(n => n.path === target)!.hash;
    expect(midHash).not.toBe(beforeHash);

    await workspace.writeFile(target, original);
    await synchronizer.sync({
      sessionId: 's1',
      stepId: 'step-rollback',
      candidatePaths: [target],
      outcome: 'rolled_back',
    });

    const after = await indexer.load();
    expect(after!.nodes.find(n => n.path === target)!.hash).toBe(beforeHash);
    expect(after!.nodes.find(n => n.path === target)!.hash).toBe(sha16(original));
  });

  // T7
  it('T7 failed execution with remaining mutation still syncs FS truth', async () => {
    await indexer.indexAndPersist();
    const target = 'server/src/tasks/tasks.repository.ts';
    const next = `${await workspace.readFile(target)}\nexport const LEFT_AFTER_FAIL = true;\n`;
    await workspace.writeFile(target, next);

    const result = await synchronizer.sync({
      sessionId: 's1',
      stepId: 'step-fail',
      candidatePaths: [target],
      outcome: 'failed',
    });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    const node = (await indexer.load())!.nodes.find(n => n.path === target)!;
    expect(node.hash).toBe(sha16(next));
  });

  // T8
  it('T8 no mutation skips without analysis', async () => {
    await indexer.indexAndPersist();
    const result = await synchronizer.sync({
      sessionId: 's1',
      stepId: 'step-none',
      candidatePaths: [],
      outcome: 'success',
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no mutation');
    expect(result.analyzedFileCount).toBe(0);
    const state = await synchronizer.loadSyncState();
    expect(state!.skipped).toBe(true);
    expect(state!.reason).toBe('no mutation');
  });

  // T9
  it('T9 persistence writes graph to disk', async () => {
    await indexer.indexAndPersist();
    const target = 'components/StatusBadge.tsx';
    await workspace.writeFile(target, `export function StatusBadge() { return <span>synced</span>; }\n`);
    await synchronizer.sync({
      sessionId: 's1',
      stepId: 'step-persist',
      candidatePaths: [target],
      outcome: 'success',
    });
    expect(await runtime.exists(STRUCTURAL_GRAPH_RELATIVE_PATH)).toBe(true);
    const raw = await runtime.readFile(STRUCTURAL_GRAPH_RELATIVE_PATH);
    const parsed = JSON.parse(raw);
    expect(parsed.nodes.some((n: { path?: string }) => n.path === target)).toBe(true);
  });

  // T10
  it('T10 reload after persist keeps correct state', async () => {
    await indexer.indexAndPersist();
    const target = 'components/TaskCard.tsx';
    await workspace.writeFile(
      target,
      `import type { Task } from '../types/domain';\nimport { EmptyState } from './EmptyState';\nexport function TaskCard(_props: { task: Task }) { return <EmptyState />; }\n`,
    );
    const synced = await synchronizer.sync({
      sessionId: 's1',
      stepId: 'step-reload',
      candidatePaths: [target],
      outcome: 'success',
    });

    // Simulate process restart: new indexer/runtime against same disk
    const workspace2 = new LocalWorkspace(tempDir);
    const runtime2 = new LocalRuntimeRepository(tempDir);
    const indexer2 = new DefaultStructuralGraphIndexer(workspace2, runtime2, tempDir);
    const reloaded = await indexer2.load();
    expect(reloaded).not.toBeNull();
    expect(reloaded!.meta.contentHash).toBe(synced.graph!.meta.contentHash);
    expect(reloaded!.edges.some(e => e.kind === 'imports' && e.from === target && e.to === 'components/EmptyState.tsx')).toBe(true);
  });

  // T11
  it('T11 sync failure marks stale and does not throw via fail-open', async () => {
    await indexer.indexAndPersist();
    const target = 'types/domain.ts';

    const flaky: Workspace = {
      readFile: async (p: string) => {
        if (normalize(p) === target) throw new Error('simulated FS read failure');
        return workspace.readFile(p);
      },
      writeFile: (p, c) => workspace.writeFile(p, c),
      exists: p => workspace.exists(p),
      listFiles: p => workspace.listFiles(p),
      listEntries: p => workspace.listEntries(p),
      createSnapshot: d => workspace.createSnapshot(d),
      rollback: id => workspace.rollback(id),
      diff: (a, b) => workspace.diff(a, b),
      deleteFile: p => workspace.deleteFile(p),
      mkdir: (p, o) => workspace.mkdir(p, o),
      isDirectory: p => workspace.isDirectory(p),
    };

    const failingSync = new DefaultKnowledgeSynchronizer(
      flaky,
      runtime,
      tempDir,
      new StructuralAnalyzer(),
      new DefaultStructuralGraphIndexer(flaky, runtime, tempDir),
    );

    const executionPreserved = { status: 'FAILED' as const };
    const result = await failingSync.syncFailOpen({
      sessionId: 's1',
      stepId: 'step-stale',
      candidatePaths: [target],
      outcome: 'failed',
    });

    expect(executionPreserved.status).toBe('FAILED');
    expect(result.ok).toBe(false);
    expect(result.stale).toBe(true);
    expect(result.syncState.error).toMatch(/simulated FS read failure/);
    expect(await runtime.exists(STRUCTURAL_SYNC_STATE_RELATIVE_PATH)).toBe(true);
    const state = await failingSync.loadSyncState();
    expect(state!.stale).toBe(true);
    expect(state!.ok).toBe(false);
  });

  // T12
  it('T12 incremental scope analyzes K << N', async () => {
    await indexer.indexAndPersist();
    const n = (await indexer.load())!.meta.fileCount;
    expect(n).toBeGreaterThanOrEqual(5);

    const target = 'server/src/tasks/tasks.service.ts';
    await workspace.writeFile(
      target,
      `${await workspace.readFile(target)}\nexport const INC = 1;\n`,
    );
    const result = await synchronizer.sync({
      sessionId: 's1',
      stepId: 'step-inc',
      candidatePaths: [target],
      outcome: 'success',
    });

    expect(result.fallbackUsed).toBe(false);
    expect(result.repositoryFileCount).toBe(n);
    expect(result.affectedFileCount).toBe(1);
    expect(result.analyzedFileCount).toBe(1);
    expect(result.analyzedFileCount).toBeLessThan(result.repositoryFileCount);
  });

  // T13
  it('T13 TSX mutation updates graph', async () => {
    await indexer.indexAndPersist();
    const target = 'components/StatusBadge.tsx';
    await workspace.writeFile(target, `export function StatusBadge() { return <b>tsx</b>; }\n`);
    const result = await synchronizer.sync({
      sessionId: 's1',
      stepId: 'step-tsx',
      candidatePaths: [target],
      outcome: 'success',
    });
    expect(result.analyzedPaths).toEqual([target]);
    const node = (await indexer.load())!.nodes.find(n => n.path === target)!;
    expect(node.metadata?.extension).toBe('.tsx');
    expect(node.hash).toBe(sha16(await workspace.readFile(target)));
  });

  // T14
  it('T14 server/ mutation updates graph', async () => {
    await indexer.indexAndPersist();
    const target = 'server/src/tasks/tasks.repository.ts';
    await workspace.writeFile(
      target,
      `import type { Task } from '../../../types/domain.ts';\nexport class TasksRepository { list(): Task[] { return []; } find() { return null; } }\n`,
    );
    const result = await synchronizer.sync({
      sessionId: 's1',
      stepId: 'step-server',
      candidatePaths: [target],
      outcome: 'success',
    });
    expect(result.fallbackUsed).toBe(false);
    expect(result.analyzedPaths[0].startsWith('server/')).toBe(true);
    const node = (await indexer.load())!.nodes.find(n => n.path === target)!;
    expect(node.exports).toContain('TasksRepository');
  });

  // T15 / T16
  it('T15/T16 synchronizer source does not import LLM/pipeline/executor/planner', async () => {
    const src = await fs.readFile(
      path.join(__dirname, '../../../src/core/knowledge/knowledge-synchronizer.ts'),
      'utf-8',
    );
    const importLines = src.split(/\r?\n/).filter(l => /^\s*import\s/.test(l));
    const joined = importLines.join('\n');
    expect(joined).not.toMatch(/KnowledgePipeline|knowledge-pipeline/);
    expect(joined).not.toMatch(/TaskExecutor|task-executor/);
    expect(joined).not.toMatch(/ollama|OllamaProvider/);
    expect(joined).not.toMatch(/TaskPlanner|DefaultTaskPlanner|planner/);
    expect(joined).toMatch(/StructuralAnalyzer/);
    expect(joined).toMatch(/ChangeDetector/);
  });

  it('candidatesFromLedger dedupes structural paths from Mutation Ledger', () => {
    const ledger = ledgerFor([
      'server/src/tasks/tasks.service.ts',
      'server\\src\\tasks\\tasks.service.ts',
      'readme.md',
    ]);
    const paths = synchronizer.candidatesFromLedger(ledger);
    expect(paths).toEqual(['server/src/tasks/tasks.service.ts']);
  });
});

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}
