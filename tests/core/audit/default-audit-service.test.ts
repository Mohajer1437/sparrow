import { DefaultAuditService } from '../../../src/core/audit/default-audit-service';
import { ExecutionAuditRepository } from '../../../src/contracts/audit-repository';

describe('DefaultAuditService', () => {
  let mockRepo: jest.Mocked<ExecutionAuditRepository>;
  let service: DefaultAuditService;

  beforeEach(() => {
    mockRepo = {
      append: jest.fn().mockResolvedValue(undefined),
      listByExecution: jest.fn().mockResolvedValue([]),
      listBySession: jest.fn().mockResolvedValue([]),
      getLatest: jest.fn().mockResolvedValue(null),
    };
    service = new DefaultAuditService(mockRepo);
  });

  it('records event with generated auditId and timestamp', async () => {
    await service.record({
      executionId: 'exec-1', sessionId: 'sess-1',
      eventType: 'step_started' as const, stepId: 'step-1', status: 'started',
    });
    expect(mockRepo.append).toHaveBeenCalledTimes(1);
    const saved = mockRepo.append.mock.calls[0][0];
    expect(saved.auditId).toBeDefined();
    expect(saved.timestamp).toBeDefined();
    expect(saved.executionId).toBe('exec-1');
  });

  it('retrieves history by execution', async () => {
    mockRepo.listByExecution.mockResolvedValue([
      Object.freeze({ auditId: 'a1', executionId: 'exec-1', sessionId: 'sess-1', eventType: 'step_started' as const, timestamp: '', status: 'started' }),
    ]);
    const history = await service.getHistory('exec-1');
    expect(history).toHaveLength(1);
  });

  it('retrieves history by session', async () => {
    mockRepo.listBySession.mockResolvedValue([
      Object.freeze({ auditId: 'a1', executionId: 'exec-1', sessionId: 'sess-1', eventType: 'step_started' as const, timestamp: '', status: 'started' }),
    ]);
    const history = await service.getSessionHistory('sess-1');
    expect(history).toHaveLength(1);
  });

  it('audit failure does not throw (isolation)', async () => {
    mockRepo.append.mockRejectedValue(new Error('Write failed'));
    await expect(service.record({
      executionId: 'exec-1', sessionId: 'sess-1',
      eventType: 'step_started' as const, status: 'started',
    })).resolves.toBeUndefined();
  });

  it('produces immutable events', async () => {
    await service.record({
      executionId: 'exec-1', sessionId: 'sess-1',
      eventType: 'step_started' as const, status: 'started',
    });
    const saved = mockRepo.append.mock.calls[0][0];
    expect(Object.isFrozen(saved)).toBe(true);
  });
});
