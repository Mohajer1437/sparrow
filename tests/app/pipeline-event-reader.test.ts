import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  PipelineEventReader,
  derivePhaseFromEvents,
} from '../../src/app/pipeline-event-reader';

async function workspaceWithLog(lines: ReadonlyArray<string>, fileName = 'pipeline-session-abc-x.log') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-log-'));
  const dir = path.join(root, '.ai', 'logs', 'pipeline');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), lines.join('\n') + '\n', 'utf8');
  return root;
}

function event(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    ts: '2026-08-28T10:00:00.000Z',
    sessionId: 'session-abc',
    phase: 'WORKFLOW',
    role: 'coder',
    model: 'qwen',
    message: 'msg',
    ...overrides,
  });
}

describe('pipeline event reader', () => {
  it('reads structured events for a session', async () => {
    const root = await workspaceWithLog([
      event({ phase: 'CONTEXT_STRATEGY', message: 'strategy built' }),
      event({ phase: 'TODO_PLAN', message: 'plan validated', todoCount: 2 }),
    ]);
    const events = await new PipelineEventReader(root).read({ sessionIds: ['session-abc'] });
    expect(events.map(item => item.phase)).toEqual(['CONTEXT_STRATEGY', 'TODO_PLAN']);
    expect(events[1].data).toEqual({ todoCount: 2 });
    expect(events.every(item => item.seq > 0)).toBe(true);
  });

  it('skips malformed lines instead of failing', async () => {
    const root = await workspaceWithLog([
      'not json at all',
      '{ broken',
      event({ message: 'ok' }),
    ]);
    const events = await new PipelineEventReader(root).read();
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe('ok');
  });

  it('orders out-of-order timestamps and keeps stable sequence numbers', async () => {
    const root = await workspaceWithLog([
      event({ ts: '2026-08-28T10:00:02.000Z', message: 'second' }),
      event({ ts: '2026-08-28T10:00:01.000Z', message: 'first' }),
    ]);
    const events = await new PipelineEventReader(root).read();
    expect(events.map(item => item.message)).toEqual(['first', 'second']);
    expect(events.map(item => item.seq)).toEqual([2, 1]);
  });

  it('supports incremental reads via sinceSeq', async () => {
    const root = await workspaceWithLog([
      event({ message: 'a' }),
      event({ message: 'b' }),
      event({ message: 'c' }),
    ]);
    const reader = new PipelineEventReader(root);
    const events = await reader.read({ sinceSeq: 2 });
    expect(events.map(item => item.message)).toEqual(['c']);
  });

  it('keeps duplicate events distinguishable rather than merging them', async () => {
    const root = await workspaceWithLog([event({ message: 'same' }), event({ message: 'same' })]);
    const events = await new PipelineEventReader(root).read();
    expect(events).toHaveLength(2);
    expect(new Set(events.map(item => item.seq)).size).toBe(2);
  });

  it('bounds the amount of log text it reads', async () => {
    const filler = Array.from({ length: 20000 }, (_, index) =>
      event({ message: `filler-${index}`, padding: 'x'.repeat(80) }));
    const root = await workspaceWithLog([...filler, event({ message: 'newest' })]);
    const started = Date.now();
    const events = await new PipelineEventReader(root).read({ limit: 50 });
    expect(Date.now() - started).toBeLessThan(4000);
    expect(events).toHaveLength(50);
    expect(events[events.length - 1].message).toBe('newest');
  });

  it('omits prompt bodies and redacts secrets from event data', async () => {
    const root = await workspaceWithLog([
      event({
        phase: 'PROVIDER',
        message: 'Prompt sent to LLM',
        systemPrompt: 'you are a planner',
        userPrompt: 'secret task text',
        adminToken: 'zzzz9999abcd',
      }),
    ]);
    const events = await new PipelineEventReader(root).read();
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('you are a planner');
    expect(serialized).not.toContain('secret task text');
    expect(serialized).not.toContain('zzzz9999abcd');
  });

  it('ignores events from other sessions', async () => {
    const root = await workspaceWithLog([
      event({ sessionId: 'session-abc', message: 'mine' }),
      event({ sessionId: 'session-other', message: 'theirs' }),
    ], 'pipeline-global-x.log');
    const events = await new PipelineEventReader(root).read({ sessionIds: ['session-abc'] });
    expect(events.map(item => item.message)).toEqual(['mine']);
  });

  it('returns nothing when no log directory exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-nolog-'));
    const reader = new PipelineEventReader(root);
    expect(await reader.read()).toEqual([]);
    expect(await reader.lastModified()).toBe(0);
  });

  it('derives the current phase from the newest recognizable event', () => {
    const base = { eventId: 'evt-1', taskId: 't-1', runId: 'r-1', sessionId: 's-1', seq: 1, ts: 'x', role: 'r', model: 'm', message: '' };
    expect(derivePhaseFromEvents([
      { ...base, phase: 'CONTEXT_STRATEGY' },
      { ...base, phase: 'STEP' },
      { ...base, phase: 'REPAIR_ATTEMPT' },
    ])).toBe('REPAIR');
    expect(derivePhaseFromEvents([{ ...base, phase: 'CONTEXT_GATHERING' }])).toBe('CONTEXT');
    // Generic phases recur throughout a run and must not drag the phase back.
    expect(derivePhaseFromEvents([
      { ...base, phase: 'VERIFICATION' },
      { ...base, phase: 'WORKFLOW' },
      { ...base, phase: 'AGENT' },
    ])).toBe('VERIFICATION');
    expect(derivePhaseFromEvents([{ ...base, phase: 'SOMETHING_ELSE' }])).toBeUndefined();
    expect(derivePhaseFromEvents([])).toBeUndefined();
  });
});
