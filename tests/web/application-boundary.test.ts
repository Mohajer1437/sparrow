import * as fs from 'fs';
import * as path from 'path';
import { AppFactory } from '../../src/core/app-factory';
import { Logger } from '../../src/contracts/logger';
import { TaskExecutionService } from '../../src/app/task-execution-service';
import { TaskQueryService } from '../../src/app/task-query-service';
import { ReplSession } from '../../src/cli/repl/repl-session';
import { parseCommand } from '../../src/cli/repl/command-parser';

const SRC = path.join(__dirname, '..', '..', 'src');
const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function readSourceFiles(dir: string): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...readSourceFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push({ file: path.relative(SRC, full).replace(/\\/g, '/'), text: fs.readFileSync(full, 'utf8') });
    }
  }
  return out;
}

describe('application boundary', () => {
  it('keeps the application layer independent of the web/cli adapters', () => {
    for (const { file, text } of readSourceFiles(path.join(SRC, 'app'))) {
      expect(text).not.toMatch(/from '\.\.\/web/);
      expect(text).not.toMatch(/from '\.\.\/cli/);
      expect(file).toBeTruthy();
    }
  });

  it('keeps the web adapter free of pipeline orchestration', () => {
    for (const { file, text } of readSourceFiles(path.join(SRC, 'web'))) {
      expect(text).not.toMatch(/from '\.\.\/core\//);
      expect(text).not.toMatch(/AgentOrchestrator|WorkflowOrchestrator|TaskPlanner|VvAgent/);
      expect(file).toBeTruthy();
    }
  });

  it('wires web queries and task execution from the same factory and workspace root', () => {
    const factory = new AppFactory(process.cwd(), silentLogger);
    expect(factory.createTaskQueryService()).toBeInstanceOf(TaskQueryService);
    expect(factory.createTaskRunStore()).toBeDefined();
    expect(factory.createTaskQueryService().workspace()).toEqual({
      workspaceRoot: factory.workspaceRoot,
      readOnly: true,
    });
  });

  it('routes REPL /execute through the shared task execution service', async () => {
    const service = {
      execute: jest.fn().mockResolvedValue({
        taskId: 'task-x',
        snapshot: { taskId: 'task-x' },
        result: { success: true, workflowResult: { sessionId: 'session-1' } },
      }),
    };
    const factory = {
      discoverOllamaModels: jest.fn().mockResolvedValue(0),
      createTaskExecutionService: jest.fn().mockReturnValue(service),
      createAgentOrchestrator: jest.fn(() => {
        throw new Error('REPL must not orchestrate the pipeline directly');
      }),
    } as unknown as AppFactory;

    const session = new ReplSession(factory, 'E:/new-test-2', 'qwen');
    const output = await session.executeTask('Inspect app/page.tsx');

    expect(service.execute).toHaveBeenCalledWith({
      roleId: 'coder', task: 'Inspect app/page.tsx', executionMode: 'STANDARD',
    });
    expect(output).toContain('Task id: task-x');
    expect(output).toContain('PIPELINE COMPLETED SUCCESSFULLY');
  });

  it('preserves /execute command parsing for CLI and REPL', () => {
    expect(parseCommand('/execute add a comment')).toMatchObject({
      type: 'execute',
      args: 'add a comment',
    });
    expect(parseCommand('/help')).toMatchObject({ type: 'help' });
  });

  it('keeps the CLI entry point and its commands intact', () => {
    const main = fs.readFileSync(path.join(SRC, 'cli', 'main.ts'), 'utf8');
    for (const command of ['repl', 'serve', 'status', 'ask', 'recovery']) {
      expect(main).toContain(`case '${command}':`);
    }
  });

  it('exposes a task execution service that only depends on contracts', () => {
    const source = fs.readFileSync(path.join(SRC, 'app', 'task-execution-service.ts'), 'utf8');
    expect(source).toContain("from '../contracts/agent-orchestrator'");
    expect(TaskExecutionService).toBeDefined();
  });
});
