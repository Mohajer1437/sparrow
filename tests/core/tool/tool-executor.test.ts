import { ToolExecutor } from '../../../src/core/tool/tool-executor';
import { InMemoryToolRegistry } from '../../../src/core/tool/in-memory-tool-registry';
import { Tool, ToolCall, ToolResult } from '../../../src/domain/tool';
import { ExecutionContract } from '../../../src/domain/pre-execution/contract';

describe('ToolExecutor', () => {
  const createMockTool = (name: string, implementation?: (input: any) => Promise<ToolResult>): Tool => ({
    name,
    description: `Mock tool: ${name}`,
    execute: implementation || jest.fn().mockResolvedValue({
      toolCallId: 'call-1',
      content: `Result from ${name}`,
      isError: false
    } as ToolResult)
  });

  const createToolCall = (id: string, name: string, args: any = {}): ToolCall => ({
    id,
    name,
    arguments: JSON.stringify(args)
  });

  describe('execute single tool', () => {
    it('should execute a single tool successfully', async () => {
      const tool = createMockTool('read_file');
      const registry = new InMemoryToolRegistry([tool]);
      const executor = new ToolExecutor(registry);

      const toolCalls = [createToolCall('call-1', 'read_file', { path: 'test.txt' })];
      const results = await executor.execute(toolCalls);

      expect(results).toHaveLength(1);
      expect(results[0].toolCallId).toBe('call-1');
      expect(results[0].content).toBe('Result from read_file');
      expect(results[0].isError).toBe(false);
      expect(tool.execute).toHaveBeenCalledWith({ path: 'test.txt' });
    });
  });

  describe('execute multiple tools', () => {
    it('should execute multiple tools in sequence', async () => {
      const tool1 = createMockTool('read_file');
      const tool2 = createMockTool('write_file');
      const tool3 = createMockTool('list_dir');
      
      const registry = new InMemoryToolRegistry([tool1, tool2, tool3]);
      const executor = new ToolExecutor(registry);

      const toolCalls = [
        createToolCall('call-1', 'read_file', { path: 'a.txt' }),
        createToolCall('call-2', 'write_file', { path: 'b.txt', content: 'data' }),
        createToolCall('call-3', 'list_dir', { path: '.' })
      ];

      const results = await executor.execute(toolCalls);

      expect(results).toHaveLength(3);
      expect(results[0].toolCallId).toBe('call-1');
      expect(results[1].toolCallId).toBe('call-2');
      expect(results[2].toolCallId).toBe('call-3');
      expect(tool1.execute).toHaveBeenCalled();
      expect(tool2.execute).toHaveBeenCalled();
      expect(tool3.execute).toHaveBeenCalled();
    });
  });

  describe('unknown tool', () => {
    it('should return error result for unknown tool', async () => {
      const tool = createMockTool('exists');
      const registry = new InMemoryToolRegistry([tool]);
      const executor = new ToolExecutor(registry);

      const toolCalls = [createToolCall('call-1', 'does_not_exist')];
      const results = await executor.execute(toolCalls);

      expect(results).toHaveLength(1);
      expect(results[0].toolCallId).toBe('call-1');
      expect(results[0].isError).toBe(true);
      expect(results[0].content).toContain('Tool not found: does_not_exist');
    });
  });

  describe('tool throwing exception', () => {
    it('should catch exception and return error result', async () => {
      const failingTool: Tool = {
        name: 'failing_tool',
        description: 'A tool that always fails',
        execute: jest.fn().mockRejectedValue(new Error('Internal error'))
      };

      const registry = new InMemoryToolRegistry([failingTool]);
      const executor = new ToolExecutor(registry);

      const toolCalls = [createToolCall('call-1', 'failing_tool')];
      const results = await executor.execute(toolCalls);

      expect(results).toHaveLength(1);
      expect(results[0].toolCallId).toBe('call-1');
      expect(results[0].isError).toBe(true);
      expect(results[0].content).toContain('Tool execution failed: Internal error');
    });

    it('should handle invalid JSON in arguments', async () => {
      const tool = createMockTool('test_tool');
      const registry = new InMemoryToolRegistry([tool]);
      const executor = new ToolExecutor(registry);

      const toolCalls: ToolCall[] = [{
        id: 'call-1',
        name: 'test_tool',
        arguments: '{invalid json'
      }];

      const results = await executor.execute(toolCalls);

      expect(results).toHaveLength(1);
      expect(results[0].isError).toBe(true);
      expect(results[0].content).toContain('Tool execution failed');
    });
  });

  describe('preserve execution order', () => {
    it('should maintain exact order of tool calls', async () => {
      const executionOrder: string[] = [];
      
      const createOrderedTool = (name: string): Tool => ({
        name,
        description: `Tool ${name}`,
        execute: jest.fn().mockImplementation(async () => {
          executionOrder.push(name);
          return { toolCallId: 'call', content: name, isError: false };
        })
      });

      const tools = [
        createOrderedTool('tool_a'),
        createOrderedTool('tool_b'),
        createOrderedTool('tool_c')
      ];

      const registry = new InMemoryToolRegistry(tools);
      const executor = new ToolExecutor(registry);

      const toolCalls = [
        createToolCall('call-1', 'tool_a'),
        createToolCall('call-2', 'tool_b'),
        createToolCall('call-3', 'tool_c')
      ];

      await executor.execute(toolCalls);

      expect(executionOrder).toEqual(['tool_a', 'tool_b', 'tool_c']);
    });

    it('should preserve order even with mixed success and failure', async () => {
      const successTool = createMockTool('success');
      const failingTool: Tool = {
        name: 'failing',
        description: 'Fails',
        execute: jest.fn().mockRejectedValue(new Error('Fail'))
      };

      const registry = new InMemoryToolRegistry([successTool, failingTool]);
      const executor = new ToolExecutor(registry);

      const toolCalls = [
        createToolCall('call-1', 'success'),
        createToolCall('call-2', 'failing'),
        createToolCall('call-3', 'success'),
        createToolCall('call-4', 'unknown')
      ];

      const results = await executor.execute(toolCalls);

      expect(results).toHaveLength(4);
      expect(results[0].toolCallId).toBe('call-1');
      expect(results[0].isError).toBe(false);
      expect(results[1].toolCallId).toBe('call-2');
      expect(results[1].isError).toBe(true);
      expect(results[2].toolCallId).toBe('call-3');
      expect(results[2].isError).toBe(false);
      expect(results[3].toolCallId).toBe('call-4');
      expect(results[3].isError).toBe(true);
    });
  });

  describe('continue after failure', () => {
    it('should continue executing remaining tools after one fails', async () => {
      const tool1 = createMockTool('tool1');
      const failingTool: Tool = {
        name: 'failing',
        description: 'Fails',
        execute: jest.fn().mockRejectedValue(new Error('Fail'))
      };
      const tool3 = createMockTool('tool3');

      const registry = new InMemoryToolRegistry([tool1, failingTool, tool3]);
      const executor = new ToolExecutor(registry);

      const toolCalls = [
        createToolCall('call-1', 'tool1'),
        createToolCall('call-2', 'failing'),
        createToolCall('call-3', 'tool3')
      ];

      const results = await executor.execute(toolCalls);

      expect(results).toHaveLength(3);
      expect(tool1.execute).toHaveBeenCalled();
      expect(failingTool.execute).toHaveBeenCalled();
      expect(tool3.execute).toHaveBeenCalled();
      
      expect(results[0].isError).toBe(false);
      expect(results[1].isError).toBe(true);
      expect(results[2].isError).toBe(false);
    });

    it('should continue after unknown tool error', async () => {
      const tool = createMockTool('exists');
      const registry = new InMemoryToolRegistry([tool]);
      const executor = new ToolExecutor(registry);

      const toolCalls = [
        createToolCall('call-1', 'unknown'),
        createToolCall('call-2', 'exists')
      ];

      const results = await executor.execute(toolCalls);

      expect(results).toHaveLength(2);
      expect(results[0].isError).toBe(true);
      expect(results[1].isError).toBe(false);
      expect(tool.execute).toHaveBeenCalled();
    });
  });

  describe('empty ToolCall list', () => {
    it('should return empty array for empty input', async () => {
      const registry = new InMemoryToolRegistry([]);
      const executor = new ToolExecutor(registry);

      const results = await executor.execute([]);

      expect(results).toEqual([]);
      expect(results).toHaveLength(0);
    });
  });

  describe('Stage 7 contract enforcement', () => {
    const contract: ExecutionContract = {
      id: 'c1', planId: 'p1', objective: 'test', context: '', knownFacts: [], evidence: [], hypotheses: [], constraints: [],
      allowedActions: ['write_file'], forbiddenActions: ['delete_file'], filesInScope: ['src/allowed.ts'], filesOutOfScope: [],
      preconditions: [], steps: [], risk: 'LOW', impact: '', rollback: '', verification: '', outputRequirements: [],
      createdAt: new Date().toISOString(), version: '1', validated: true, validationErrors: [],
    };

    it('denies mutation outside filesInScope', async () => {
      const tool = createMockTool('write_file');
      const executor = new ToolExecutor(new InMemoryToolRegistry([tool]));
      const results = await executor.execute([createToolCall('call-1', 'write_file', { path: 'src/secret.ts' })], undefined, contract);
      expect(results[0].isError).toBe(true);
      expect(results[0].content).toMatch(/scope/i);
      expect(tool.execute).not.toHaveBeenCalled();
    });

    it('allows mutation inside filesInScope', async () => {
      const tool = createMockTool('write_file');
      const executor = new ToolExecutor(new InMemoryToolRegistry([tool]));
      const results = await executor.execute([createToolCall('call-1', 'write_file', { path: 'src/allowed.ts' })], undefined, contract);
      expect(results[0].isError).toBe(false);
      expect(tool.execute).toHaveBeenCalled();
    });

    it('allows evidence-driven apply_patch expansion and still protects unrelated files', async () => {
      const expanded = { ...contract, filesInScope: ['app/page.tsx', 'app/CrashBeacon.tsx'] };
      const allowed = createMockTool('apply_patch');
      const denied = createMockTool('apply_patch');
      const allowExecutor = new ToolExecutor(new InMemoryToolRegistry([allowed]));
      const denyExecutor = new ToolExecutor(new InMemoryToolRegistry([denied]));

      const allowedResult = await allowExecutor.execute([
        createToolCall('call-1', 'apply_patch', {
          sessionId: 's1',
          reason: 'required repair of implicated throw',
          operations: [{ path: 'app/CrashBeacon.tsx', operation: 'modify', newContent: 'export default function CrashBeacon() { return null; }' }],
        }),
      ], undefined, expanded);
      expect(allowedResult[0].isError).toBe(false);
      expect(allowed.execute).toHaveBeenCalled();

      const deniedResult = await denyExecutor.execute([
        createToolCall('call-2', 'apply_patch', {
          sessionId: 's1',
          reason: 'required',
          operations: [{ path: 'lib/secret.ts', operation: 'modify', newContent: 'x' }],
        }),
      ], undefined, expanded);
      expect(deniedResult[0].isError).toBe(true);
      expect(deniedResult[0].content).toMatch(/scope/i);
      expect(denied.execute).not.toHaveBeenCalled();
    });
  });

  describe('runtime sessionId propagation (Fix A)', () => {
    it('supplies authoritative runtime sessionId to tool execution', async () => {
      const tool = createMockTool('apply_patch');
      const registry = new InMemoryToolRegistry([tool]);
      const executor = new ToolExecutor(registry);

      const toolCalls = [
        createToolCall('call-1', 'apply_patch', {
          reason: 'add marker',
          operations: [{ path: 'components/TaskCard.tsx', operation: 'modify', newContent: 'new' }],
        }),
      ];

      const results = await executor.execute(toolCalls, 'authoritative-session-123');

      expect(results).toHaveLength(1);
      expect(results[0].isError).toBe(false);
      expect(tool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'authoritative-session-123',
          reason: 'add marker',
        })
      );
    });

    it('prevents model-supplied sessionId from overriding authoritative runtime sessionId', async () => {
      const tool = createMockTool('apply_patch');
      const registry = new InMemoryToolRegistry([tool]);
      const executor = new ToolExecutor(registry);

      const toolCalls = [
        createToolCall('call-1', 'apply_patch', {
          sessionId: 'unauthorized-model-spoofed-session',
          reason: 'add marker',
          operations: [{ path: 'components/TaskCard.tsx', operation: 'modify', newContent: 'new' }],
        }),
      ];

      const results = await executor.execute(toolCalls, 'authoritative-runtime-session');

      expect(results).toHaveLength(1);
      expect(results[0].isError).toBe(false);
      expect(tool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'authoritative-runtime-session',
        })
      );
    });
  });
});
