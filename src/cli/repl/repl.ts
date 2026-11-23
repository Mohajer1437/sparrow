import * as readline from 'readline';
import * as path from 'path';
import { AppFactory } from '../../core/app-factory';
import { Logger } from '../../contracts/logger';
import { resolveWorkspaceRoot } from '../workspace-resolver';
import { parseCommand } from './command-parser';
import { DEFAULT_PROMPT_DEBOUNCE_MS, PromptInputBuffer } from './prompt-input-buffer';
import { ReplSession } from './repl-session';
import { statusCommand } from '../commands/status';
import { workspaceCommand } from '../commands/workspace';
import { useCommand } from '../commands/use';
import { DEFAULT_MODEL } from '../shared/cli-role';
import { roleCommand } from '../commands/role';
import { modelCommand } from '../commands/model';
import { providerCommand } from '../commands/provider';
import { assignCommand } from '../commands/assign';
import { protectCommand } from '../commands/protect';
import { recoveryCommand } from '../commands/recovery';
import { versionCommand } from '../commands/version';
import { impactCommand } from '../commands/impact';
import { reliabilityCommand } from '../commands/reliability';
import { runsCommand } from '../commands/runs';
import { capabilitiesCommand } from '../commands/capabilities';
import { confirmCommand } from '../commands/confirm';
import { resolveAuthoritativeExecutionMode } from '../../domain/execution-mode';
import { createAppFactoryWithProviderSelection } from '../commands/provider-selection';

async function runCliCommand(fn: () => Promise<void>): Promise<boolean> {
  const originalExit = process.exit;
  let exitCode = 0;
  
  (process as any).exit = (code?: number) => {
    exitCode = code || 0;
  };

  try {
    await fn();
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    exitCode = 1;
  } finally {
    process.exit = originalExit;
  }
  
  return exitCode === 0;
}

function printHelp() {
  console.log('Commands:');
  console.log('  /help        Show help');
  console.log('  /status      Project status');
  console.log('  /version     Project dependencies and version intelligence');
  console.log('  /impact      Change impact analysis and regression plan');
  console.log('  /reliability Reliability metrics from recorded run evidence');
  console.log('  /runs        Recorded task runs; /runs <taskId> [view] inspects one run');
  console.log('  /capabilities Capability parity across CLI, REPL, API and UI');
  console.log('  /workspace   Current workspace');
  console.log('  /use <path>  Switch workspace');
  console.log('  /clear       Clear screen');
  console.log('  /history     Command history');
  console.log('  /exit        Exit');
  console.log('  /provider    Provider diagnostics (/provider health|test|list|use|add|current)');
  console.log('  /protect     Runtime protection settings');
  console.log('  /recovery    Recovery of interrupted executions');
  console.log('  /confirm     List pending confirmation requests');
  console.log('  /approve     Approve a confirmation request (/approve <id> [reason])');
  console.log('  /reject      Reject a confirmation request (/reject <id> [reason])');
  console.log('  /execute     Execute task via full pipeline (--read-only for READ_ONLY mode)');
  console.log('  /inspect     Run the pipeline in READ_ONLY mode; mutations are blocked');
  console.log('  /knowledge   Generate project knowledge (arch map + codebase map + knowledge base)');
  console.log('  <text>       Ask the agent');
}

async function executeInput(
  input: string,
  ctx: {
    factory: AppFactory;
    workspacePath: string;
    logger: Logger;
    replSession: ReplSession;
    commandHistory: string[];
  },
  setFactory: (f: AppFactory) => void,
  setWorkspacePath: (p: string) => void,
  setReplSession: (s: ReplSession) => void
): Promise<'continue' | 'exit'> {
  const trimmed = input.trim();
  if (!trimmed) return 'continue';

  ctx.commandHistory.push(trimmed);

  const parsed = parseCommand(input);

  try {
    switch (parsed.type) {
      case 'help':
        printHelp();
        break;
      case 'status':
        await runCliCommand(() => statusCommand());
        break;
      case 'version':
        await runCliCommand(() => versionCommand(parsed.args ? [parsed.args] : []));
        break;
      case 'impact':
        await runCliCommand(() => impactCommand(parsed.args ? parsed.args.split(' ').filter(Boolean) : []));
        break;
      case 'reliability':
        await runCliCommand(() => reliabilityCommand(parsed.args ? parsed.args.split(' ').filter(Boolean) : []));
        break;
      case 'runs':
        await runCliCommand(() => runsCommand(parsed.args ? parsed.args.split(' ').filter(Boolean) : []));
        break;
      case 'capabilities':
        await runCliCommand(() => capabilitiesCommand(parsed.args ? parsed.args.split(' ').filter(Boolean) : []));
        break;
      case 'workspace':
        await runCliCommand(() => workspaceCommand());
        break;
      case 'use':
        if (!parsed.args) {
          console.log('Usage: /use <path>');
        } else {
          const success = await runCliCommand(() => useCommand(parsed.args!));
          if (success) {
            const newPath = path.resolve(parsed.args);
            if (newPath !== ctx.workspacePath) {
              try {
                const { factory: newFactory } = await createAppFactoryWithProviderSelection(
                  newPath,
                  ctx.logger,
                );
                const newSession = new ReplSession(newFactory, newPath, ctx.replSession.model);
                await newSession.initialize();
                setFactory(newFactory);
                setWorkspacePath(newPath);
                setReplSession(newSession);
                console.log(`\n✓ REPL session re-initialized`);
                console.log(`New workspace: ${newPath}`);
                console.log('');
              } catch (initErr: any) {
                console.error(`\n✗ Failed to initialize new workspace: ${initErr.message}`);
                console.error('Reverting to previous workspace.');
                const { factory: revertFactory } = await createAppFactoryWithProviderSelection(
                  ctx.workspacePath,
                  ctx.logger,
                );
                const revertSession = new ReplSession(revertFactory, ctx.workspacePath, ctx.replSession.model);
                await revertSession.initialize();
                setFactory(revertFactory);
                setReplSession(revertSession);
              }
            }
          }
        }
        break;
      case 'clear':
        console.clear();
        break;
      case 'history':
        if (ctx.commandHistory.length === 0) {
          console.log('No history yet.');
        } else {
          ctx.commandHistory.forEach((cmd, i) => console.log(`${i + 1}: ${cmd}`));
        }
        break;
      case 'exit':
        return 'exit';
      case 'ask':
        if (parsed.args) {
          try {
            const response = await ctx.replSession.ask(parsed.args);
            console.log(response);
          } catch (err: any) {
            console.error(`\nError: ${err.message}`);
          }
        }
        break;
      case 'role':
        await runCliCommand(() => roleCommand(parsed.args ? parsed.args.split(' ') : []));
        break;
      case 'model':
        await runCliCommand(() => modelCommand(parsed.args ? parsed.args.split(' ') : []));
        break;
      case 'provider':
        await runCliCommand(() => providerCommand(parsed.args ? parsed.args.split(' ').filter(Boolean) : ['health']));
        break;
      case 'assign':
        await runCliCommand(() => assignCommand(parsed.args ? parsed.args.split(' ') : []));
        break;
      case 'protect':
        await runCliCommand(() => protectCommand(parsed.args ? parsed.args.split(' ') : []));
        break;
      case 'recovery':
        await runCliCommand(() => recoveryCommand(parsed.args ? parsed.args.split(' ') : []));
        break;
      case 'confirm':
        await runCliCommand(async () => { await confirmCommand(parsed.args ? parsed.args.split(' ').filter(Boolean) : []); });
        break;
      case 'approve':
        await runCliCommand(async () => { await confirmCommand(['approve', ...(parsed.args ? parsed.args.split(' ').filter(Boolean) : [])]); });
        break;
      case 'reject':
        await runCliCommand(async () => { await confirmCommand(['reject', ...(parsed.args ? parsed.args.split(' ').filter(Boolean) : [])]); });
        break;
      case 'provide-credential':
        await runCliCommand(async () => { await confirmCommand(['provide-credential', ...(parsed.args ? parsed.args.split(' ').filter(Boolean) : [])]); });
        break;
      case 'execute':
      case 'inspect': {
        const mode = resolveAuthoritativeExecutionMode({
          executionMode: parsed.executionMode,
          task: parsed.args,
        }).mode;
        if (parsed.args) {
          try {
            console.log('');
            console.log('=== PIPELINE EXECUTION ===');
            console.log('Task: ' + parsed.args);
            console.log('Execution Mode: ' + mode);
            console.log('');
            const result = await ctx.replSession.executeTask(parsed.args, mode);
            console.log('');
            console.log(result);
          } catch (err: any) {
            console.error('Pipeline error: ' + err.message);
          }
        } else {
          console.log(parsed.type === 'inspect'
            ? 'Usage: /inspect <inspection task>   (runs in READ_ONLY mode)'
            : 'Usage: /execute [--read-only] <task description>');
        }
        break;
      }
      case 'knowledge':
        try {
          console.log('');
          console.log('=== KNOWLEDGE PIPELINE ===');
          console.log('Generating project knowledge...');
          console.log('');
          const result = await ctx.replSession.runKnowledgePipeline(parsed.args || undefined);
          console.log('');
          console.log(result);
        } catch (err: any) {
          console.error('Knowledge pipeline error: ' + err.message);
        }
        break;
      case 'invalid':
        console.log(`Unknown command: ${trimmed}`);
        console.log('Type /help for commands.');
        break;
    }
  } catch (err: any) {
    console.error(`\nUnexpected error: ${err.message}`);
  }

  return 'continue';
}

export async function replCommand() {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: (msg: string) => console.warn(msg),
    error: () => {},
  };
  const workspacePath = await resolveWorkspaceRoot();

  let factory: AppFactory;
  try {
    ({ factory } = await createAppFactoryWithProviderSelection(workspacePath, logger));
  } catch (err: any) {
    console.error(`Provider selection failed: ${err.message}`);
    process.exit(1);
    return;
  }

  let replSession = new ReplSession(factory, workspacePath, DEFAULT_MODEL);
  
  try {
    await replSession.initialize();
  } catch (err: any) {
    console.error(`Failed to initialize REPL: ${err.message}`);
    process.exit(1);
  }

  let currentFactory = factory;
  let currentWorkspacePath = workspacePath;
  let currentReplSession = replSession;
  const commandHistory: string[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'agent> ',
    historySize: 100
  });

  // Read active model from coder assignment
  let activeModel = DEFAULT_MODEL;
  try {
    const assignmentService = factory.createRoleAssignmentService();
    await assignmentService.reload();
    const coderAssignment = await assignmentService.getAssignment('coder');
    if (coderAssignment) {
      activeModel = coderAssignment.modelId;
    }
  } catch {
    // fallback to DEFAULT_MODEL
  }

  console.log('----------------------------------');
  console.log('Sparrow CLI');
  console.log(`Workspace: ${workspacePath}`);
  console.log(`Model: ${activeModel} (coder role)`);
  console.log('Type /help for commands, /exit to quit.');
  console.log(`Multiline prompts: continue typing; execution starts after ${DEFAULT_PROMPT_DEBOUNCE_MS}ms idle.`);
  console.log('----------------------------------');

  const runExecute = async (input: string): Promise<'continue' | 'exit'> =>
    executeInput(
      input,
      {
        factory: currentFactory,
        workspacePath: currentWorkspacePath,
        logger,
        replSession: currentReplSession,
        commandHistory,
      },
      (f) => { currentFactory = f; },
      (p) => { currentWorkspacePath = p; },
      (s) => { currentReplSession = s; },
    );

  let closed = false;

  const promptInputBuffer = new PromptInputBuffer({
    debounceMs: DEFAULT_PROMPT_DEBOUNCE_MS,
    onCommit: async (prompt) => {
      if (closed) return;
      rl.pause();
      try {
        const result = await runExecute(prompt);
        if (result === 'exit') {
          closed = true;
          rl.close();
          return;
        }
      } finally {
        if (!closed) {
          rl.resume();
          rl.prompt();
        }
      }
    },
  });

  rl.prompt();

  rl.on('line', async (line) => {
    if (closed) return;

    const pushResult = promptInputBuffer.push(line);

    if (pushResult.kind === 'ignored') {
      rl.prompt();
      return;
    }

    if (pushResult.kind === 'buffered') {
      // Keep accepting lines; commit runs after debounce idle.
      rl.prompt();
      return;
    }

    // Immediate CLI command — any pending prompt buffer was cancelled in push.
    rl.pause();
    try {
      const result = await runExecute(pushResult.text);
      if (result === 'exit') {
        closed = true;
        rl.close();
        return;
      }
    } finally {
      if (!closed) {
        rl.resume();
        rl.prompt();
      }
    }
  });

  rl.on('close', () => {
    closed = true;
    promptInputBuffer.cancel();
    console.log('\nGoodbye!');
    if (process.env.NODE_ENV !== 'test') {
      process.exit(0);
    }
  });

  rl.on('SIGINT', () => {
    if (promptInputBuffer.hasPending()) {
      promptInputBuffer.cancel();
      console.log('\n(input cancelled)');
      rl.prompt();
      return;
    }
    console.log('\nGoodbye!');
    rl.close();
  });
}
