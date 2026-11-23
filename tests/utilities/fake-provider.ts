import { Provider, ModelRequest, ModelResponse } from '../../src/contracts/provider';
import { ProviderError } from '../../src/domain/errors/provider-errors';

export class SuccessfulFakeProvider implements Provider {
  public callCount = 0;
  constructor(private readonly responseContent: string = 'Task completed successfully') {}
  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.callCount++;
    return {
      content: this.responseContent,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    };
  }
}

export class SlowFakeProvider implements Provider {
  public callCount = 0;
  constructor(private readonly delayMs: number = 50) {}
  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.callCount++;
    await new Promise(resolve => setTimeout(resolve, this.delayMs));
    return {
      content: 'Slow response completed',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    };
  }
}

export class FailingFakeProvider implements Provider {
  public callCount = 0;
  constructor(
    private readonly failAfter: number = 0,
    private readonly errorMessage: string = 'Simulated provider failure'
  ) {}
  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.callCount++;
    if (this.callCount > this.failAfter) {
      throw new ProviderError(this.errorMessage);
    }
    return {
      content: 'OK',
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
    };
  }
}

export class ToolCallingFakeProvider implements Provider {
  public callCount = 0;
  constructor(
    private readonly toolCallCount: number = 1,
    private readonly toolName: string = 'read_file',
    private readonly finalResponse: string = 'Done after tool calls'
  ) {}
  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.callCount++;
    if (this.callCount <= this.toolCallCount) {
      return {
        content: '',
        toolCalls: [{
          id: `call-${this.callCount}`,
          type: 'function',
          function: { name: this.toolName, arguments: JSON.stringify({ path: 'test.txt' }) },
        }],
      };
    }
    return {
      content: this.finalResponse,
      usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
    };
  }
}
