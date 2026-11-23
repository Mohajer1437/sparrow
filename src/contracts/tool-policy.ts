import { ToolExecutionContext, ToolPolicyDecision } from '../domain/tool-policy';

export interface ToolPolicy {
  evaluate(context: ToolExecutionContext): ToolPolicyDecision;
}
