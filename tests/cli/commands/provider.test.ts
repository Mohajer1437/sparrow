import { parseCommand } from '../../../src/cli/repl/command-parser';
import { printSmokeResult } from '../../../src/cli/commands/provider';
import { ProviderSmokeTestResult } from '../../../src/domain/provider-smoke-test';

describe('provider command parsing', () => {
  it('parses /provider health', () => {
    expect(parseCommand('/provider health')).toEqual({
      type: 'provider',
      args: 'health',
    });
  });

  it('parses /provider test', () => {
    expect(parseCommand('/provider test')).toEqual({
      type: 'provider',
      args: 'test',
    });
  });

  it('parses /provider list', () => {
    expect(parseCommand('/provider list')).toEqual({
      type: 'provider',
      args: 'list',
    });
  });

  it('parses /provider use', () => {
    expect(parseCommand('/provider use omniroute-local')).toEqual({
      type: 'provider',
      args: 'use omniroute-local',
    });
  });

  it('parses /provider', () => {
    expect(parseCommand('/provider')).toEqual({
      type: 'provider',
      args: '',
    });
  });
});

describe('printSmokeResult', () => {
  it('prints success fields', () => {
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((msg?: any) => {
      logs.push(String(msg ?? ''));
    });

    const result: ProviderSmokeTestResult = {
      providerType: 'ollama',
      endpoint: 'http://localhost:11434',
      model: 'qwen2.5:3b',
      latencyMs: 42,
      success: true,
      responsePreview: 'OK',
      checkedAt: '2026-01-01T00:00:00.000Z',
    };
    printSmokeResult(result);

    const joined = logs.join('\n');
    expect(joined).toContain('PROVIDER SMOKE TEST');
    expect(joined).toContain('Success:    yes');
    expect(joined).toContain('Type:       ollama');
    expect(joined).toContain('Endpoint:   http://localhost:11434');
    expect(joined).toContain('Model:      qwen2.5:3b');
    expect(joined).toContain('Latency:    42 ms');
    expect(joined).toContain('Response:   OK');

    spy.mockRestore();
  });

  it('prints failure category', () => {
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((msg?: any) => {
      logs.push(String(msg ?? ''));
    });

    printSmokeResult({
      providerType: 'openai-compatible',
      endpoint: 'https://example.com/v1',
      model: 'm',
      latencyMs: 5,
      success: false,
      failureCategory: 'authentication',
      message: 'bad key',
      checkedAt: '2026-01-01T00:00:00.000Z',
    });

    const joined = logs.join('\n');
    expect(joined).toContain('Success:    no');
    expect(joined).toContain('Failure:    authentication');
    expect(joined).toContain('Note:       bad key');

    spy.mockRestore();
  });
});
