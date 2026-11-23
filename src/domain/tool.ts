/**
 * Tool represents a callable action that can be executed by the system.
 * Tools are registered in a ToolRegistry and invoked when the LLM
 * requests a tool call.
 */
export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  execute(input: Readonly<Record<string, unknown>>): Promise<ToolResult>;
}

/**
 * ToolCall represents an LLM's request to invoke a specific tool.
 * This is produced by the Provider after parsing the model's response.
 */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

/**
 * ToolResult represents the outcome of executing a tool.
 * This is fed back to the LLM so it can continue reasoning.
 */
export interface ToolResult {
  readonly toolCallId: string;
  readonly content: string;
  readonly isError: boolean;
}
