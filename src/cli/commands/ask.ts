import { Logger } from '../../contracts/logger';
import { ProviderError } from '../../domain/errors/provider-errors';
import { safeProviderFailureReason } from '../../core/provider/provider-failover-policy';
import { resolveWorkspaceRoot } from '../workspace-resolver';
import { DefaultCliRole, DEFAULT_MODEL } from '../shared/cli-role';
import { createAppFactoryWithProviderSelection } from './provider-selection';
import {
  NoHealthyProvidersError,
  ProviderSelectionRequiredError,
} from '../../core/provider/provider-selection-service';


export async function askCommand(message: string) {
  if (!message || message.trim().length === 0) {
    console.error('Error: Prompt cannot be empty.');
    process.exit(1);
    return;
  }

  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: (msg: string) => console.warn(msg),
    error: () => {}
  };

  const workspaceRoot = await resolveWorkspaceRoot();

  let factory;
  let resolved;
  try {
    ({ factory, resolved } = await createAppFactoryWithProviderSelection(
      workspaceRoot,
      logger,
    ));
  } catch (err: any) {
    if (
      err instanceof NoHealthyProvidersError
      || err instanceof ProviderSelectionRequiredError
    ) {
      console.error(safeProviderFailureReason(err));
      process.exit(1);
      return;
    }
    console.error(`Error: ${safeProviderFailureReason(err)}`);
    process.exit(1);
    return;
  }

  const config = factory.createConfiguration();

  try {
    await config.load();
  } catch (err: any) {
    console.error(`Error: ${safeProviderFailureReason(err)}`);
    process.exit(1);
    return;
  }

  const limits = resolved.effective.contextLimits;
  const session = factory.createSession();
  const orchestrator = factory.createConversationOrchestrator(config, limits, session);
  const toolDefinitions = factory.createToolDefinitions();
  
  const sessionState = await session.start('CLI Ask Session');

  const providerId = factory.resolveConfiguredProviderId();

  try {
    const response = await orchestrator.handleTurn({
      sessionId: sessionState.id,
      message: message,
      role: new DefaultCliRole(),
      providerId,
      model: resolved.effective.defaultModel || DEFAULT_MODEL,
      tools: toolDefinitions
    });

    console.log(response.content);
  } catch (err: any) {
    if (err instanceof ProviderError) {
      const msg = err.message || '';
      if (msg.includes('does not support tools')) {
        console.error(`\n❌ Provider Error: The model does not support Tool Calling.`);
        console.error(`\n📋 Models that support tools:`);
        console.error(`   - qwen2.5:3b   (recommended, ~1.9GB)`);
        console.error(`   - qwen2.5:7b   (~4.7GB)`);
        console.error(`   - llama3.1:8b  (~4.7GB)`);
        console.error(`\n🚀 Run: ollama pull qwen2.5:3b`);
      } else {
        console.error(`Provider Error: ${safeProviderFailureReason(msg)}`);
      }
    } else {
      console.error(`Error: ${safeProviderFailureReason(err)}`);
    }
    process.exit(1);
    return;
  }
}
