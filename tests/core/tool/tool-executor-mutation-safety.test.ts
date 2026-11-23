import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ToolExecutor } from '../../../src/core/tool/tool-executor';
import { InMemoryToolRegistry } from '../../../src/core/tool/in-memory-tool-registry';
import { Tool, ToolResult } from '../../../src/domain/tool';
import { ToolCall } from '../../../src/domain/tool';

/**
 * R2.2 — the canonical boundary, exercised through ToolExecutor itself.
 *
 * INTEGRATION tests: real ToolExecutor, real MutationGuard, real filesystem,
 * with a stub tool standing in for the registered workspace tools so each
 * hostile write is reproducible.
 */

const VALID_PAGE = `export default function Page() {
  return <main><h1>Hello</h1></main>;
}
`;

let workspace: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-exec-'));
  fs.mkdirSync(path.join(workspace, 'app'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'app', 'page.tsx'), VALID_PAGE, 'utf8');
  fs.writeFileSync(path.join(workspace, 'app', 'layout.tsx'), VALID_PAGE, 'utf8');
});

afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }));

const hashOf = (relative: string) =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(workspace, relative))).digest('hex');

/** Writes whatever `transform` produces, so a corrupt result is deterministic. */
function makeWriteTool(transform: (content: string) => string = c => c): Tool & { calls: number } {
  const tool: any = {
    name: 'write_file',
    description: 'write',
    parameters: {},
    calls: 0,
    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      tool.calls += 1;
      const target = path.resolve(workspace, String(input.path));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, transform(String(input.content ?? '')), 'utf8');
      return { toolCallId: '', content: `Successfully wrote to ${input.path}`, isError: false };
    },
  };
  return tool;
}

function sessionManagerWith(scope: string[], markers: string[] = []) {
  return {
    recordEvent: jest.fn(),
    getExpectedFiles: () => scope,
    getExpectedChangeMarkers: () => markers,
  } as never;
}

const call = (args: Record<string, unknown>): ToolCall => ({
  id: 'call-1',
  name: 'write_file',
  arguments: JSON.stringify(args),
});

describe('R2.2 every mutation passes the same boundary', () => {
  it('applies a clean in-scope write and reports it as applied', async () => {
    const tool = makeWriteTool();
    const executor = new ToolExecutor(
      new InMemoryToolRegistry([tool]),
      sessionManagerWith(['app/page.tsx']),
      undefined,
      workspace,
    );

    const next = VALID_PAGE.replace('Hello', 'Hi');
    const results = await executor.execute([call({ path: 'app/page.tsx', content: next })], 's1');

    expect(results[0].isError).toBe(false);
    expect(fs.readFileSync(path.join(workspace, 'app/page.tsx'), 'utf8')).toBe(next);

    const ledger = executor.drainMutationLedger();
    expect(ledger.mutationAttempts).toBe(1);
    expect(ledger.successfulMutations).toBe(1);
    expect(ledger.results[0].toolName).toBe('write_file');
    expect(ledger.results[0].beforeHash).not.toBe(ledger.results[0].afterHash);
  });

  it('blocks an out-of-scope target and never invokes the tool', async () => {
    const tool = makeWriteTool();
    const before = hashOf('app/layout.tsx');
    const executor = new ToolExecutor(
      new InMemoryToolRegistry([tool]),
      sessionManagerWith(['app/page.tsx']),
      undefined,
      workspace,
    );

    const results = await executor.execute([call({ path: 'app/layout.tsx', content: 'x' })], 's1');

    expect(results[0].isError).toBe(true);
    expect(results[0].content).toMatch(/MUTATION_BLOCKED/);
    expect(results[0].content).toMatch(/TARGET_OUT_OF_SCOPE/);
    expect(tool.calls).toBe(0);
    expect(hashOf('app/layout.tsx')).toBe(before);
    expect(executor.drainMutationLedger().outOfScopeAttempts).toBe(1);
  });

  it('rejects a malformed candidate and tells the agent why, without writing', async () => {
    const tool = makeWriteTool();
    const before = hashOf('app/page.tsx');
    const executor = new ToolExecutor(
      new InMemoryToolRegistry([tool]),
      sessionManagerWith(['app/page.tsx']),
      undefined,
      workspace,
    );

    const results = await executor.execute(
      [call({ path: 'app/page.tsx', content: 'export default function Page() { return <main>; }' })],
      's1',
    );

    expect(results[0].isError).toBe(true);
    expect(results[0].content).toMatch(/MUTATION_REJECTED/);
    expect(results[0].content).toMatch(/SYNTAX_INVALID/);
    expect(results[0].content).toMatch(/No file was modified/);
    expect(tool.calls).toBe(0);
    expect(hashOf('app/page.tsx')).toBe(before);
    expect(executor.drainMutationLedger().syntaxFailures).toBe(1);
  });

  it('rolls back a corrupted on-disk result and reports the restore', async () => {
    const tool = makeWriteTool(content => content.slice(0, 45));
    const before = hashOf('app/page.tsx');
    const executor = new ToolExecutor(
      new InMemoryToolRegistry([tool]),
      sessionManagerWith(['app/page.tsx']),
      undefined,
      workspace,
    );

    const results = await executor.execute(
      [call({ path: 'app/page.tsx', content: VALID_PAGE.replace('Hello', 'Hi') })],
      's1',
    );

    expect(results[0].isError).toBe(true);
    expect(results[0].content).toMatch(/MUTATION_ROLLED_BACK/);
    expect(results[0].content).toMatch(/Rolled back: app\/page\.tsx \(restored\)/);
    expect(hashOf('app/page.tsx')).toBe(before);

    const ledger = executor.drainMutationLedger();
    expect(ledger.rolledBackMutations).toBe(1);
    expect(ledger.successfulMutations).toBe(0);
    expect(ledger.results[0].rollbackVerified).toBe(true);
  });

  it('surfaces a suspicious diff as a warning while still applying it', async () => {
    const tool = makeWriteTool();
    const executor = new ToolExecutor(
      new InMemoryToolRegistry([tool]),
      sessionManagerWith(['app/page.tsx']),
      undefined,
      workspace,
    );

    const big = 'export default function Page() {\n'
      + Array.from({ length: 40 }, (_, i) => `  const v${i} = ${i};`).join('\n')
      + '\n  return <main>{v0}</main>;\n}\n';
    fs.writeFileSync(path.join(workspace, 'app/page.tsx'), big, 'utf8');

    const results = await executor.execute([call({ path: 'app/page.tsx', content: VALID_PAGE })], 's1');

    expect(results[0].isError).toBe(false);
    expect(results[0].content).toMatch(/SUSPICIOUS_MUTATION/);
    expect(executor.drainMutationLedger().unexpectedDiffs).toBe(1);
  });

  it('keeps the READ_ONLY block ahead of the mutation guard (R2.25)', async () => {
    const tool = makeWriteTool();
    const before = hashOf('app/page.tsx');
    const executor = new ToolExecutor(
      new InMemoryToolRegistry([tool]),
      sessionManagerWith(['app/page.tsx']),
      undefined,
      workspace,
    );

    const results = await executor.execute(
      [call({ path: 'app/page.tsx', content: VALID_PAGE.replace('Hello', 'ro') })],
      's1',
      undefined,
      'READ_ONLY',
    );

    expect(results[0].isError).toBe(true);
    expect(results[0].content).toMatch(/READ_ONLY/);
    expect(tool.calls).toBe(0);
    expect(hashOf('app/page.tsx')).toBe(before);
    // The mode guard fires first, so no guarded mutation attempt is recorded.
    expect(executor.drainMutationLedger().mutationAttempts).toBe(0);
  });

  it('enforces a declared expected-change marker end to end', async () => {
    const tool = makeWriteTool();
    const before = hashOf('app/page.tsx');
    const executor = new ToolExecutor(
      new InMemoryToolRegistry([tool]),
      sessionManagerWith(['app/page.tsx'], ['r2-write-e2e']),
      undefined,
      workspace,
    );

    const withoutMarker = VALID_PAGE.replace('Hello', 'Hi');
    const missing = await executor.execute([call({ path: 'app/page.tsx', content: withoutMarker })], 's1');
    expect(missing[0].content).toMatch(/EXPECTED_CHANGE_MISSING/);
    expect(hashOf('app/page.tsx')).toBe(before);

    const withMarker = VALID_PAGE.replace('<h1>Hello</h1>', '{/* r2-write-e2e */}<h1>Hello</h1>');
    const present = await executor.execute([call({ path: 'app/page.tsx', content: withMarker })], 's1');
    expect(present[0].isError).toBe(false);
    expect(fs.readFileSync(path.join(workspace, 'app/page.tsx'), 'utf8')).toContain('r2-write-e2e');
  });

  it('drains the ledger once, so a second read does not double-count', async () => {
    const tool = makeWriteTool();
    const executor = new ToolExecutor(
      new InMemoryToolRegistry([tool]),
      sessionManagerWith(['app/page.tsx']),
      undefined,
      workspace,
    );

    await executor.execute([call({ path: 'app/page.tsx', content: VALID_PAGE.replace('Hello', 'Hi') })], 's1');
    expect(executor.drainMutationLedger().mutationAttempts).toBe(1);
    expect(executor.drainMutationLedger().mutationAttempts).toBe(0);
  });

  it('leaves non-mutating tools and un-rooted executors on their original path', async () => {
    const reader: Tool = {
      name: 'read_file',
      description: 'read',
      parameters: {},
      execute: async () => ({ toolCallId: '', content: 'contents', isError: false }),
    };
    const executor = new ToolExecutor(new InMemoryToolRegistry([reader]), undefined, undefined, workspace);
    const results = await executor.execute([{ id: 'c', name: 'read_file', arguments: '{"path":"app/page.tsx"}' }]);
    expect(results[0].isError).toBe(false);
    expect(executor.drainMutationLedger().mutationAttempts).toBe(0);

    // No workspace root means there is nothing to guard; behaviour is unchanged.
    const rootless = new ToolExecutor(new InMemoryToolRegistry([makeWriteTool()]));
    const unguarded = await rootless.execute([call({ path: 'app/page.tsx', content: 'anything' })]);
    expect(unguarded[0].isError).toBe(false);
    expect(rootless.drainMutationLedger().mutationAttempts).toBe(0);
  });
});
