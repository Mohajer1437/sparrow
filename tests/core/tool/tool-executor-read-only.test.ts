/**
 * R1.20 — the executor blocks mutation in READ_ONLY on its own, with no tool
 * policy configured and no LLM cooperation. The proof is that the underlying
 * tool is never invoked.
 */

import { ToolExecutor } from '../../../src/core/tool/tool-executor';
import { ToolRegistry } from '../../../src/contracts/tool-registry';
import { Tool, ToolCall } from '../../../src/domain/tool';

function makeTool(name: string, invoked: string[]): Tool {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      invoked.push(name);
      return { content: 'ok', isError: false };
    },
  } as unknown as Tool;
}

function makeRegistry(names: ReadonlyArray<string>, invoked: string[]): ToolRegistry {
  const tools = new Map(names.map(name => [name, makeTool(name, invoked)]));
  return {
    get: (name: string) => tools.get(name),
    list: () => [...tools.values()],
    register: () => undefined,
  } as unknown as ToolRegistry;
}

function call(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: 'call-' + name, name, arguments: JSON.stringify(args) };
}

const MUTATING = ['write_file', 'apply_patch', 'delete_file', 'rename_file', 'move_file', 'git_commit', 'db_write'];

describe('ToolExecutor READ_ONLY enforcement (R1.20)', () => {
  it.each(MUTATING)('blocks %s and never invokes the tool', async (name) => {
    const invoked: string[] = [];
    const executor = new ToolExecutor(makeRegistry([name], invoked));

    const results = await executor.execute([call(name, { path: 'app/page.tsx' })], 'session-1', undefined, 'READ_ONLY');

    expect(results[0].isError).toBe(true);
    expect(results[0].content).toContain('BLOCKED_BY_POLICY');
    expect(results[0].content).toContain('READ_ONLY');
    expect(invoked).toEqual([]);
  });

  it('still runs read tools in READ_ONLY', async () => {
    const invoked: string[] = [];
    const executor = new ToolExecutor(makeRegistry(['read_file', 'list_files'], invoked));

    const results = await executor.execute(
      [call('read_file', { path: 'app/page.tsx' }), call('list_files')],
      'session-1',
      undefined,
      'READ_ONLY',
    );

    expect(results.every(result => !result.isError)).toBe(true);
    expect(invoked).toEqual(['read_file', 'list_files']);
  });

  it('runs mutating tools normally in STANDARD mode', async () => {
    const invoked: string[] = [];
    const executor = new ToolExecutor(makeRegistry(['write_file'], invoked));

    const results = await executor.execute([call('write_file', { path: 'a.ts' })], 'session-1', undefined, 'STANDARD');

    expect(results[0].isError).toBe(false);
    expect(invoked).toEqual(['write_file']);
  });

  it('defaults to STANDARD when no mode is supplied, so existing callers are unaffected', async () => {
    const invoked: string[] = [];
    const executor = new ToolExecutor(makeRegistry(['write_file'], invoked));

    await executor.execute([call('write_file', { path: 'a.ts' })]);

    expect(invoked).toEqual(['write_file']);
  });

  it('blocks a mutation even when a permissive tool policy would allow it', async () => {
    const invoked: string[] = [];
    const permissive = { evaluate: () => ({ permission: 'ALLOW' as const, evidence: [] }) };
    const executor = new ToolExecutor(makeRegistry(['write_file'], invoked), undefined, permissive as never);

    const results = await executor.execute([call('write_file', { path: 'a.ts' })], undefined, undefined, 'READ_ONLY');

    expect(results[0].isError).toBe(true);
    expect(invoked).toEqual([]);
  });
});
