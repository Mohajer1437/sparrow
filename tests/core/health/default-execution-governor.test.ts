import { DefaultExecutionGovernor } from '../../../src/core/health/default-execution-governor';
import { RuntimeHealth, HealthMetric } from '../../../src/domain/runtime-health';

function createMockHealth(overrides: Partial<RuntimeHealth> = {}): RuntimeHealth {
  const now = new Date().toISOString();
  const healthy: HealthMetric = { value: 30, unit: '%', timestamp: now };
  const unknown: HealthMetric = { value: null, unit: '', timestamp: now };
  return Object.freeze({
    cpuUtilization: healthy,
    memoryUtilization: healthy,
    cpuTemperature: { ...unknown, unit: '°C' },
    gpuTemperature: { ...unknown, unit: '°C' },
    batteryLevel: { ...unknown, unit: '%' },
    collectedAt: now,
    ...overrides,
  });
}

describe('DefaultExecutionGovernor', () => {
  let governor: DefaultExecutionGovernor;

  beforeEach(() => {
    governor = new DefaultExecutionGovernor();
  });

  it('returns continue for healthy metrics', () => {
    expect(governor.evaluate(createMockHealth()).action).toBe('continue');
  });

  it('returns pause when CPU exceeds threshold', () => {
    const now = new Date().toISOString();
    const health = createMockHealth({ cpuUtilization: { value: 95, unit: '%', timestamp: now } });
    const decision = governor.evaluate(health);
    expect(decision.action).toBe('pause');
    expect(decision.reason).toContain('CPU');
  });

  it('returns pause when memory exceeds threshold', () => {
    const now = new Date().toISOString();
    const health = createMockHealth({ memoryUtilization: { value: 90, unit: '%', timestamp: now } });
    const decision = governor.evaluate(health);
    expect(decision.action).toBe('pause');
    expect(decision.reason).toContain('Memory');
  });

  it('returns pause when temperature exceeds threshold', () => {
    const now = new Date().toISOString();
    const health = createMockHealth({ cpuTemperature: { value: 85, unit: '°C', timestamp: now } });
    const decision = governor.evaluate(health);
    expect(decision.action).toBe('pause');
    expect(decision.reason).toContain('temperature');
  });

  it('returns slow-down in warning zone', () => {
    const now = new Date().toISOString();
    const health = createMockHealth({ cpuUtilization: { value: 75, unit: '%', timestamp: now } });
    expect(governor.evaluate(health).action).toBe('slow-down');
  });

  it('handles null metrics gracefully (continue)', () => {
    const now = new Date().toISOString();
    const unknown: HealthMetric = { value: null, unit: '%', timestamp: now };
    const health = createMockHealth({ cpuUtilization: unknown, memoryUtilization: unknown });
    expect(governor.evaluate(health).action).toBe('continue');
  });

  it('returns current policy with defaults', () => {
    const policy = governor.getPolicy();
    expect(policy.cpuThreshold).toBe(90);
    expect(policy.memoryThreshold).toBe(85);
    expect(policy.temperatureThreshold).toBe(80);
    expect(policy.pauseDurationMs).toBe(30000);
    expect(policy.healthCheckIntervalMs).toBe(5000);
    expect(policy.autoResume).toBe(true);
  });

  it('updates policy partially', () => {
    const updated = governor.updatePolicy({ cpuThreshold: 80 });
    expect(updated.cpuThreshold).toBe(80);
    expect(updated.memoryThreshold).toBe(85);
  });

  it('resets policy to defaults', () => {
    governor.updatePolicy({ cpuThreshold: 50 });
    expect(governor.resetPolicy().cpuThreshold).toBe(90);
  });

  it('accepts custom initial policy', () => {
    const custom = new DefaultExecutionGovernor({ cpuThreshold: 70 });
    expect(custom.getPolicy().cpuThreshold).toBe(70);
  });
});
