#!/usr/bin/env node
import { initCommand } from './commands/init';
import { doctorCommand } from './commands/doctor';
import { statusCommand } from './commands/status';
import { askCommand } from './commands/ask';
import { useCommand } from './commands/use';
import { workspaceCommand } from './commands/workspace';
import { sessionsCommand } from './commands/sessions';
import { resumeCommand } from './commands/resume';
import { patchStatusCommand } from './commands/patch-status';
import { gitStatusCommand } from './commands/git-status';
import { commitsCommand } from './commands/commits';
import { rollbackCommand } from './commands/rollback';
import { replCommand } from './repl/repl';
import { roleCommand } from './commands/role';
import { modelCommand } from './commands/model';
import { providerCommand } from './commands/provider';
import { assignCommand } from './commands/assign';
import { configCommand } from './commands/config';
import { protectCommand } from './commands/protect';
import { recoveryCommand } from './commands/recovery';
import { serveCommand } from './commands/serve';
import { versionCommand } from './commands/version';
import { impactCommand } from './commands/impact';
import { reliabilityCommand } from './commands/reliability';
import { runsCommand } from './commands/runs';
import { capabilitiesCommand } from './commands/capabilities';
import { confirmCommand } from './commands/confirm';
import { indexStructuralCommand } from './commands/index-structural';

const args = process.argv.slice(2);
const command = args[0];

function showHelp() {
  console.log('Sparrow CLI');
  console.log('');
  console.log('Usage: agent <command> [args]');
  console.log('');
  console.log('Workspace:');
  console.log('  init                  Initialize workspace');
  console.log('  doctor                Check workspace health');
  console.log('  status                Show project status');
  console.log('  version               Show project dependencies and version intelligence');
  console.log('  impact <files...>     Show change impact analysis and regression plan');
  console.log('  reliability [opts]    Show reliability metrics derived from recorded run evidence');
  console.log('  runs [taskId] [opts]  List recorded task runs or inspect one run');
  console.log('  capabilities          Show capability parity across CLI, REPL, API and UI');
  console.log('  index-structural      Build deterministic structural graph (.ai/knowledge/structural-graph.json)');
  console.log('  workspace             Show current workspace');
  console.log('  use <path>            Switch workspace');
  console.log('');
  console.log('Sessions:');
  console.log('  sessions              List workspace sessions');
  console.log('  resume <id>           Resume an interrupted session');
  console.log('  patch-status <id>     Show patch status for a session');
  console.log('');
  console.log('Git:');
  console.log('  git-status            Show git repository status');
  console.log('  commits [count]       List recent commits');
  console.log('  rollback <hash>       Safely rollback to a commit');
  console.log('');
  console.log('Agent:');
  console.log('  ask <message>         Ask the agent');
  console.log('  repl                  Start interactive REPL');
  console.log('  serve [--port N]      Start read-only observability web UI');
  console.log('');
  console.log('Management:');
  console.log('  role [list|show <id>]       Manage roles');
  console.log('  model [list|show <id>]      Manage models');
  console.log('  provider health             Probe configured LLM provider (no completion)');
  console.log('  provider test               Minimal completion smoke test via LlmProvider');
  console.log('  provider list               List saved provider profiles');
  console.log('  provider current            Show active provider profile');
  console.log('  provider use <name>         Select active provider profile');
  console.log('  provider add                Add a provider profile (interactive)');
  console.log('  assign [list|set|reset]     Manage role assignments');
  console.log('  config [migrate|show|set]    Configuration (qualityProfile, schema migrate)');
  console.log('  protect [status|set|reset]  Runtime protection settings');
  console.log('  recovery [list|resume <id>] Recovery of interrupted executions');
  console.log('  confirm [list|get|approve|reject] Human confirmation requests');
}

async function main() {
  if (!command) {
    showHelp();
    return;
  }

  switch (command) {
    case 'init':
      await initCommand();
      break;
    case 'doctor':
      await doctorCommand();
      break;
    case 'status':
      await statusCommand();
      break;
    case 'version':
      await versionCommand(args.slice(1));
      break;
    case 'impact':
      await impactCommand(args.slice(1));
      break;
    case 'reliability':
      await reliabilityCommand(args.slice(1));
      break;
    case 'runs':
      await runsCommand(args.slice(1));
      break;
    case 'capabilities':
      await capabilitiesCommand(args.slice(1));
      break;
    case 'index-structural':
      await indexStructuralCommand(args.slice(1));
      break;
    case 'ask':
      const message = args.slice(1).join(' ');
      await askCommand(message);
      break;
    case 'use':
      const targetPath = args.slice(1).join(' ');
      await useCommand(targetPath);
      break;
    case 'workspace':
      await workspaceCommand();
      break;
    case 'sessions':
      await sessionsCommand();
      break;
    case 'resume':
      await resumeCommand(args[1]);
      break;
    case 'patch-status':
      await patchStatusCommand(args[1]);
      break;
    case 'git-status':
      await gitStatusCommand();
      break;
    case 'commits':
      await commitsCommand(args[1]);
      break;
    case 'rollback':
      await rollbackCommand(args[1]);
      break;
    case 'repl':
      await replCommand();
      break;
    case 'serve':
      await serveCommand(args.slice(1));
      break;
    case 'role':
      await roleCommand(args.slice(1));
      break;
    case 'model':
      await modelCommand(args.slice(1));
      break;
    case 'provider':
      await providerCommand(args.slice(1));
      break;
    case 'assign':
      await assignCommand(args.slice(1));
      break;
    case 'config':
      await configCommand(args.slice(1));
      break;
    case 'protect':
      await protectCommand(args.slice(1));
      break;
    case 'recovery':
      await recoveryCommand(args.slice(1));
      break;
    case 'confirm':
      await confirmCommand(args.slice(1));
      break;
    case 'approve':
      await confirmCommand(['approve', ...args.slice(1)]);
      break;
    case 'reject':
      await confirmCommand(['reject', ...args.slice(1)]);
      break;
    case 'provide-credential':
      await confirmCommand(['provide-credential', ...args.slice(1)]);
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
