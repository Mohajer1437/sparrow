import { ToolRegistry } from '../../contracts/tool-registry';
import { Tool } from '../../domain/tool';

/**
 * InMemoryToolRegistry is the reference implementation of ToolRegistry.
 * 
 * Tools are provided exclusively through constructor injection.
 * The registry is immutable after construction:
 * - register() always throws
 * - get() performs lookup on the frozen internal map
 * - list() returns a frozen array of tool names
 * 
 * Duplicate tool names in the constructor input cause an immediate error.
 */
export class InMemoryToolRegistry implements ToolRegistry {
  private readonly tools: ReadonlyMap<string, Tool>;

  constructor(tools: ReadonlyArray<Tool> = []) {
    const map = new Map<string, Tool>();

    for (const tool of tools) {
      if (map.has(tool.name)) {
        throw new Error(`Duplicate tool registration: "${tool.name}"`);
      }
      map.set(tool.name, tool);
    }

    this.tools = map;
  }

  register(_tool: Tool): void {
    throw new Error('ToolRegistry is immutable after construction. Pass tools via constructor.');
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): ReadonlyArray<string> {
    return Object.freeze(Array.from(this.tools.keys()));
  }
}
