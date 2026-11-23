import { DefaultConfigurationMigrator } from '../../../src/core/configuration/default-configuration-migrator';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';
import { MigrationStep } from '../../../src/domain/configuration-migration';

describe('DefaultConfigurationMigrator', () => {
  let mockRuntime: jest.Mocked<RuntimeRepository>;
  let migrator: DefaultConfigurationMigrator;

  beforeEach(() => {
    mockRuntime = {
      readFile: jest.fn(),
      writeFile: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
      listFiles: jest.fn().mockResolvedValue([]),
      mkdir: jest.fn().mockResolvedValue(undefined),
      appendFeedbackCandidates: jest.fn(),
    } as any;
    migrator = new DefaultConfigurationMigrator(mockRuntime);
  });

  it('returns success when already current version', async () => {
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      version: '0.1.0',
      schemaVersion: 1,
      paths: { manifestDir: 'manifest', rulesDir: 'rules', knowledgeDir: 'knowledge', memoryDir: 'memory' },
    }));

    const result = await migrator.migrate();

    expect(result.success).toBe(true);
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(1);
    expect(result.stepsApplied).toHaveLength(0);
    expect(mockRuntime.writeFile).not.toHaveBeenCalled();
  });

  it('handles legacy config without schemaVersion (assumes v1)', async () => {
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      version: '0.1.0',
      paths: { manifestDir: 'manifest', rulesDir: 'rules', knowledgeDir: 'knowledge', memoryDir: 'memory' },
    }));

    const result = await migrator.migrate();

    expect(result.success).toBe(true);
    expect(result.fromVersion).toBe(1);
    expect(result.stepsApplied).toHaveLength(0);
  });

  it('creates backup before migration', async () => {
    const oldConfig = JSON.stringify({ version: '0.1.0', schemaVersion: 0 });
    mockRuntime.readFile.mockResolvedValue(oldConfig);

    const result = await migrator.migrate();

    expect(result.success).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(result.backupPath).toContain('backups/config-v0-v1-');
    expect(mockRuntime.mkdir).toHaveBeenCalledWith('backups');
    expect(mockRuntime.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('backups/config-v0-v1-'),
      oldConfig
    );
  });

  it('migrates v0 to v1 successfully', async () => {
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      version: '0.1.0',
      schemaVersion: 0,
      paths: { manifestDir: 'manifest', rulesDir: 'rules', knowledgeDir: 'knowledge', memoryDir: 'memory' },
    }));

    const result = await migrator.migrate();

    expect(result.success).toBe(true);
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(1);
    expect(result.stepsApplied).toEqual([1]);

    // Verify written config has schemaVersion: 1
    const writeCall = mockRuntime.writeFile.mock.calls.find(c => c[0] === 'config.json');
    expect(writeCall).toBeDefined();
    const writtenConfig = JSON.parse(writeCall![1] as string);
    expect(writtenConfig.schemaVersion).toBe(1);
  });

  it('restores backup on migration failure', async () => {
    const oldConfig = JSON.stringify({ version: '0.1.0', schemaVersion: 0 });
    mockRuntime.readFile.mockResolvedValue(oldConfig);

    // backup write succeeds, config write fails, restore succeeds
    mockRuntime.writeFile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Disk full'))
      .mockResolvedValueOnce(undefined);

    const result = await migrator.migrate();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Migration failed');
    expect(result.error).toContain('Disk full');
    expect(result.error).toContain('Backup restored');

    // Verify restore was attempted with original content
    const restoreCall = mockRuntime.writeFile.mock.calls.find(
      c => c[0] === 'config.json' && c[1] === oldConfig
    );
    expect(restoreCall).toBeDefined();
  });

  it('rejects newer schema version', async () => {
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      version: '0.1.0',
      schemaVersion: 99,
    }));

    const result = await migrator.migrate();

    expect(result.success).toBe(false);
    expect(result.error).toContain('newer Sparrow version');
    expect(result.error).toContain('Please upgrade');
    expect(mockRuntime.writeFile).not.toHaveBeenCalled();
  });

  it('returns error when no config file exists', async () => {
    mockRuntime.exists.mockResolvedValue(false);

    const result = await migrator.migrate();

    expect(result.success).toBe(false);
    expect(result.error).toContain('No configuration file found');
  });

  it('fails when no migration path exists', async () => {
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      version: '0.1.0',
      schemaVersion: -1,
    }));

    const result = await migrator.migrate();

    expect(result.success).toBe(false);
    expect(result.error).toContain('No migration found');
  });

  it('executes migration chain with custom steps', async () => {
    const customMigrations: ReadonlyArray<MigrationStep> = Object.freeze([
      Object.freeze({
        fromVersion: 0,
        toVersion: 1,
        description: 'v0 → v1',
        transform: (config: Readonly<Record<string, unknown>>) => ({ ...config, schemaVersion: 1, migrated: true }),
      }),
    ]);

    const customMigrator = new DefaultConfigurationMigrator(mockRuntime, customMigrations);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({ version: '0.1.0', schemaVersion: 0 }));

    const result = await customMigrator.migrate();

    expect(result.success).toBe(true);
    expect(result.stepsApplied).toEqual([1]);

    const writeCall = mockRuntime.writeFile.mock.calls.find(c => c[0] === 'config.json');
    const written = JSON.parse(writeCall![1] as string);
    expect(written.schemaVersion).toBe(1);
    expect(written.migrated).toBe(true);
  });
});
