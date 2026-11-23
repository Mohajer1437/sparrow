import { AppFactory } from '../../core/app-factory';
import { resolveWorkspaceRoot } from '../workspace-resolver';
import { isResumable } from '../../domain/workspace-session';

const logger = {
  debug: () => {},
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
};

export async function resumeCommand(sessionId: string): Promise<void> {
  if (!sessionId || sessionId.trim().length === 0) {
    console.error('Usage: agent resume <session-id>');
    process.exit(1);
  }

  try {
    const workspacePath = await resolveWorkspaceRoot();
    const factory = new AppFactory(workspacePath, logger);
    const manager = factory.createSessionManager(workspacePath);

    const session = await manager.getSession(sessionId);
    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      process.exit(1);
    }

    console.log('═'.repeat(70));
    console.log('🔄 SESSION RESUME');
    console.log('═'.repeat(70));
    console.log(`ID: ${session.id}`);
    console.log(`Task: ${session.task}`);
    console.log(`Status: ${session.status}`);
    console.log(`Created: ${session.createdAt}`);
    console.log(`Last updated: ${session.updatedAt}`);
    console.log('');

    if (session.plan) {
      console.log(`Plan: ${session.plan.objective} (${session.plan.complexity})`);
      console.log('');
      console.log('Steps:');
      for (let i = 0; i < session.plan.steps.length; i++) {
        const step = session.plan.steps[i];
        const icon = i < session.currentStep ? '✓' : (i === session.currentStep ? '→' : '○');
        console.log(`  ${icon} [${step.id}] ${step.description}`);
      }
      console.log('');
    }

    console.log(`Events (${session.events.length}):`);
    const recent = session.events.slice(-5);
    for (const event of recent) {
      console.log(`  [${event.type}] ${event.message}`);
    }
    if (session.events.length > 5) {
      console.log(`  ... and ${session.events.length - 5} earlier events`);
    }
    console.log('');

    if (!isResumable(session.status)) {
      console.log(`⚠️  Session is in terminal state (${session.status}).`);
      console.log(`   Cannot resume — start a new session instead.`);
      return;
    }

    const resumed = await manager.resumeSession(sessionId);
    if (!resumed) {
      console.error('Failed to resume session.');
      process.exit(1);
    }

    console.log('═'.repeat(70));
    console.log('✅ Session marked as executing.');
    console.log('');
    console.log('To continue execution, use:');
    console.log(`  agent ask "${session.task}"`);
    console.log('');
    console.log('(Full automatic resume will be available in R2.6)');
    console.log('═'.repeat(70));
  } catch (error: any) {
    console.error(`Failed to resume session: ${error.message}`);
    process.exit(1);
  }
}
