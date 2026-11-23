import * as os from 'os';
import { RuntimeHealthProvider } from '../../contracts/runtime-health-provider';
import { RuntimeHealth, HealthMetric } from '../../domain/runtime-health';

export class NodeRuntimeHealthProvider implements RuntimeHealthProvider {
  async collect(): Promise<RuntimeHealth> {
    const now = new Date().toISOString();
    const unknown: HealthMetric = Object.freeze({ value: null, unit: '', timestamp: now });

    return Object.freeze({
      cpuUtilization: this.collectCpu(now),
      memoryUtilization: this.collectMemory(now),
      cpuTemperature: Object.freeze({ ...unknown, unit: '°C' }),
      gpuTemperature: Object.freeze({ ...unknown, unit: '°C' }),
      batteryLevel: Object.freeze({ ...unknown, unit: '%' }),
      collectedAt: now,
    });
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  private collectCpu(timestamp: string): HealthMetric {
    try {
      const cpus = os.cpus();
      if (!cpus || cpus.length === 0) {
        return Object.freeze({ value: null, unit: '%', timestamp });
      }
      let totalIdle = 0;
      let totalTick = 0;
      for (const cpu of cpus) {
        for (const type of Object.keys(cpu.times)) {
          totalTick += (cpu.times as any)[type];
        }
        totalIdle += cpu.times.idle;
      }
      const utilization = totalTick > 0 ? ((1 - totalIdle / totalTick) * 100) : 0;
      return Object.freeze({ value: Math.round(utilization * 10) / 10, unit: '%', timestamp });
    } catch {
      return Object.freeze({ value: null, unit: '%', timestamp });
    }
  }

  private collectMemory(timestamp: string): HealthMetric {
    try {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      if (totalMem <= 0) {
        return Object.freeze({ value: null, unit: '%', timestamp });
      }
      const utilization = ((1 - freeMem / totalMem) * 100);
      return Object.freeze({ value: Math.round(utilization * 10) / 10, unit: '%', timestamp });
    } catch {
      return Object.freeze({ value: null, unit: '%', timestamp });
    }
  }
}
