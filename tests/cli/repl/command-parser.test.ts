import { parseCommand } from '../../../src/cli/repl/command-parser';

describe('parseCommand', () => {
  it('should parse normal text as ask', () => {
    expect(parseCommand('hello world')).toEqual({ type: 'ask', args: 'hello world' });
  });

  it('should parse /help', () => {
    expect(parseCommand('/help')).toEqual({ type: 'help' });
  });

  it('should parse /status', () => {
    expect(parseCommand('/status')).toEqual({ type: 'status' });
  });

  it('should parse /workspace', () => {
    expect(parseCommand('/workspace')).toEqual({ type: 'workspace' });
  });

  it('should parse /use with args', () => {
    expect(parseCommand('/use D:\\ERP')).toEqual({ type: 'use', args: 'D:\\ERP' });
  });

  it('should parse /clear', () => {
    expect(parseCommand('/clear')).toEqual({ type: 'clear' });
  });

  it('should parse /history', () => {
    expect(parseCommand('/history')).toEqual({ type: 'history' });
  });

  it('should parse /exit', () => {
    expect(parseCommand('/exit')).toEqual({ type: 'exit' });
  });

  it('should return invalid for unknown commands', () => {
    expect(parseCommand('/unknown')).toEqual({ type: 'invalid' });
  });

  it('should return invalid for empty input', () => {
    expect(parseCommand('   ')).toEqual({ type: 'invalid' });
  });
});
