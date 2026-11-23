import { AppFactory } from '../../core/app-factory';
import { Logger } from '../../contracts/logger';
import { resolveWorkspaceRoot } from '../workspace-resolver';
import { loadEffectiveConfiguration } from '../../core/configuration/default-configuration-loader';
import { ProviderHealthResult } from '../../domain/provider-health';
import { ProviderSmokeTestResult } from '../../domain/provider-smoke-test';
import {
  addProviderProfileInteractive,
  createProviderProfileStore,
  printProviderCurrent,
  printProviderList,
} from './provider-profiles';

const logger: Logger = {
  debug: () => {},
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
};

/**
 * CLI: agent provider … | /provider …
 */
export async function providerCommand(args: string[]): Promise<void> {
  const sub = (args[0] || 'health').toLowerCase();

  if (sub === 'health') {
    await runProviderHealth();
    return;
  }

  if (sub === 'test') {
    await runProviderSmoke();
    return;
  }

  if (sub === 'list') {
    await runProviderList();
    return;
  }

  if (sub === 'current') {
    await runProviderCurrent();
    return;
  }

  if (sub === 'use') {
    await runProviderUse(args.slice(1));
    return;
  }

  if (sub === 'add') {
    await runProviderAdd();
    return;
  }

  console.error(`Unknown provider subcommand: ${sub}`);
  console.error('Usage: agent provider health|test|list|current|use <name>|add');
  process.exit(2);
}

async function workspaceRoot(): Promise<string> {
  return resolveWorkspaceRoot();
}

async function runProviderList(): Promise<void> {
  const root = await workspaceRoot();
  const store = createProviderProfileStore(root);
  const { activeProvider, profiles } = await store.list();
  printProviderList(activeProvider, profiles);
}

async function runProviderCurrent(): Promise<void> {
  const root = await workspaceRoot();
  const store = createProviderProfileStore(root);
  const profilesFile = await store.loadProfiles();
  const active = profilesFile.activeProvider;
  if (!active) {
    console.log('No active provider profile. Using legacy/env configuration.');
    const effective = await loadEffectiveConfiguration(root);
    console.log(`  type:    ${effective.provider.type}`);
    console.log(`  baseUrl: ${effective.provider.baseUrl}`);
    console.log(`  model:   ${effective.defaultModel}`);
    return;
  }
  const profile = profilesFile.providers[active];
  if (!profile) {
    console.error(`Active provider "${active}" is not defined.`);
    process.exit(1);
    return;
  }
  const secrets = await store.loadSecrets();
  printProviderCurrent(active, profile, Boolean(secrets[active]?.apiKey));
}

async function runProviderUse(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error('Usage: agent provider use <name>');
    process.exit(2);
    return;
  }
  const root = await workspaceRoot();
  const store = createProviderProfileStore(root);
  try {
    const profile = await store.setActive(name);
    console.log(`Active provider set to "${name}" (${profile.type}).`);
  } catch (err: any) {
    console.error(err?.message || String(err));
    process.exit(1);
  }
}

async function runProviderAdd(): Promise<void> {
  const root = await workspaceRoot();
  const store = createProviderProfileStore(root);
  try {
    await addProviderProfileInteractive(store);
  } catch (err: any) {
    console.error(err?.message || String(err));
    process.exit(1);
  }
}

async function runProviderHealth(): Promise<void> {
  try {
    const workspace = await workspaceRoot();
    const effective = await loadEffectiveConfiguration(workspace);
    const factory = new AppFactory(workspace, logger, effective);
    const result = await factory.checkConfiguredProviderHealth();
    printHealthResult(result);

    if (result.status === 'healthy') {
      return;
    }
    if (result.status === 'unauthorized' || result.status === 'unavailable') {
      process.exitCode = 1;
      return;
    }
    process.exitCode = 2;
  } catch (err: any) {
    console.error(`Provider health check failed: ${err?.message || String(err)}`);
    process.exit(1);
  }
}

async function runProviderSmoke(): Promise<void> {
  try {
    const workspace = await workspaceRoot();
    const effective = await loadEffectiveConfiguration(workspace);
    const factory = new AppFactory(workspace, logger, effective);
    const result = await factory.runConfiguredProviderSmokeTest();
    printSmokeResult(result);

    if (result.success) {
      return;
    }
    process.exitCode = 1;
  } catch (err: any) {
    console.error(`Provider smoke test failed: ${err?.message || String(err)}`);
    process.exit(1);
  }
}

export function printHealthResult(result: ProviderHealthResult): void {
  console.log('═'.repeat(60));
  console.log('PROVIDER HEALTH');
  console.log('═'.repeat(60));
  console.log(`  Status:     ${result.status}`);
  console.log(`  Type:       ${result.providerType}`);
  console.log(`  Endpoint:   ${result.endpoint}`);
  console.log(`  Model:      ${result.configuredModel ?? '(none configured)'}`);
  console.log(`  Auth:       ${result.authentication}`);
  console.log(`  Latency:    ${result.latencyMs} ms`);
  console.log(`  Checked At: ${result.checkedAt}`);
  if (result.message) {
    console.log(`  Note:       ${result.message}`);
  }
  console.log('═'.repeat(60));
}

export function printSmokeResult(result: ProviderSmokeTestResult): void {
  console.log('═'.repeat(60));
  console.log('PROVIDER SMOKE TEST');
  console.log('═'.repeat(60));
  console.log(`  Success:    ${result.success ? 'yes' : 'no'}`);
  console.log(`  Type:       ${result.providerType}`);
  console.log(`  Endpoint:   ${result.endpoint}`);
  console.log(`  Model:      ${result.model}`);
  console.log(`  Latency:    ${result.latencyMs} ms`);
  console.log(`  Checked At: ${result.checkedAt}`);
  if (result.responsePreview) {
    console.log(`  Response:   ${result.responsePreview}`);
  }
  if (result.failureCategory) {
    console.log(`  Failure:    ${result.failureCategory}`);
  }
  if (result.message) {
    console.log(`  Note:       ${result.message}`);
  }
  console.log('═'.repeat(60));
}
