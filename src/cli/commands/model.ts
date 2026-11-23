import { AppFactory } from '../../core/app-factory';
import { resolveWorkspaceRoot } from '../workspace-resolver';

const logger = {
  debug: () => {},
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
};

export async function modelCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub || sub === 'list') {
    const isLocal = args.includes('--local');
    await listModels(isLocal);
    return;
  }

  if (sub === 'show') {
    const modelId = args[1];
    if (!modelId) {
      console.error('Usage: agent model show <modelId>');
      process.exit(2);
    }
    await showModel(modelId);
    return;
  }

  console.error(`Unknown model subcommand: ${sub}`);
  console.error('Usage: agent model [list [--local] | show <modelId>]');
  process.exit(2);
}

async function listModels(localOnly: boolean): Promise<void> {
  try {
    const factory = new AppFactory(await resolveWorkspaceRoot(), logger);
    await factory.discoverOllamaModels();
    const registry = factory.createModelRegistry();
    const models = localOnly
      ? registry.find({ isLocal: true })
      : registry.list();

    if (models.length === 0) {
      console.log('');
      console.log('⚠  No models found.');
      console.log('');
      console.log('  Make sure Ollama is running:');
      console.log('    ollama serve');
      console.log('');
      console.log('  Then pull a model:');
      console.log('    ollama pull qwen2.5:3b');
      console.log('');
      return;
    }

    const title = localOnly ? 'LOCAL MODELS' : 'ALL MODELS';
    console.log('═'.repeat(70));
    console.log(`${title} (${models.length})`);
    console.log('═'.repeat(70));
    console.log('');

    for (const m of models) {
      const caps: string[] = [];
      if (m.supportsTools) caps.push('tools');
      if (m.supportsVision) caps.push('vision');
      if (m.supportsThinking) caps.push('thinking');

      console.log(`  ${m.id}`);
      console.log(`    Display:    ${m.displayName}`);
      console.log(`    Provider:   ${m.providerId}`);
      console.log(`    Context:    ${m.contextWindow.toLocaleString()} tokens`);
      console.log(`    Max Output: ${m.maxOutputTokens.toLocaleString()} tokens`);
      console.log(`    Caps:       ${caps.length > 0 ? caps.join(', ') : 'none'}`);
      console.log(`    Local:      ${m.isLocal ? 'yes' : 'no'}`);
      console.log(`    Status:     ${m.availability}`);
      console.log('');
    }
    console.log('═'.repeat(70));
  } catch (error: any) {
    console.error(`Failed to list models: ${error.message}`);
    process.exit(1);
  }
}

async function showModel(modelId: string): Promise<void> {
  try {
    const factory = new AppFactory(await resolveWorkspaceRoot(), logger);
    const registry = factory.createModelRegistry();
    const m = registry.get(modelId);

    if (!m) {
      console.error(`Model not found: ${modelId}`);
      process.exit(1);
    }

    const caps: string[] = [];
    if (m.supportsTools) caps.push('tools');
    if (m.supportsVision) caps.push('vision');
    if (m.supportsThinking) caps.push('thinking');

    console.log('═'.repeat(70));
    console.log(`MODEL: ${m.id}`);
    console.log('═'.repeat(70));
    console.log('');
    console.log(`  Display Name: ${m.displayName}`);
    console.log(`  Provider:     ${m.providerId}`);
    console.log(`  Context:      ${m.contextWindow.toLocaleString()} tokens`);
    console.log(`  Max Output:   ${m.maxOutputTokens.toLocaleString()} tokens`);
    console.log(`  Capabilities: ${caps.length > 0 ? caps.join(', ') : 'none'}`);
    console.log(`  Local:        ${m.isLocal ? 'yes' : 'no'}`);
    console.log(`  Availability: ${m.availability}`);
    console.log(`  Tags:         ${m.tags.join(', ')}`);
    if (Object.keys(m.metadata).length > 0) {
      console.log(`  Metadata:     ${JSON.stringify(m.metadata)}`);
    }
    console.log('');
    console.log('═'.repeat(70));
  } catch (error: any) {
    console.error(`Failed to show model: ${error.message}`);
    process.exit(1);
  }
}
