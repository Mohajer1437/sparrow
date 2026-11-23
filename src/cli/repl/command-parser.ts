import { isReadOnlyDirective } from '../../domain/execution-mode';

export type CommandType =
  | 'ask'
  | 'help'
  | 'status'
  | 'version'
  | 'impact'
  | 'reliability'
  | 'runs'
  | 'capabilities'
  | 'workspace'
  | 'use'
  | 'clear'
  | 'history'
  | 'exit'
  | 'role'
  | 'model'
  | 'provider'
  | 'assign'
  | 'protect'
  | 'recovery'
  | 'execute'
  | 'inspect'
  | 'knowledge'
  | 'confirm'
  | 'approve'
  | 'reject'
  | 'provide-credential'
  | 'invalid';

export interface ParsedCommand {
  readonly type: CommandType;
  readonly args?: string;
  /**
   * R1.18: execution mode requested by the interface. `/inspect` and
   * `/execute --read-only` are the only ways to reach READ_ONLY; task wording
   * never changes it.
   */
  readonly executionMode?: 'STANDARD' | 'READ_ONLY';
}

const READ_ONLY_FLAG = /(^|\s)--read-only(\s|$)/;

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  if (!trimmed) return { type: 'invalid' };

  const isSlashCommand = trimmed.startsWith('/');
  const raw = isSlashCommand ? trimmed.substring(1) : trimmed;
  const parts = raw.split(' ');
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ').trim();

  const KNOWN_COMMANDS = [
    'help',
    'status',
    'version',
    'impact',
    'reliability',
    'runs',
    'capabilities',
    'workspace',
    'use',
    'clear',
    'history',
    'exit',
    'role',
    'model',
    'provider',
    'assign',
    'protect',
    'recovery',
    'execute',
    'inspect',
    'knowledge',
    'confirm',
    'approve',
    'reject',
    'provide-credential',
  ];

  if (isSlashCommand || KNOWN_COMMANDS.includes(cmd)) {
    switch (cmd) {
      case 'help': return { type: 'help' };
      case 'status': return { type: 'status' };
      case 'version': return { type: 'version', args };
      case 'impact': return { type: 'impact', args };
      case 'reliability': return { type: 'reliability', args };
      case 'runs': return { type: 'runs', args };
      case 'capabilities': return { type: 'capabilities', args };
      case 'workspace': return { type: 'workspace' };
      case 'use': return { type: 'use', args };
      case 'clear': return { type: 'clear' };
      case 'history': return { type: 'history' };
      case 'exit': return { type: 'exit' };
      case 'role': return { type: 'role', args };
      case 'model': return { type: 'model', args };
      case 'provider': return { type: 'provider', args };
      case 'assign': return { type: 'assign', args };
      case 'protect': return { type: 'protect', args };
      case 'recovery': return { type: 'recovery', args };
      case 'confirm': return { type: 'confirm', args: args || undefined };
      case 'approve': return { type: 'approve', args: args || undefined };
      case 'reject': return { type: 'reject', args: args || undefined };
      case 'provide-credential': return { type: 'provide-credential', args: args || undefined };
      case 'execute': {
        const readOnly = READ_ONLY_FLAG.test(args);
        return {
          type: 'execute',
          args: readOnly ? args.replace(READ_ONLY_FLAG, ' ').trim() : args,
          executionMode: readOnly ? 'READ_ONLY' : 'STANDARD',
        };
      }
      case 'inspect': return { type: 'inspect', args, executionMode: 'READ_ONLY' };
      case 'knowledge': return { type: 'knowledge', args };
      default: return { type: 'invalid' };
    }
  }

  return { type: 'ask', args: trimmed };
}
