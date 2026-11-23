import { DefaultToolPolicy } from '../../../src/core/tool-policy/default-tool-policy';
import { ToolExecutionContext } from '../../../src/domain/tool-policy';

describe('DefaultToolPolicy', () => {
  let policy: DefaultToolPolicy;

  beforeEach(() => {
    policy = new DefaultToolPolicy();
  });

  it('allows safe tool execution', () => {
    const context: ToolExecutionContext = {
      toolName: 'read_file',
      arguments: { path: 'src/core/service.ts' },
      sessionStatus: 'executing'
    };

    const decision = policy.evaluate(context);
    expect(decision.permission).toBe('ALLOW');
    expect(decision.riskLevel).toBe('LOW');
    expect(decision.evidence).toHaveLength(0);
  });

  it('denies access to protected paths', () => {
    const context: ToolExecutionContext = {
      toolName: 'read_file',
      arguments: { path: 'node_modules/package/index.js' },
      sessionStatus: 'executing'
    };

    const decision = policy.evaluate(context);
    expect(decision.permission).toBe('DENY');
    expect(decision.riskLevel).toBe('CRITICAL');
    expect(decision.evidence.length).toBeGreaterThan(0);
    expect(decision.evidence[0].rule).toBe('RULE_01');
  });

  it('requires confirmation for destructive tools', () => {
    const context: ToolExecutionContext = {
      toolName: 'delete_file',
      arguments: { path: 'src/old-file.ts' },
      sessionStatus: 'executing'
    };

    const decision = policy.evaluate(context);
    expect(decision.permission).toBe('REQUIRE_CONFIRMATION');
    expect(decision.riskLevel).toBe('HIGH');
    expect(decision.evidence.some(e => e.rule === 'RULE_03')).toBe(true);
  });

  it('denies tool execution in wrong session status', () => {
    const context: ToolExecutionContext = {
      toolName: 'read_file',
      arguments: { path: 'src/file.ts' },
      sessionStatus: 'completed'
    };

    const decision = policy.evaluate(context);
    expect(decision.permission).toBe('DENY');
    expect(decision.evidence.some(e => e.rule === 'RULE_02')).toBe(true);
  });

  it('detects repeated execution', () => {
    const context: ToolExecutionContext = {
      toolName: 'read_file',
      arguments: { path: 'src/file.ts' },
      sessionStatus: 'executing',
      executionCount: 15
    };

    const decision = policy.evaluate(context);
    expect(decision.permission).toBe('DENY');
    expect(decision.evidence.some(e => e.rule === 'RULE_04')).toBe(true);
  });

  it('denies execution outside scope', () => {
    const context: ToolExecutionContext = {
      toolName: 'write_file',
      arguments: { path: 'src/out-of-scope/file.ts' },
      sessionStatus: 'executing',
      scope: ['src/core/']
    };

    const decision = policy.evaluate(context);
    expect(decision.permission).toBe('DENY');
    expect(decision.evidence.some(e => e.rule === 'RULE_05')).toBe(true);
  });

  it('records evidence for all violations', () => {
    const context: ToolExecutionContext = {
      toolName: 'delete_file',
      arguments: { path: 'node_modules/package/file.js' },
      sessionStatus: 'completed',
      executionCount: 20
    };

    const decision = policy.evaluate(context);
    expect(decision.permission).toBe('DENY');
    expect(decision.evidence.length).toBeGreaterThan(1);
    expect(decision.evidence.map(e => e.rule)).toContain('RULE_01');
    expect(decision.evidence.map(e => e.rule)).toContain('RULE_02');
  });
});
