import { AppFactory } from '../../core/app-factory';
import { resolveWorkspaceRoot } from '../workspace-resolver';

const logger = {
  debug: () => {},
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
};

export async function protectCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub || sub === 'status') {
    await showProtectionStatus();
    return;
  }

  if (sub === 'set') {
    const key = args[1];
    const value = args[2];
    if (!key || value === undefined) {
      console.error('Usage: agent protect set <key> <value>');
      console.error('Keys: cpuThreshold, memoryThreshold, temperatureThreshold,');
      console.error('      pauseDuration, checkInterval, autoResume');
      process.exit(2);
      return;
    }
    await setProtectionValue(key, value);
    return;
  }

  if (sub === 'reset') {
    await resetProtection();
    return;
  }

  console.error(`Unknown protect subcommand: ${sub}`);
  console.error('Usage: agent protect [status | set <key> <value> | reset]');
  process.exit(2);
}

async function showProtectionStatus(): Promise<void> {
  try {
    const workspaceRoot = await resolveWorkspaceRoot();
    const factory = new AppFactory(workspaceRoot, logger);
    const governor = factory.createExecutionGovernor();
    const provider = factory.createRuntimeHealthProvider();
    const policy = governor.getPolicy();
    const health = await provider.collect();
    const decision = governor.evaluate(health);

    console.log('═'.repeat(50));
    console.log('RUNTIME PROTECTION');
    console.log('═'.repeat(50));
    console.log('');
    console.log('Policy:');
    console.log(`  CPU Threshold:         ${policy.cpuThreshold}%`);
    console.log(`  Memory Threshold:      ${policy.memoryThreshold}%`);
    console.log(`  Temperature Threshold: ${policy.temperatureThreshold}°C`);
    console.log(`  Pause Duration:        ${policy.pauseDurationMs}ms`);
    console.log(`  Check Interval:        ${policy.healthCheckIntervalMs}ms`);
    console.log(`  Auto Resume:           ${policy.autoResume ? 'yes' : 'no'}`);
    console.log('');
    console.log('Current Health:');
    console.log(`  CPU:      ${health.cpuUtilization.value !== null ? health.cpuUtilization.value + '%' : 'unknown'}`);
    console.log(`  Memory:   ${health.memoryUtilization.value !== null ? health.memoryUtilization.value + '%' : 'unknown'}`);
    console.log(`  CPU Temp: ${health.cpuTemperature.value !== null ? health.cpuTemperature.value + '°C' : 'unknown'}`);
    console.log('');
    console.log(`Decision: ${decision.action.toUpperCase()}`);
    console.log(`Reason:   ${decision.reason}`);
    console.log('');
    console.log('═'.repeat(50));
  } catch (error: any) {
    console.error(`Failed to show protection status: ${error.message}`);
    process.exit(1);
  }
}

async function setProtectionValue(key: string, value: string): Promise<void> {
  try {
    const workspaceRoot = await resolveWorkspaceRoot();
    const factory = new AppFactory(workspaceRoot, logger);
    const governor = factory.createExecutionGovernor();

    const keyMap: Record<string, string> = {
      cpuThreshold: 'cpuThreshold',
      memoryThreshold: 'memoryThreshold',
      temperatureThreshold: 'temperatureThreshold',
      pauseDuration: 'pauseDurationMs',
      checkInterval: 'healthCheckIntervalMs',
      autoResume: 'autoResume',
    };

    const policyKey = keyMap[key];
    if (!policyKey) {
      console.error(`Unknown key: ${key}`);
      console.error('Valid keys: cpuThreshold, memoryThreshold, temperatureThreshold,');
      console.error('            pauseDuration, checkInterval, autoResume');
      process.exit(2);
      return;
    }

    let parsedValue: number | boolean;
    if (policyKey === 'autoResume') {
      parsedValue = value === 'true' || value === 'yes' || value === '1';
    } else {
      parsedValue = Number(value);
      if (isNaN(parsedValue as number)) {
        console.error(`Invalid numeric value: ${value}`);
        process.exit(2);
        return;
      }
    }

    const updated = governor.updatePolicy({ [policyKey]: parsedValue });
    console.log(`✓ Protection updated: ${key} = ${value}`);
    console.log(`  CPU: ${updated.cpuThreshold}% | Memory: ${updated.memoryThreshold}% | Temp: ${updated.temperatureThreshold}°C`);
  } catch (error: any) {
    console.error(`Failed to set protection value: ${error.message}`);
    process.exit(1);
  }
}

async function resetProtection(): Promise<void> {
  try {
    const workspaceRoot = await resolveWorkspaceRoot();
    const factory = new AppFactory(workspaceRoot, logger);
    const governor = factory.createExecutionGovernor();
    const policy = governor.resetPolicy();

    console.log('✓ Protection settings reset to defaults');
    console.log(`  CPU: ${policy.cpuThreshold}% | Memory: ${policy.memoryThreshold}% | Temp: ${policy.temperatureThreshold}°C`);
    console.log(`  Pause: ${policy.pauseDurationMs}ms | Interval: ${policy.healthCheckIntervalMs}ms | Auto: ${policy.autoResume ? 'yes' : 'no'}`);
  } catch (error: any) {
    console.error(`Failed to reset protection: ${error.message}`);
    process.exit(1);
  }
}
