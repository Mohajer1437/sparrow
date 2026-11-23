import * as fs from 'fs/promises';

describe('Init CWD Fix', () => {
  it('init.ts uses process.cwd() not resolveWorkspaceRoot', async () => {
    const initSource = await fs.readFile(
      'src/cli/commands/init.ts',
      'utf-8'
    );
    
    // Must use process.cwd()
    expect(initSource).toMatch(/AppFactory\(process\.cwd\(\)/);
    
    // Must NOT use resolveWorkspaceRoot()
    expect(initSource).not.toMatch(/AppFactory\(await resolveWorkspaceRoot\(\)/);
    
    // Must have explanatory comment
    expect(initSource).toMatch(/init intentionally does NOT use resolveWorkspaceRoot/);
  });
});
