import { ExecutionGovernor } from '../../contracts/execution-governor';
import { RuntimeHealth, ProtectionPolicy, GovernorDecision } from '../../domain/runtime-health';

const DEFAULT_POLICY: ProtectionPolicy = Object.freeze({
  cpuThreshold: 90,
  memoryThreshold: 85,
  temperatureThreshold: 80,
  pauseDurationMs: 30000,
  healthCheckIntervalMs: 5000,
  autoResume: true,
});

export class DefaultExecutionGovernor implements ExecutionGovernor {
  private policy: ProtectionPolicy;

  constructor(policy?: Partial<ProtectionPolicy>) {
    this.policy = Object.freeze({ ...DEFAULT_POLICY, ...policy });
  }

  evaluate(health: RuntimeHealth): GovernorDecision {
    const now = new Date().toISOString();

    if (health.cpuUtilization.value !== null && health.cpuUtilization.value >= this.policy.cpuThreshold) {
      return Object.freeze({
        action: 'pause' as const,
        reason: `CPU utilization ${health.cpuUtilization.value}% exceeds threshold ${this.policy.cpuThreshold}%`,
        timestamp: now,
      });
    }

    if (health.memoryUtilization.value !== null && health.memoryUtilization.value >= this.policy.memoryThreshold) {
      return Object.freeze({
        action: 'pause' as const,
        reason: `Memory utilization ${health.memoryUtilization.value}% exceeds threshold ${this.policy.memoryThreshold}%`,
        timestamp: now,
      });
    }

    if (health.cpuTemperature.value !== null && health.cpuTemperature.value >= this.policy.temperatureThreshold) {
      return Object.freeze({
        action: 'pause' as const,
        reason: `CPU temperature ${health.cpuTemperature.value}°C exceeds threshold ${this.policy.temperatureThreshold}°C`,
        timestamp: now,
      });
    }

    const warningFactor = 0.8;

    if (health.cpuUtilization.value !== null && health.cpuUtilization.value >= this.policy.cpuThreshold * warningFactor) {
      return Object.freeze({
        action: 'slow-down' as const,
        reason: `CPU utilization ${health.cpuUtilization.value}% approaching threshold ${this.policy.cpuThreshold}%`,
        timestamp: now,
      });
    }

    if (health.memoryUtilization.value !== null && health.memoryUtilization.value >= this.policy.memoryThreshold * warningFactor) {
      return Object.freeze({
        action: 'slow-down' as const,
        reason: `Memory utilization ${health.memoryUtilization.value}% approaching threshold ${this.policy.memoryThreshold}%`,
        timestamp: now,
      });
    }

    return Object.freeze({
      action: 'continue' as const,
      reason: 'All metrics within safe limits',
      timestamp: now,
    });
  }

  getPolicy(): ProtectionPolicy {
    return this.policy;
  }

  updatePolicy(updates: Partial<ProtectionPolicy>): ProtectionPolicy {
    this.policy = Object.freeze({ ...this.policy, ...updates });
    return this.policy;
  }

  resetPolicy(): ProtectionPolicy {
    this.policy = Object.freeze({ ...DEFAULT_POLICY });
    return this.policy;
  }
}
