import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

describe('CLI Commands', () => {
  const cliPath = path.join(__dirname, '..', 'src', 'cli', 'main.ts');
  const aiDir = path.join(process.cwd(), '.ai');

  // Clean up .ai directory before tests
  beforeAll(() => {
    if (fs.existsSync(aiDir)) {
      fs.rmSync(aiDir, { recursive: true, force: true });
    }
  });

  it('should show help message', () => {
    // Force cwd to be treated as workspace root, preventing global config interference
    const env = { ...process.env, AGENT_WORKSPACE_ROOT: process.cwd() };
    const output = execSync(`npx ts-node ${cliPath}`, { encoding: 'utf-8', env });
    expect(output).toContain('Usage:');
  });

  it('should initialize workspace with agent init', () => {
    // Force init to run on cwd (project root)
    const env = { ...process.env, AGENT_WORKSPACE_ROOT: process.cwd() };
    const output = execSync(`npx ts-node ${cliPath} init`, { encoding: 'utf-8', env });
    expect(output).toContain('Workspace initialized successfully.');
    expect(fs.existsSync(path.join(aiDir, 'config.json'))).toBe(true);
  });
});
