import { NodeRuntimeHealthProvider } from '../../../src/core/health/node-runtime-health-provider';

describe('NodeRuntimeHealthProvider', () => {
  let provider: NodeRuntimeHealthProvider;

  beforeEach(() => {
    provider = new NodeRuntimeHealthProvider();
  });

  it('collects runtime health with cpu and memory', async () => {
    const health = await provider.collect();
    expect(health.cpuUtilization).toBeDefined();
    expect(health.memoryUtilization).toBeDefined();
    expect(health.collectedAt).toBeDefined();
  });

  it('never throws on collect', async () => {
    await expect(provider.collect()).resolves.toBeDefined();
  });

  it('reports availability', async () => {
    expect(await provider.isAvailable()).toBe(true);
  });

  it('returns null for unavailable metrics', async () => {
    const health = await provider.collect();
    expect(health.cpuTemperature.value).toBeNull();
    expect(health.gpuTemperature.value).toBeNull();
    expect(health.batteryLevel.value).toBeNull();
  });

  it('returns immutable health object', async () => {
    const health = await provider.collect();
    expect(Object.isFrozen(health)).toBe(true);
  });
});
