import { recoveryCommand } from '../../src/cli/commands/recovery';
import { AppFactory } from '../../src/core/app-factory';
import { resolveWorkspaceRoot } from '../../src/cli/workspace-resolver';

jest.mock('../../src/cli/workspace-resolver');
jest.mock('../../src/core/app-factory');

const mockResolve = resolveWorkspaceRoot as jest.MockedFunction<typeof resolveWorkspaceRoot>;
const MockAppFactory = AppFactory as jest.MockedClass<typeof AppFactory>;

describe('recovery command', () => {
  let mockTrigger: any;
  let mockStore: any;
  let mockRecoveryService: any;
  let mockExecutionService: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolve.mockResolvedValue('/fake/workspace');

    mockTrigger = {
      listRecoverable: jest.fn().mockResolvedValue([]),
      resume: jest.fn().mockResolvedValue({ success: true, message: 'Resume prepared' }),
    };
    mockStore = {
      list: jest.fn().mockResolvedValue([]),
      getRun: jest.fn().mockResolvedValue(null),
      get: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockRecoveryService = {
      findResumable: jest.fn().mockResolvedValue(null),
    };
    mockExecutionService = {
      execute: jest.fn().mockResolvedValue({
        runId: 'exec-1',
        taskId: 'task-1',
        snapshot: { status: 'COMPLETED', finalTruth: { status: 'COMPLETED' } },
        result: { success: true },
        outcomeSummary: { outcome: 'Task completed successfully.' },
      }),
    };

    MockAppFactory.mockImplementation(() => ({
      createRecoveryTrigger: () => mockTrigger,
      createTaskRunStore: () => mockStore,
      createRecoveryService: () => mockRecoveryService,
      createTaskExecutionService: () => mockExecutionService,
    }) as any);

    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('lists recoverable executions', async () => {
    mockTrigger.listRecoverable.mockResolvedValue([
      {
        executionId: 'exec-1',
        sessionId: 'sess-1',
        lastCompletedStep: 'step-2',
        remainingStepsCount: 3,
        checkpointTimestamp: '2026-01-01',
      },
    ]);

    await recoveryCommand(['list']);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('RECOVERABLE EXECUTIONS'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('exec-1'));
  });

  it('shows message when no executions found', async () => {
    mockTrigger.listRecoverable.mockResolvedValue([]);
    await recoveryCommand(['list']);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('No interrupted executions'));
  });

  it('resumes execution successfully', async () => {
    mockStore.getRun.mockResolvedValue({
      runId: 'exec-1',
      taskId: 'task-1',
      task: 'continue work',
      roleId: 'coder',
      status: 'INTERRUPTED',
      finalTruth: {
        status: 'INTERRUPTED',
        runId: 'exec-1',
        taskId: 'task-1',
        verificationStatus: 'NOT_RUN',
        mutationStatus: 'NONE',
        repositoryStatus: 'UNKNOWN',
        recoveryStatus: 'DETECTED',
        transitionHistory: [],
        lastHeartbeat: '2020-01-01T00:00:00.000Z',
        timestamp: '2020-01-01T00:00:00.000Z',
      },
    });
    mockRecoveryService.findResumable.mockResolvedValue({
      resumeFromStepIndex: 3,
      checkpoint: { checkpointId: 'cp-1' },
    });
    mockTrigger.resume.mockResolvedValue({ success: true, message: 'Resume prepared' });

    await recoveryCommand(['resume', 'exec-1']);
    expect(mockTrigger.resume).toHaveBeenCalledWith('exec-1');
    expect(mockExecutionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'exec-1',
        taskId: 'task-1',
        resumedFromRunId: 'exec-1',
        resumedFromCheckpointId: 'cp-1',
        resumeFromStepIndex: 3,
      }),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Resume finished'));
  });

  it('returns error for invalid execution', async () => {
    mockStore.getRun.mockResolvedValue(null);
    mockStore.get.mockResolvedValue(null);
    mockRecoveryService.findResumable.mockResolvedValue(null);

    await recoveryCommand(['resume', 'invalid']);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('No resumable execution'));
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 2 on missing resume argument', async () => {
    await recoveryCommand(['resume']);
    expect(processExitSpy).toHaveBeenCalledWith(2);
  });

  it('exits with code 2 on unknown subcommand', async () => {
    await recoveryCommand(['unknown']);
    expect(processExitSpy).toHaveBeenCalledWith(2);
  });
});
