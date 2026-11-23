/**
 * CLI-side provider discovery + interactive selection before a task starts.
 * Core services remain CLI-free; this module only implements the Prompt port.
 */

import * as readline from 'readline';
import { Logger } from '../../contracts/logger';
import { loadEffectiveConfiguration } from '../../core/configuration/default-configuration-loader';
import { AppFactory } from '../../core/app-factory';
import { ProviderAvailabilityService } from '../../core/provider/provider-availability-service';
import {
  NoHealthyProvidersError,
  ProviderSelectionPrompt,
  ProviderSelectionRequiredError,
  ProviderSelectionService,
} from '../../core/provider/provider-selection-service';
import { ProviderRuntimeContext } from '../../core/provider/provider-runtime-context';
import { EffectiveConfiguration } from '../../domain/effective-configuration';
import { LlmProviderSettings } from '../../domain/llm-provider-config';
import { createProviderProfileStore } from './provider-profiles';

export interface ResolveProviderRuntimeOptions {
  readonly workspaceRoot: string;
  readonly logger?: Logger;
  /** Injected answers for tests (non-TTY). */
  readonly lines?: string[];
  /** When false, never prompt — fail if multiple healthy without explicit. Default true for interactive CLI. */
  readonly allowInteractive?: boolean;
  readonly onFailoverMessage?: (message: string) => void;
}

export interface ResolvedProviderRuntime {
  readonly effective: Awaited<ReturnType<typeof loadEffectiveConfiguration>>;
  readonly providerRuntime: ProviderRuntimeContext;
  readonly selectionSource: string;
  readonly preferredName: string;
}

/**
 * Discover healthy providers, select (explicit / automatic / interactive),
 * and return runtime context + effective configuration for AppFactory.
 */
export async function resolveProviderRuntimeForSession(
  options: ResolveProviderRuntimeOptions,
): Promise<ResolvedProviderRuntime> {
  const store = createProviderProfileStore(options.workspaceRoot);
  const availability = new ProviderAvailabilityService(store);
  const report = await availability.discover();

  // No profiles configured → fall back to effective/legacy single provider (no discovery gate)
  if (report.entries.length === 0) {
    const loaded = await loadEffectiveConfiguration(options.workspaceRoot);
    const name = loaded.provider.type === 'openai-compatible'
      ? 'openai-compatible'
      : 'ollama';
    const effective = withSelectedProvider(loaded, {
      type: loaded.provider.type,
      baseUrl: loaded.provider.baseUrl,
      apiKey: loaded.provider.apiKey,
      model: loaded.provider.model ?? loaded.defaultModel,
    });
    return {
      effective,
      preferredName: name,
      selectionSource: 'automatic',
      providerRuntime: {
        preferredName: name,
        orderedCandidates: [{
          name,
          settings: {
            type: effective.provider.type,
            baseUrl: effective.provider.baseUrl,
            apiKey: effective.provider.apiKey,
            model: effective.provider.model ?? effective.defaultModel,
          },
        }],
        selectionSource: 'automatic',
        onFailoverMessage: options.onFailoverMessage
          ?? ((msg) => console.warn(msg)),
      },
    };
  }

  if (report.healthy.length === 0) {
    throw new NoHealthyProvidersError(
      'No healthy providers available. Fix provider connectivity or run: agent provider health',
    );
  }

  const profilesFile = await store.loadProfiles();
  const explicitActive = profilesFile.activeProvider;
  const selectionService = new ProviderSelectionService();

  const promptAllowed = options.lines !== undefined
    || options.allowInteractive === true
    || (options.allowInteractive !== false && Boolean(process.stdin.isTTY && process.stdout.isTTY));
  const prompt: ProviderSelectionPrompt | undefined = promptAllowed
    ? createCliProviderSelectionPrompt(options.lines)
    : undefined;

  const selection = await selectionService.select(
    report.healthy,
    explicitActive,
    prompt,
  ).catch((error: unknown) => {
    if (error instanceof ProviderSelectionRequiredError && !prompt) {
      throw new ProviderSelectionRequiredError(
        'Multiple healthy providers are available. Select one explicitly with: agent provider use <name>',
      );
    }
    throw error;
  });

  const loaded = await loadEffectiveConfiguration(options.workspaceRoot);
  const secrets = await store.loadSecrets();
  const preferred = report.healthy.find((entry) => entry.name === selection.preferredName);
  if (!preferred) {
    throw new ProviderSelectionRequiredError(
      'The selected provider is no longer available. Run provider discovery again.',
    );
  }
  const preferredSettings: LlmProviderSettings = {
    type: preferred.type,
    baseUrl: preferred.baseUrl,
    model: preferred.model ?? loaded.defaultModel,
    apiKey: secrets[preferred.name]?.apiKey,
  };
  const effective = withSelectedProvider(loaded, preferredSettings);
  const orderedCandidates = selection.orderedNames.map((name) => {
    const entry = report.healthy.find((h) => h.name === name)!;
    return {
      name,
      settings: {
        type: entry.type,
        baseUrl: entry.baseUrl,
        model: entry.model ?? loaded.defaultModel,
        apiKey: secrets[name]?.apiKey,
      },
    };
  });

  return {
    effective,
    preferredName: selection.preferredName,
    selectionSource: selection.source,
    providerRuntime: {
      preferredName: selection.preferredName,
      orderedCandidates,
      selectionSource: selection.source,
      onFailoverMessage: options.onFailoverMessage
        ?? ((msg) => console.warn(msg)),
    },
  };
}

function withSelectedProvider(
  effective: EffectiveConfiguration,
  selected: LlmProviderSettings,
): EffectiveConfiguration {
  const model = selected.model ?? effective.defaultModel;
  const provider = Object.freeze({
    ...selected,
    model,
  });

  return Object.freeze({
    ...effective,
    defaultProvider: selected.type,
    defaultModel: model,
    ollamaBaseUrl: selected.type === 'ollama'
      ? selected.baseUrl
      : effective.ollamaBaseUrl,
    provider,
  });
}

export function createCliProviderSelectionPrompt(
  lines?: string[],
): ProviderSelectionPrompt {
  return {
    async chooseProvider(healthy) {
      const listLines = [
        '',
        'Available providers:',
        '',
        ...healthy.map((h, i) => `${i + 1}. ${displayName(h.name)}`),
        '',
      ];
      for (const line of listLines) {
        console.log(line);
      }

      const max = healthy.length;
      const question = `Select provider [1-${max}]: `;

      let answer: string;
      if (lines && lines.length > 0) {
        answer = lines.shift()!.trim();
        console.log(question);
      } else {
        answer = await askQuestion(question);
      }

      const idx = Number.parseInt(answer, 10);
      if (!Number.isFinite(idx) || idx < 1 || idx > max) {
        throw new ProviderSelectionRequiredError(
          `Invalid provider selection. Enter a number between 1 and ${max}.`,
        );
      }
      return healthy[idx - 1].name;
    },
  };
}

function displayName(name: string): string {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function askQuestion(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve((answer || '').trim());
    });
  });
}

/**
 * Build an AppFactory with discovery/selection applied for interactive sessions.
 */
export async function createAppFactoryWithProviderSelection(
  workspaceRoot: string,
  logger: Logger,
  options?: { lines?: string[]; allowInteractive?: boolean },
): Promise<{ factory: AppFactory; resolved: ResolvedProviderRuntime }> {
  const resolved = await resolveProviderRuntimeForSession({
    workspaceRoot,
    logger,
    lines: options?.lines,
    allowInteractive: options?.allowInteractive,
    onFailoverMessage: (msg) => {
      console.warn(msg);
      logger.warn?.(msg);
    },
  });
  const factory = new AppFactory(
    workspaceRoot,
    logger,
    resolved.effective,
    'on',
    resolved.providerRuntime,
  );
  return { factory, resolved };
}
