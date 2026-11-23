/**
 * R1.18, Part 8 — READ_ONLY is reachable only through an explicit interface
 * contract, never through task wording.
 */

import { parseCommand } from '../../../src/cli/repl/command-parser';

describe('READ_ONLY request surface (Part 8)', () => {
  it('defaults /execute to STANDARD', () => {
    expect(parseCommand('/execute Add a JSX comment to app/page.tsx')).toEqual({
      type: 'execute',
      args: 'Add a JSX comment to app/page.tsx',
      executionMode: 'STANDARD',
    });
  });

  it('honours the explicit --read-only flag and strips it from the task text', () => {
    const parsed = parseCommand('/execute --read-only Inspect app/page.tsx');
    expect(parsed.type).toBe('execute');
    expect(parsed.executionMode).toBe('READ_ONLY');
    expect(parsed.args).toBe('Inspect app/page.tsx');
  });

  it('accepts the flag at the end of the task text', () => {
    const parsed = parseCommand('/execute Inspect app/page.tsx --read-only');
    expect(parsed.executionMode).toBe('READ_ONLY');
    expect(parsed.args).toBe('Inspect app/page.tsx');
  });

  it('treats /inspect as READ_ONLY', () => {
    expect(parseCommand('/inspect Explain app/page.tsx')).toEqual({
      type: 'inspect',
      args: 'Explain app/page.tsx',
      executionMode: 'READ_ONLY',
    });
  });

  it('does not infer READ_ONLY from task wording', () => {
    const parsed = parseCommand('/execute Do not modify files, just read app/page.tsx');
    expect(parsed.executionMode).toBe('STANDARD');
  });

  it('does not treat a similar word inside the task as the flag', () => {
    const parsed = parseCommand('/execute Document the read-only cache behaviour');
    expect(parsed.executionMode).toBe('STANDARD');
    expect(parsed.args).toBe('Document the read-only cache behaviour');
  });
});
