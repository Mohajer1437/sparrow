import { InMemoryToolRegistry } from '../../../src/core/tool/in-memory-tool-registry';
import { Tool, ToolResult } from '../../../src/domain/tool';

describe('InMemoryToolRegistry', () => {
  const createMockTool = (name: string): Tool => ({
    name,
    description: `Mock tool: ${name}`,
    execute: jest.fn().mockResolvedValue({
      toolCallId: 'call-1',
      content: `Result from ${name}`,
      isError: false
    } as ToolResult)
  });

  describe('construction with multiple tools', () => {
    it('should register multiple tools via constructor', () => {
      const toolA = createMockTool('read_file');
      const toolB = createMockTool('write_file');
      const toolC = createMockTool('list_dir');

      const registry = new InMemoryToolRegistry([toolA, toolB, toolC]);

      expect(registry.list().length).toBe(3);
      expect(registry.get('read_file')).toBe(toolA);
      expect(registry.get('write_file')).toBe(toolB);
      expect(registry.get('list_dir')).toBe(toolC);
    });

    it('should create empty registry when no tools provided', () => {
      const registry = new InMemoryToolRegistry();

      expect(registry.list().length).toBe(0);
    });
  });

  describe('resolve tool by name', () => {
    it('should return the correct tool for a registered name', () => {
      const tool = createMockTool('search');
      const registry = new InMemoryToolRegistry([tool]);

      const resolved = registry.get('search');

      expect(resolved).toBe(tool);
      expect(resolved?.name).toBe('search');
      expect(resolved?.description).toBe('Mock tool: search');
    });
  });

  describe('unknown tool', () => {
    it('should return undefined for unregistered tool name', () => {
      const tool = createMockTool('exists');
      const registry = new InMemoryToolRegistry([tool]);

      expect(registry.get('does_not_exist')).toBeUndefined();
      expect(registry.get('')).toBeUndefined();
      expect(registry.get('EXISTS')).toBeUndefined(); // case sensitive
    });
  });

  describe('duplicate registration rejection', () => {
    it('should throw when duplicate tool names are provided in constructor', () => {
      const toolA = createMockTool('duplicate');
      const toolB = createMockTool('duplicate');

      expect(() => new InMemoryToolRegistry([toolA, toolB])).toThrow(
        'Duplicate tool registration: "duplicate"'
      );
    });

    it('should throw with the name of the duplicate tool', () => {
      const toolA = createMockTool('unique');
      const toolB = createMockTool('conflict');
      const toolC = createMockTool('conflict');

      expect(() => new InMemoryToolRegistry([toolA, toolB, toolC])).toThrow(
        'Duplicate tool registration: "conflict"'
      );
    });
  });

  describe('immutable registry behavior', () => {
    it('should throw when register() is called after construction', () => {
      const registry = new InMemoryToolRegistry([createMockTool('existing')]);
      const newTool = createMockTool('new_tool');

      expect(() => registry.register(newTool)).toThrow(
        'ToolRegistry is immutable after construction'
      );
    });

    it('should throw when register() is called on empty registry', () => {
      const registry = new InMemoryToolRegistry();
      const newTool = createMockTool('new_tool');

      expect(() => registry.register(newTool)).toThrow(
        'ToolRegistry is immutable after construction'
      );
    });

    it('should return frozen array from list()', () => {
      const registry = new InMemoryToolRegistry([
        createMockTool('a'),
        createMockTool('b')
      ]);

      const list = registry.list();

      expect(Object.isFrozen(list)).toBe(true);
      expect(() => {
        (list as any).push('hack');
      }).toThrow();
    });

    it('should not be affected by external mutation of input array', () => {
      const tools = [createMockTool('stable')];
      const registry = new InMemoryToolRegistry(tools);

      tools.push(createMockTool('injected'));

      expect(registry.list().length).toBe(1);
      expect(registry.get('injected')).toBeUndefined();
    });
  });
});
