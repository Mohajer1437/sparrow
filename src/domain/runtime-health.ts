export interface HealthMetric {
  readonly value: number | null;
  readonly unit: string;
  readonly timestamp: string;
}

export interface RuntimeHealth {
  readonly cpuUtilization: HealthMetric;
  readonly memoryUtilization: HealthMetric;
  readonly cpuTemperature: HealthMetric;
  readonly gpuTemperature: HealthMetric;
  readonly batteryLevel: HealthMetric;
  readonly collectedAt: string;
}

export type HealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

export interface ProtectionPolicy {
  readonly cpuThreshold: number;
  readonly memoryThreshold: number;
  readonly temperatureThreshold: number;
  readonly pauseDurationMs: number;
  readonly healthCheckIntervalMs: number;
  readonly autoResume: boolean;
}

export type GovernorAction = 'continue' | 'slow-down' | 'pause' | 'resume';

export interface GovernorDecision {
  readonly action: GovernorAction;
  readonly reason: string;
  readonly timestamp: string;
}
