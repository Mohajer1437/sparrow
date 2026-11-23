/**
 * R1.18-R1.23 — READ_ONLY is a deterministic policy, not a prompt suggestion.
 */

import {
  BLOCKED_BY_POLICY,
  allowsDatabaseMutation,
  allowsGitMutation,
  allowsHttpMethod,
  evaluateToolAgainstMode,
  isExecutionMode,
  isMutatingTool,
} from '../../src/domain/execution-mode';

describe('Execution mode contract (R1.18)', () => {
  it('accepts only the declared modes', () => {
    expect(isExecutionMode('STANDARD')).toBe(true);
    expect(isExecutionMode('READ_ONLY')).toBe(true);
    expect(isExecutionMode('read_only')).toBe(false);
    expect(isExecutionMode('do not modify files')).toBe(false);
  });
});

describe('Tool enforcement in READ_ONLY (R1.20)', () => {
  const blocked = [
    'write_file', 'create_file', 'delete_file', 'apply_patch', 'edit_file',
    'rename_file', 'move_file', 'git_commit', 'git_add', 'git_checkout',
    'git_reset', 'run_migration', 'db_write', 'execute_sql',
  ];

  it.each(blocked)('blocks %s', (tool) => {
    const decision = evaluateToolAgainstMode('READ_ONLY', tool);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain(BLOCKED_BY_POLICY);
    expect(decision.rule).toBe('RULE_READ_ONLY');
  });

  const allowed = ['read_file', 'list_files', 'search_code', 'git_status', 'git_diff', 'run_tests'];

  it.each(allowed)('allows %s', (tool) => {
    expect(evaluateToolAgainstMode('READ_ONLY', tool).allowed).toBe(true);
  });

  it('allows every tool in STANDARD mode', () => {
    for (const tool of blocked) {
      expect(evaluateToolAgainstMode('STANDARD', tool).allowed).toBe(true);
    }
  });

  it('blocks an unregistered tool whose name still describes a mutation', () => {
    expect(isMutatingTool('workspace_write_many')).toBe(true);
    expect(evaluateToolAgainstMode('READ_ONLY', 'workspace_write_many').allowed).toBe(false);
  });
});

describe('Git and database safety (R1.22, R1.23)', () => {
  it('blocks git mutation in READ_ONLY and permits it in STANDARD', () => {
    expect(allowsGitMutation('READ_ONLY')).toBe(false);
    expect(allowsGitMutation('STANDARD')).toBe(true);
  });

  it('blocks database mutation in READ_ONLY and permits it in STANDARD', () => {
    expect(allowsDatabaseMutation('READ_ONLY')).toBe(false);
    expect(allowsDatabaseMutation('STANDARD')).toBe(true);
  });
});

describe('HTTP probes in READ_ONLY (R1.21)', () => {
  it('permits safe verbs', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      expect(allowsHttpMethod('READ_ONLY', method)).toBe(true);
    }
  });

  it('refuses mutating verbs', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(allowsHttpMethod('READ_ONLY', method)).toBe(false);
      expect(allowsHttpMethod('STANDARD', method)).toBe(true);
    }
  });
});
