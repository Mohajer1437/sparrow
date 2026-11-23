import { AppFactory } from '../../core/app-factory';
import { resolveWorkspaceRoot } from '../workspace-resolver';

const logger = {
  debug: () => {},
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
};

export async function roleCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub || sub === 'list') {
    await listRoles();
    return;
  }

  if (sub === 'show') {
    const roleId = args[1];
    if (!roleId) {
      console.error('Usage: agent role show <roleId>');
      process.exit(2);
    }
    await showRole(roleId);
    return;
  }

  console.error(`Unknown role subcommand: ${sub}`);
  console.error('Usage: agent role [list | show <roleId>]');
  process.exit(2);
}

async function listRoles(): Promise<void> {
  try {
    const factory = new AppFactory(await resolveWorkspaceRoot(), logger);
    const registry = factory.createRoleRegistry();
    const roles = registry.list();

    console.log('═'.repeat(60));
    console.log(`ROLES (${roles.length})`);
    console.log('═'.repeat(60));
    console.log('');

    for (const role of roles) {
      console.log(`  ${role.id}`);
      console.log(`    Name:          ${role.name}`);
      console.log(`    Context Scope: ${role.contextScope}`);
      console.log(`    Tool Policy:   ${role.toolPolicy ?? 'default'}`);
      console.log('');
    }
    console.log('═'.repeat(60));
  } catch (error: any) {
    console.error(`Failed to list roles: ${error.message}`);
    process.exit(1);
  }
}

async function showRole(roleId: string): Promise<void> {
  try {
    const factory = new AppFactory(await resolveWorkspaceRoot(), logger);
    const registry = factory.createRoleRegistry();
    const role = registry.get(roleId);

    if (!role) {
      console.error(`Role not found: ${roleId}`);
      process.exit(1);
    }

    console.log('═'.repeat(60));
    console.log(`ROLE: ${role.id}`);
    console.log('═'.repeat(60));
    console.log('');
    console.log(`  Name:          ${role.name}`);
    console.log(`  Context Scope: ${role.contextScope}`);
    console.log(`  Tool Policy:   ${role.toolPolicy ?? 'default'}`);
    if (role.promptTemplate) {
      console.log(`  Prompt:        ${role.promptTemplate.substring(0, 80)}...`);
    }
    if (role.metadata) {
      console.log(`  Metadata:      ${JSON.stringify(role.metadata)}`);
    }
    console.log('');
    console.log('═'.repeat(60));
  } catch (error: any) {
    console.error(`Failed to show role: ${error.message}`);
    process.exit(1);
  }
}
