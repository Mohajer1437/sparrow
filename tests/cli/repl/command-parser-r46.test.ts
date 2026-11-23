import { parseCommand } from '../../../src/cli/repl/command-parser';

describe('command-parser R4.6 extensions', () => {
  it('parses /role list', () => {
    const result = parseCommand('/role list');
    expect(result.type).toBe('role');
    expect(result.args).toBe('list');
  });

  it('parses /role show coder', () => {
    const result = parseCommand('/role show coder');
    expect(result.type).toBe('role');
    expect(result.args).toBe('show coder');
  });

  it('parses /model list --local', () => {
    const result = parseCommand('/model list --local');
    expect(result.type).toBe('model');
    expect(result.args).toBe('list --local');
  });

  it('parses /assign set coder gpt-4o', () => {
    const result = parseCommand('/assign set coder gpt-4o');
    expect(result.type).toBe('assign');
    expect(result.args).toBe('set coder gpt-4o');
  });

  it('parses /assign reset', () => {
    const result = parseCommand('/assign reset');
    expect(result.type).toBe('assign');
    expect(result.args).toBe('reset');
  });

  it('still parses existing commands correctly', () => {
    expect(parseCommand('/help').type).toBe('help');
    expect(parseCommand('/status').type).toBe('status');
    expect(parseCommand('hello').type).toBe('ask');
  });
});
