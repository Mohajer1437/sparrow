import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('CLI Status Command', () => {
  let tempDir: string;
  const cliPath = path.join(__dirname, '../../src/cli/main.ts');

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'status-test-'));
    // Force all agent commands to operate on tempDir
    const env = { ...process.env, AGENT_WORKSPACE_ROOT: tempDir };
    execSync(`npx ts-node ${cliPath} init`, { cwd: tempDir, stdio: 'pipe', env });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should display project status', async () => {
    // Create manifest
    await fs.mkdir(path.join(tempDir, '.ai', 'manifest'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, '.ai', 'manifest', 'manifest.json'),
      JSON.stringify({ name: 'MyProject', version: '2.0.0' })
    );

    const env = { ...process.env, AGENT_WORKSPACE_ROOT: tempDir };
    const output = execSync(`npx ts-node ${cliPath} status`, { cwd: tempDir, encoding: 'utf-8', env });
    expect(output).toContain('Project Status:');
    expect(output).toContain('Name: MyProject');
    expect(output).toContain('Version: 2.0.0');
    expect(output).toContain('Workspace: OK');
  });
});
