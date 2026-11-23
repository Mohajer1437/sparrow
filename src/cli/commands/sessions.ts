import { AppFactory } from '../../core/app-factory';
import { resolveWorkspaceRoot } from '../workspace-resolver';
import { isResumable } from '../../domain/workspace-session';

const logger = {
  debug: () => {},
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
};

export async function sessionsCommand(): Promise<void> {
  try {
    const workspacePath = await resolveWorkspaceRoot();
    const factory = new AppFactory(workspacePath, logger);
    const store = factory.createSessionStore();
    const sessions = await store.list(workspacePath);

    if (sessions.length === 0) {
      console.log('No sessions found for this workspace.');
      console.log(`Workspace: ${workspacePath}`);
      return;
    }

    console.log(`Sessions for workspace: ${workspacePath}`);
    console.log(`Found: ${sessions.length} session(s)\n`);

    for (const [i, s] of sessions.entries()) {
      const status = formatStatus(s.status);
      const progress = s.totalSteps > 0
        ? `${s.currentStep}/${s.totalSteps} steps`
        : 'No plan';
      const resumable = isResumable(s.status) ? ' [resumable]' : '';
      const age = formatAge(s.updatedAt);

      console.log(`${i + 1}. ${status} ${s.id}${resumable}`);
      console.log(`   Task: ${truncate(s.task, 80)}`);
      console.log(`   Progress: ${progress}`);
      console.log(`   Updated: ${age}`);
      if (s.plan) {
        console.log(`   Complexity: ${s.plan.complexity}`);
      }
      console.log('');
    }

    console.log('Tip: Use "agent resume <session-id>" to resume an interrupted session.');
  } catch (error: any) {
    console.error(`Failed to list sessions: ${error.message}`);
    process.exit(1);
  }
}

function formatStatus(status: string): string {
  const icons: Record<string, string> = {
    created: '○',
    planning: '◎',
    executing: '●',
    validating: '◐',
    completed: '✓',
    failed: '✗',
    paused: '‖',
  };
  return icons[status] ?? '?';
}

function formatAge(isoDate: string): string {
  try {
    const then = new Date(isoDate).getTime();
    const now = Date.now();
    const diffMs = now - then;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    return `${diffDays}d ago`;
  } catch {
    return isoDate;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.substring(0, max - 3) + '...';
}
