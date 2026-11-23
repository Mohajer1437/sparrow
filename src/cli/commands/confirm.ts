import { AppFactory } from '../../core/app-factory';
import { resolveWorkspaceRoot } from '../workspace-resolver';
import { formatConfirmationRequest } from '../../domain/confirmation';

export async function confirmCommand(args: string[] = []): Promise<boolean> {
  const workspaceRoot = await resolveWorkspaceRoot();
  const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  const factory = new AppFactory(workspaceRoot, logger);
  const confirmationService = factory.createConfirmationService();

  const subCommand = (args[0] || 'list').toLowerCase();

  try {
    switch (subCommand) {
      case 'list': {
        const pending = await confirmationService.listPending();
        if (pending.length === 0) {
          console.log('\nNo pending confirmation requests.');
          return true;
        }
        console.log(`\n=== PENDING CONFIRMATIONS (${pending.length}) ===\n`);
        for (const req of pending) {
          console.log(`ID: ${req.id}`);
          console.log(`  Task: ${req.taskId}`);
          console.log(`  Type: ${req.type} | Risk: ${req.risk}`);
          console.log(`  Action: ${req.requestedAction}`);
          console.log(`  Reason: ${req.reason}`);
          if (req.affectedFiles.length > 0) {
            console.log(`  Affected Files: ${req.affectedFiles.join(', ')}`);
          }
          if (req.expiresAt) {
            console.log(`  Expires At: ${req.expiresAt}`);
          }
          if (req.credentialRequirement) {
            console.log(`  Required Credential: ${req.credentialRequirement.kind} for ${req.credentialRequirement.scope}`);
          }
          console.log('');
        }
        return true;
      }

      case 'get': {
        const id = args[1];
        if (!id) {
          console.error('Usage: confirm get <request-id>');
          return false;
        }
        const req = await confirmationService.getRequest(id);
        if (!req) {
          console.error(`Confirmation request not found: ${id}`);
          return false;
        }
        console.log('\n' + formatConfirmationRequest(req));
        if (req.decision) {
          console.log(`Decision: ${req.decision.decision} by ${req.decision.actor} at ${req.decision.decidedAt}`);
          if (req.decision.reason) console.log(`Decision Reason: ${req.decision.reason}`);
        }
        return true;
      }

      case 'approve': {
        const id = args[1];
        if (!id) {
          console.error('Usage: confirm approve <request-id> [reason]');
          return false;
        }
        const reason = args.slice(2).join(' ') || undefined;
        const req = await confirmationService.approve(id, { actor: 'cli-user', reason });
        console.log(`\n✓ Confirmation request ${req.id} APPROVED.`);
        return true;
      }

      case 'reject': {
        const id = args[1];
        if (!id) {
          console.error('Usage: confirm reject <request-id> [reason]');
          return false;
        }
        const reason = args.slice(2).join(' ') || undefined;
        const req = await confirmationService.reject(id, { actor: 'cli-user', reason });
        console.log(`\n✗ Confirmation request ${req.id} REJECTED.`);
        return true;
      }

      case 'provide-credential': {
        const id = args[1];
        const token = args[2];
        if (!id || !token) {
          console.error('Usage: confirm provide-credential <request-id> <token>');
          return false;
        }
        const reason = args.slice(3).join(' ') || undefined;
        const req = await confirmationService.provideCredential(id, token, {
          actor: 'cli-user',
          reason,
        });
        console.log(`\n✓ Test credential supplied for confirmation request ${req.id}.`);
        console.log('  (Token value is maintained in memory only and will never be persisted)');
        return true;
      }

      case 'cancel': {
        const id = args[1];
        if (!id) {
          console.error('Usage: confirm cancel <request-id>');
          return false;
        }
        const req = await confirmationService.cancel(id, { actor: 'cli-user' });
        console.log(`\nConfirmation request ${req.id} CANCELLED.`);
        return true;
      }

      default: {
        // If first argument looks like a request ID directly, show it or list
        if (subCommand.startsWith('conf-')) {
          return confirmCommand(['get', subCommand]);
        }
        console.error(`Unknown confirm subcommand: ${subCommand}`);
        console.error('Available subcommands: list, get, approve, reject, provide-credential, cancel');
        return false;
      }
    }
  } catch (error: any) {
    console.error(`\nError: ${error.message}`);
    return false;
  }
}
