import { impactCommand } from '../../../src/cli/commands/impact';

describe('CLI impact command', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('prints usage when no files are passed', async () => {
    await impactCommand([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: impact <file1> [file2...]'));
  });

  it('runs impact inspection for existing files without throwing', async () => {
    await impactCommand(['src/core/app-factory.ts']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Impact & Regression Intelligence:'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Regression Plan:'));
  });
});
