import { protectCommand } from '../../src/cli/commands/protect';
import { AppFactory } from '../../src/core/app-factory';
import { resolveWorkspaceRoot } from '../../src/cli/workspace-resolver';

jest.mock('../../src/cli/workspace-resolver');
jest.mock('../../src/core/app-factory');

const mockResolve = resolveWorkspaceRoot as jest.MockedFunction<typeof resolveWorkspaceRoot>;
const MockAppFactory = AppFactory as jest.MockedClass<typeof AppFactory>;

describe('protect command', () => {
  let mockGovernor: any;
  let mockProvider: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolve.mockResolvedValue('/fake/workspace');

    mockGovernor = {
      getPolicy: jest.fn().mockReturnValue({
        cpuThreshold: 90, memoryThreshold: 85, temperatureThreshold: 80,
        pauseDurationMs: 30000, healthCheckIntervalMs: 5000, autoResume: true,
      }),
      evaluate: jest.fn().mockReturnValue({ action: 'continue', reason: 'All metrics within safe limits' }),
      updatePolicy: jest.fn().mockReturnValue({
        cpuThreshold: 80, memoryThreshold: 85, temperatureThreshold: 80,
        pauseDurationMs: 30000, healthCheckIntervalMs: 5000, autoResume: true,
      }),
      resetPolicy: jest.fn().mockReturnValue({
        cpuThreshold: 90, memoryThreshold: 85, temperatureThreshold: 80,
        pauseDurationMs: 30000, healthCheckIntervalMs: 5000, autoResume: true,
      }),
    };

    mockProvider = {
      collect: jest.fn().mockResolvedValue({
        cpuUtilization: { value: 30, unit: '%', timestamp: new Date().toISOString() },
        memoryUtilization: { value: 50, unit: '%', timestamp: new Date().toISOString() },
        cpuTemperature: { value: null, unit: '°C', timestamp: new Date().toISOString() },
        gpuTemperature: { value: null, unit: '°C', timestamp: new Date().toISOString() },
        batteryLevel: { value: null, unit: '%', timestamp: new Date().toISOString() },
        collectedAt: new Date().toISOString(),
      }),
    };

    MockAppFactory.mockImplementation(() => ({
      createExecutionGovernor: () => mockGovernor,
      createRuntimeHealthProvider: () => mockProvider,
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

  it('shows protection status', async () => {
    await protectCommand(['status']);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('RUNTIME PROTECTION'));
  });

  it('sets protection value', async () => {
    await protectCommand(['set', 'cpuThreshold', '80']);
    expect(mockGovernor.updatePolicy).toHaveBeenCalledWith({ cpuThreshold: 80 });
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Protection updated'));
  });

  it('resets protection to defaults', async () => {
    await protectCommand(['reset']);
    expect(mockGovernor.resetPolicy).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('reset to defaults'));
  });

  it('exits with code 2 on unknown subcommand', async () => {
    await protectCommand(['unknown']);
    expect(processExitSpy).toHaveBeenCalledWith(2);
  });

  it('exits with code 2 on missing set arguments', async () => {
    await protectCommand(['set', 'cpuThreshold']);
    expect(processExitSpy).toHaveBeenCalledWith(2);
  });
});
