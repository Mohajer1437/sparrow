/**
 * CLI parity tests for Milestone H.
 *
 * The terminal must present the same authoritative state as the Web API, and
 * must never soften an unknown into a verdict when printing it.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { runsCommand } from '../../../src/cli/commands/runs';
import { capabilitiesCommand } from '../../../src/cli/commands/capabilities';
import { parseCommand } from '../../../src/cli/repl/command-parser';
import { FileTaskRunStore } from '../../../src/app/file-task-run-store';
import { makeSnapshot } from '../../core/reliability/fixtures/reliability-fixtures';

const TASK_ID = 'task-2026-08-28T10-00-00-000Z-cliaaa';

let root: string;
let logSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

function output(): string {
  return logSpy.mock.calls.map(call => call.join(' ')).join('\n');
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-cli-h-'));
  await new FileTaskRunStore(root).save(makeSnapshot({
    taskId: TASK_ID,
    sessionId: 'run-cli',
    impactAnalysis: {
      confidence: 'UNKNOWN',
      summary: 'no relations could be resolved',
      changedFiles: ['app/page.tsx'],
      directlyAffected: [],
      indirectlyAffected: [],
      affectedEndpoints: [],
      affectedTests: [],
      affectedDomains: [],
      relations: [],
      unknowns: ['app/page.tsx'],
      limitsReached: true,
    },
  }));
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('CLI runs command (H.9)', () => {
  it('lists recorded runs with their run identity', async () => {
    await runsCommand(['--workspace', root]);
    expect(output()).toContain(TASK_ID);
    expect(output()).toContain('run=run-cli');
  });

  it('defaults to the timeline view and marks stages without evidence as absent', async () => {
    await runsCommand([TASK_ID, '--workspace', root]);
    const text = output();
    expect(text).toContain('Timeline:');
    expect(text).toContain('TODO_PLAN');
    expect(text).not.toContain('REPAIR ');
    expect(text).toContain('produced no recorded evidence');
  });

  it('accepts a positional view so the REPL can pass /runs <taskId> <view>', async () => {
    await runsCommand([TASK_ID, 'verification', '--workspace', root]);
    expect(output()).toContain('Verification:');
  });

  it('prints todo verification as UNKNOWN while evidence is whole-run', async () => {
    await runsCommand([TASK_ID, '--view', 'plan', '--workspace', root]);
    expect(output()).toContain('verification=UNKNOWN');
    expect(output()).toContain('scope=WHOLE_RUN');
  });

  it('prints UNKNOWN impact without turning it into no impact', async () => {
    await runsCommand([TASK_ID, '--view', 'impact', '--workspace', root]);
    const text = output();
    expect(text).toContain('Confidence:  UNKNOWN');
    expect(text).toContain('Unknowns:    app/page.tsx');
  });

  it('reports absent evidence rather than inventing a section', async () => {
    await runsCommand([TASK_ID, '--view', 'repair', '--workspace', root]);
    expect(output()).toContain('No repair activity was recorded');
  });

  it('emits the shared error vocabulary for an unknown run', async () => {
    await runsCommand(['task-2026-08-28T10-00-00-000Z-missing', '--workspace', root]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('NOT_FOUND'));
  });

  it('emits a validation error for a malformed task id', async () => {
    await runsCommand(['not a task id', '--workspace', root]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('VALIDATION_ERROR'));
  });

  it('produces machine-readable output identical to the read model', async () => {
    await runsCommand([TASK_ID, '--view', 'timeline', '--json', '--workspace', root]);
    const parsed = JSON.parse(output());
    expect(parsed.taskId).toBe(TASK_ID);
    expect(parsed.recordedStatus).toBe('COMPLETED');
  });
});

describe('CLI capabilities command (H.4)', () => {
  it('prints the parity table and the declared gaps', async () => {
    await capabilitiesCommand([]);
    const text = output();
    expect(text).toContain('task.execute');
    expect(text).toContain('Declared gaps');
    expect(text).toContain('partial');
  });

  it('emits the same catalog as JSON', async () => {
    await capabilitiesCommand(['--json']);
    const parsed = JSON.parse(output());
    expect(parsed.apiVersion).toBe('v1');
    expect(parsed.capabilities.some((c: any) => c.id === 'reliability.report')).toBe(true);
  });
});

describe('REPL command parsing (H.10)', () => {
  it('recognises the new inspection commands with and without a slash', () => {
    expect(parseCommand('/runs')).toEqual({ type: 'runs', args: '' });
    expect(parseCommand('runs task-1 verification')).toEqual({ type: 'runs', args: 'task-1 verification' });
    expect(parseCommand('/capabilities')).toEqual({ type: 'capabilities', args: '' });
  });

  it('still treats free text as a question and preserves /execute', () => {
    expect(parseCommand('what does this project do?').type).toBe('ask');
    expect(parseCommand('/execute Add a comment')).toEqual({
      type: 'execute', args: 'Add a comment', executionMode: 'STANDARD',
    });
  });
});
