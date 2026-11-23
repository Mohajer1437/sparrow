import { FileAuditRepository } from '../../../src/core/audit/file-audit-repository';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';
import { ExecutionAuditEvent } from '../../../src/domain/execution-audit';

function createEvent(overrides: Partial<ExecutionAuditEvent> = {}): ExecutionAuditEvent {
  return Object.freeze({
    auditId: 'audit-1', executionId: 'exec-1', sessionId: 'sess-1',
    eventType: 'step_started' as const, stepId: 'step-1',
    timestamp: new Date().toISOString(), status: 'started',
    ...overrides,
  });
}

describe('FileAuditRepository', () => {
  let mockRuntime: jest.Mocked<RuntimeRepository>;
  let repo: FileAuditRepository;

  beforeEach(() => {
    mockRuntime = {
      readFile: jest.fn(),
      writeFile: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      mkdir: jest.fn().mockResolvedValue(undefined),
      appendFeedbackCandidates: jest.fn(),
    } as any;
    repo = new FileAuditRepository(mockRuntime);
  });

  it('appends audit event atomically', async () => {
    await repo.append(createEvent());
    expect(mockRuntime.mkdir).toHaveBeenCalledWith('audit');
    expect(mockRuntime.writeFile).toHaveBeenCalledWith('audit/exec-1.json', expect.any(String));
  });

  it('appends to existing events', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify([createEvent({ auditId: 'audit-0' })]));
    await repo.append(createEvent({ auditId: 'audit-1' }));
    const written = JSON.parse(mockRuntime.writeFile.mock.calls[0][1]);
    expect(written).toHaveLength(2);
  });

  it('lists events by execution', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify([
      createEvent({ auditId: 'a1', eventType: 'step_started' as const }),
      createEvent({ auditId: 'a2', eventType: 'step_completed' as const }),
    ]));
    const events = await repo.listByExecution('exec-1');
    expect(events).toHaveLength(2);
  });

  it('lists events by session', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.listFiles.mockResolvedValue(['exec-1.json', 'exec-2.json']);
    mockRuntime.readFile
      .mockResolvedValueOnce(JSON.stringify([createEvent({ sessionId: 'sess-1' })]))
      .mockResolvedValueOnce(JSON.stringify([createEvent({ sessionId: 'sess-2' })]));
    const events = await repo.listBySession('sess-1');
    expect(events).toHaveLength(1);
  });

  it('gets latest event', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify([
      createEvent({ auditId: 'a1', eventType: 'step_started' as const }),
      createEvent({ auditId: 'a2', eventType: 'step_completed' as const }),
    ]));
    const latest = await repo.getLatest('exec-1');
    expect(latest!.eventType).toBe('step_completed');
  });

  it('handles corrupted audit file', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue('invalid {{{');
    expect(await repo.listByExecution('exec-1')).toHaveLength(0);
  });

  it('handles missing audit file', async () => {
    mockRuntime.exists.mockResolvedValue(false);
    expect(await repo.listByExecution('exec-1')).toHaveLength(0);
  });

  it('returns null for latest when no events', async () => {
    mockRuntime.exists.mockResolvedValue(false);
    expect(await repo.getLatest('exec-1')).toBeNull();
  });

  it('returns frozen events', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify([createEvent()]));
    const events = await repo.listByExecution('exec-1');
    expect(Object.isFrozen(events)).toBe(true);
  });
});
