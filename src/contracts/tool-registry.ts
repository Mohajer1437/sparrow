import { Tool } from '../domain/tool';

/**
 * ToolRegistry manages the collection of available tools.
 * 
 * The registry is immutable after construction: once tools are
 * registered (via constructor injection), no new tools can be
 * added and existing tools cannot be removed or replaced.
 * 
 * The register() method exists in the contract to support
 * builder patterns during construction but MUST throw if
 * called after the registry is sealed.
 */
export interface ToolRegistry {
  /**
   * Registers a tool. Throws if the registry is immutable
   * or if a tool with the same name is already registered.
   */
  register(tool: Tool): void;

  /**
   * Returns the tool registered under the given name,
   * or undefined if no such tool exists.
   */
  get(name: string): Tool | undefined;

  /**
   * Returns an immutable list of all registered tool names.
   */
  list(): ReadonlyArray<string>;
}
