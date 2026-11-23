import { configCommand } from '../../src/cli/commands/config';
import { AppFactory } from '../../src/core/app-factory';
import { resolveWorkspaceRoot } from '../../src/cli/workspace-resolver';

jest.mock('../../src/cli/workspace-resolver');
jest.mock('../../src/core/app-factory');

const mockResolve = resolveWorkspaceRoot as jest.MockedFunction<typeof resolveWorkspaceRoot>;
const MockAppFactory = AppFactory as jest.MockedClass<typeof AppFactory>;

describe('config command', () => {
  let mockMigrator: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolve.mockResolvedValue('/fake/workspace');

    mockMigrator = {
      migrate: jest.fn(),
    };

    MockAppFactory.mockImplementation(() => ({
      createConfigurationMigrator: () => mockMigrator,
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

  it('migrate succeeds with steps applied', async () => {
    mockMigrator.migrate.mockResolvedValue({
      success: true,
      fromVersion: 0,
      toVersion: 1,
      backupPath: 'backups/config-v0-v1-2026.json',
      stepsApplied: [1],
    });

    await configCommand(['migrate']);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('migrated successfully'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('From:   v0'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('To:     v1'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Backup:'));
  });

  it('migrate reports already up to date', async () => {
    mockMigrator.migrate.mockResolvedValue({
      success: true,
      fromVersion: 1,
      toVersion: 1,
      stepsApplied: [],
    });

    await configCommand(['migrate']);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('already up to date'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Schema version: 1'));
  });

  it('migrate fails with error', async () => {
    mockMigrator.migrate.mockResolvedValue({
      success: false,
      fromVersion: 0,
      toVersion: 1,
      stepsApplied: [],
      error: 'Migration failed: Disk full',
    });

    await configCommand(['migrate']);

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Migration failed'));
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 2 on unknown subcommand', async () => {
    await configCommand(['unknown']);

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown config subcommand'));
    expect(processExitSpy).toHaveBeenCalledWith(2);
  });

  it('exits with code 2 on missing subcommand', async () => {
    await configCommand([]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    expect(processExitSpy).toHaveBeenCalledWith(2);
  });
});
