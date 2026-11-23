import { RuntimeHealth, ProtectionPolicy, GovernorDecision } from '../domain/runtime-health';

export interface ExecutionGovernor {
  evaluate(health: RuntimeHealth): GovernorDecision;
  getPolicy(): ProtectionPolicy;
  updatePolicy(updates: Partial<ProtectionPolicy>): ProtectionPolicy;
  resetPolicy(): ProtectionPolicy;
}
