import { ToolPolicy } from '../../contracts/tool-policy';
import { 
  ToolExecutionContext, 
  ToolPolicyDecision, 
  ToolPolicyEvidence,
  ToolPermission,
  ToolRiskLevel
} from '../../domain/tool-policy';
import { evaluateToolAgainstMode } from '../../domain/execution-mode';

export class DefaultToolPolicy implements ToolPolicy {
  private readonly protectedPaths = [
    'node_modules/',
    '.git/',
    '.ai/',
    'dist/',
    'build/',
    '.env',
    '.env.local',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock'
  ];

  private readonly destructiveTools = ['delete_file'];
  // NOTE: apply_patch removed — SafePatchExecutor still wraps it for safety.
  // This enables automated step execution without interactive confirmation.
  private readonly maxExecutionCount = 10;

  evaluate(context: ToolExecutionContext): ToolPolicyDecision {
    const evidence: ToolPolicyEvidence[] = [];
    let permission: ToolPermission = 'ALLOW';
    let riskLevel: ToolRiskLevel = 'LOW';

    // RULE_01: Protected paths
    const pathArg = context.arguments?.path || context.arguments?.filePath || '';
    if (typeof pathArg === 'string') {
      const normalizedPath = pathArg.replace(/\\/g, '/');
      for (const protectedPath of this.protectedPaths) {
        if (normalizedPath.includes(protectedPath) || normalizedPath.startsWith(protectedPath)) {
          evidence.push({
            rule: 'RULE_01',
            reason: `Access to protected path denied: ${protectedPath}`,
            details: { path: normalizedPath, protectedPattern: protectedPath }
          });
          permission = 'DENY';
          riskLevel = 'CRITICAL';
          break;
        }
      }
    }

    // RULE_READ_ONLY: mutation is impossible in READ_ONLY mode (R1.20).
    const modeDecision = evaluateToolAgainstMode(
      context.executionMode ?? 'STANDARD',
      context.toolName,
    );
    if (!modeDecision.allowed) {
      evidence.push({
        rule: modeDecision.rule ?? 'RULE_READ_ONLY',
        reason: modeDecision.reason ?? 'blocked by read-only execution mode',
        details: { toolName: context.toolName, executionMode: context.executionMode }
      });
      permission = 'DENY';
      riskLevel = 'CRITICAL';
    }

    // RULE_02: Session status compatibility
    if (context.sessionStatus && context.sessionStatus !== 'executing') {
      evidence.push({
        rule: 'RULE_02',
        reason: `Tool execution not allowed in session status: ${context.sessionStatus}`,
        details: { sessionStatus: context.sessionStatus, toolName: context.toolName }
      });
      permission = 'DENY';
      riskLevel = 'HIGH';
    }

    // RULE_03: Destructive tools require confirmation
    if (this.destructiveTools.includes(context.toolName)) {
      evidence.push({
        rule: 'RULE_03',
        reason: `Destructive tool requires confirmation: ${context.toolName}`,
        details: { toolName: context.toolName }
      });
      if (permission === 'ALLOW') {
        permission = 'REQUIRE_CONFIRMATION';
        riskLevel = 'HIGH';
      }
    }

    // RULE_04: Repeated execution detection
    if (context.executionCount !== undefined && context.executionCount > this.maxExecutionCount) {
      evidence.push({
        rule: 'RULE_04',
        reason: `Tool execution count exceeded limit: ${context.executionCount} > ${this.maxExecutionCount}`,
        details: { toolName: context.toolName, executionCount: context.executionCount, maxAllowed: this.maxExecutionCount }
      });
      permission = 'DENY';
      riskLevel = 'MEDIUM';
    }

    // RULE_05: Scope validation
    if (context.scope && context.scope.length > 0 && pathArg) {
      const normalizedPath = pathArg.replace(/\\/g, '/');
      const inScope = context.scope.some(scopePath => {
        const normalizedScope = scopePath.replace(/\\/g, '/');
        return normalizedPath.startsWith(normalizedScope);
      });
      
      if (!inScope) {
        evidence.push({
          rule: 'RULE_05',
          reason: `Tool execution outside allowed scope`,
          details: { path: normalizedPath, scope: context.scope }
        });
        permission = 'DENY';
        riskLevel = 'MEDIUM';
      }
    }

    return {
      permission,
      riskLevel,
      evidence,
      timestamp: new Date().toISOString()
    };
  }
}
