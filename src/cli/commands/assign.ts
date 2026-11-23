import { AppFactory } from '../../core/app-factory';
import { resolveWorkspaceRoot } from '../workspace-resolver';

const logger = {
  debug: () => {},
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
};

export async function assignCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub || sub === 'list') {
    await listAssignments();
    return;
  }

  if (sub === 'set') {
    const roleId = args[1];
    const modelId = args[2];
    if (!roleId || !modelId) {
      console.error('Usage: agent assign set <roleId> <modelId>');
      process.exit(2);
    }
    await setAssignment(roleId, modelId);
    return;
  }

  if (sub === 'reset') {
    await resetAssignments();
    return;
  }

  console.error(`Unknown assign subcommand: ${sub}`);
  console.error('Usage: agent assign [list | set <roleId> <modelId> | reset]');
  process.exit(2);
}

async function listAssignments(): Promise<void> {
  try {
    const factory = new AppFactory(await resolveWorkspaceRoot(), logger);
    const service = factory.createRoleAssignmentService();
    await service.reload();
    const assignments = await service.listAssignments();

    console.log('═'.repeat(60));
    console.log(`ROLE ASSIGNMENTS (${assignments.length})`);
    console.log('═'.repeat(60));
    console.log('');

    if (assignments.length === 0) {
      console.log('  No assignments configured.');
      console.log('  Run "agent assign reset" to restore defaults.');
    }

    for (const a of assignments) {
      console.log(`  ${a.roleId}`);
      console.log(`    Model:    ${a.modelId}`);
      console.log(`    Provider: ${a.providerId}`);
      console.log(`    Source:   ${a.source ?? 'unknown'}`);
      if (a.updatedAt) {
        console.log(`    Updated:  ${new Date(a.updatedAt).toLocaleString()}`);
      }
      console.log('');
    }
    console.log('═'.repeat(60));
  } catch (error: any) {
    console.error(`Failed to list assignments: ${error.message}`);
    process.exit(1);
  }
}

async function setAssignment(roleId: string, modelId: string): Promise<void> {
  try {
    const factory = new AppFactory(await resolveWorkspaceRoot(), logger);
    await factory.discoverOllamaModels();
    const registry = factory.createModelRegistry();

    if (registry.list().length === 0) {
      console.error('⚠  No models available. Make sure Ollama is running (ollama serve).');
      process.exit(1);
    }

    const service = factory.createRoleAssignmentService();
    await service.reload();
    const assignment = await service.updateAssignment(roleId, modelId);

    console.log('✓ Assignment updated');
    console.log('');
    console.log(`  Role:     ${assignment.roleId}`);
    console.log(`  Model:    ${assignment.modelId}`);
    console.log(`  Provider: ${assignment.providerId}`);
    console.log(`  Source:   ${assignment.source}`);
  } catch (error: any) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}

async function resetAssignments(): Promise<void> {
  try {
    const factory = new AppFactory(await resolveWorkspaceRoot(), logger);
    const service = factory.createRoleAssignmentService();
    await service.resetAssignments();

    console.log('✓ Assignments reset to defaults');
    console.log('');
    const assignments = await service.listAssignments();
    for (const a of assignments) {
      console.log(`  ${a.roleId} → ${a.modelId} (${a.providerId})`);
    }
  } catch (error: any) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}
