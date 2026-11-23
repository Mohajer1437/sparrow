import { AppFactory } from '../../core/app-factory';
import { Logger } from '../../contracts/logger';
import { resolveWorkspaceRoot } from '../workspace-resolver';
import { createWebServer } from '../../web/web-server';

/**
 * Starts the read-only observability UI/API for the current workspace.
 *
 * The workspace root comes from the same resolver the rest of the CLI uses, so
 * the Web layer cannot introduce a second workspace mechanism, and no request
 * can change it.
 */
export async function serveCommand(args: ReadonlyArray<string>): Promise<void> {
  const port = parsePort(readOption(args, '--port')) ?? 4177;
  const host = readOption(args, '--host') ?? '127.0.0.1';

  const logger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  const workspaceRoot = await resolveWorkspaceRoot();
  const factory = new AppFactory(workspaceRoot, logger);
  try {
    await factory.discoverOllamaModels();
  } catch {
    // Best-effort model discovery on server start
  }
  const commandService = factory.createApplicationCommandService();

  const { listen } = createWebServer(
    commandService,
    { port, host },
  );
  try {
    const started = await listen();
    console.log('Sparrow operator console');
    console.log(`Workspace: ${factory.workspaceRoot}`);
    console.log(`URL:       ${started.url}`);
    console.log('Press Ctrl+C to stop.');

    const shutdown = async () => {
      await started.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error: any) {
    console.error(`Failed to start web server on ${host}:${port}: ${error.message}`);
    process.exit(1);
  }
}

function readOption(args: ReadonlyArray<string>, name: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  const inline = args.find(arg => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : undefined;
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) return undefined;
  return parsed;
}
