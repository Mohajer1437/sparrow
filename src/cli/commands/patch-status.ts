import { AppFactory } from '../../core/app-factory';
import { resolveWorkspaceRoot } from '../workspace-resolver';

const logger = {
  debug: () => {},
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
};

export async function patchStatusCommand(sessionId: string): Promise<void> {
  if (!sessionId || sessionId.trim().length === 0) {
    console.error('Usage: agent patch-status <session-id>');
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
    console.log('PATCH STATUS');
    console.log('═'.repeat(70));
    console.log('');
    console.log(`Session: ${session.id}`);
    console.log(`Task:    ${session.task}`);
    console.log(`Status:  ${session.status}`);
    console.log('');

    // Find patch-related events
    const patchEvents = session.events.filter(e =>
      ['BACKUP_CREATED', 'PATCH_APPLIED', 'PATCH_FAILED',
       'VALIDATION_STARTED', 'VALIDATION_PASSED', 'VALIDATION_FAILED',
       'TESTS_STARTED', 'TESTS_PASSED', 'TESTS_FAILED',
       'ROLLBACK_STARTED', 'ROLLBACK_COMPLETED'].includes(e.type)
    );

    if (patchEvents.length === 0) {
      console.log('No patch operations recorded for this session.');
      return;
    }

    // Group by phase
    const backups = patchEvents.filter(e => e.type === 'BACKUP_CREATED');
    const applied = patchEvents.filter(e => e.type === 'PATCH_APPLIED');
    const validation = patchEvents.filter(e =>
      e.type.startsWith('VALIDATION_')
    );
    const tests = patchEvents.filter(e => e.type.startsWith('TESTS_'));
    const rollbacks = patchEvents.filter(e => e.type.startsWith('ROLLBACK_'));

    console.log('Phase Summary:');
    console.log('');

    if (backups.length > 0) {
      console.log(`  Backup:     ${backups.length > 0 ? '✓ created' : '○ not created'}`);
    }

    if (applied.length > 0) {
      const lastApplied = applied[applied.length - 1];
      const changedFiles = (lastApplied.metadata as any)?.changedFiles || [];
      console.log(`  Patch:      ✓ applied (${changedFiles.length} files)`);
      if (changedFiles.length > 0) {
        console.log('');
        console.log('  Changed files:');
        for (const f of changedFiles) {
          console.log(`    - ${f}`);
        }
      }
    }

    const patchFailed = patchEvents.some(e => e.type === 'PATCH_FAILED');
    if (patchFailed) {
      console.log(`  Patch:      ✗ failed`);
    }

    if (validation.length > 0) {
      const passed = validation.some(e => e.type === 'VALIDATION_PASSED');
      const failed = validation.some(e => e.type === 'VALIDATION_FAILED');
      console.log(`  Validation: ${passed ? '✓ passed' : (failed ? '✗ failed' : '○ pending')}`);
    }

    if (tests.length > 0) {
      const passed = tests.some(e => e.type === 'TESTS_PASSED');
      const failed = tests.some(e => e.type === 'TESTS_FAILED');
      console.log(`  Tests:      ${passed ? '✓ passed' : (failed ? '✗ failed' : '○ pending')}`);
    }

    if (rollbacks.length > 0) {
      const completed = rollbacks.some(e => e.type === 'ROLLBACK_COMPLETED');
      console.log(`  Rollback:   ${completed ? '✓ completed' : '○ in progress'}`);
    }

    console.log('');
    console.log('Event timeline:');
    for (const e of patchEvents) {
      const time = new Date(e.timestamp).toLocaleTimeString();
      console.log(`  [${time}] ${e.type}: ${e.message}`);
    }

    console.log('');
    console.log('═'.repeat(70));
  } catch (error: any) {
    console.error(`Failed to show patch status: ${error.message}`);
    process.exit(1);
  }
}
