import * as readline from 'readline';
import { LocalRuntimeRepository } from '../../core/runtime/local-runtime-repository';
import { ProviderProfileStore } from '../../core/provider/provider-profile-store';
import { ProviderProfile } from '../../domain/provider-profile';
import { LlmProviderBackendType } from '../../domain/llm-provider-config';

export function createProviderProfileStore(workspaceRoot: string): ProviderProfileStore {
  return new ProviderProfileStore(new LocalRuntimeRepository(workspaceRoot));
}

export function printProviderList(
  activeProvider: string | null,
  profiles: ReadonlyArray<{
    name: string;
    profile: ProviderProfile;
    hasApiKey: boolean;
  }>,
): void {
  console.log('Available providers:');
  if (profiles.length === 0) {
    console.log('  (none — run: agent provider add)');
    return;
  }
  for (const entry of profiles) {
    const active = entry.name === activeProvider;
    const marker = active ? '✓' : ' ';
    console.log(`${marker} ${entry.name}`);
    console.log(`  type: ${entry.profile.type}`);
    console.log(`  baseUrl: ${entry.profile.baseUrl}`);
    if (entry.profile.model) {
      console.log(`  model: ${entry.profile.model}`);
    }
    if (entry.profile.type === 'openai-compatible') {
      console.log(`  apiKey: ${entry.hasApiKey ? '(configured)' : '(missing)'}`);
    }
    console.log('');
  }
}

export function printProviderCurrent(
  name: string,
  profile: ProviderProfile,
  hasApiKey: boolean,
): void {
  console.log('Active provider:');
  console.log(`  name:    ${name}`);
  console.log(`  type:    ${profile.type}`);
  console.log(`  baseUrl: ${profile.baseUrl}`);
  console.log(`  model:   ${profile.model ?? '(default from role assignments)'}`);
  if (profile.type === 'openai-compatible') {
    console.log(`  apiKey:  ${hasApiKey ? '(configured)' : '(missing)'}`);
  }
}

export interface ProviderAddInput {
  readonly name: string;
  readonly type: LlmProviderBackendType;
  readonly baseUrl: string;
  readonly model?: string;
  readonly apiKey?: string;
}

export async function addProviderProfile(
  store: ProviderProfileStore,
  input: ProviderAddInput,
): Promise<void> {
  await store.upsertProfile(
    input.name,
    {
      type: input.type,
      baseUrl: input.baseUrl,
      model: input.model,
    },
    input.apiKey,
  );
  console.log(`Provider profile "${input.name}" saved.`);
}

export async function addProviderProfileInteractive(
  store: ProviderProfileStore,
  lines?: ReadonlyArray<string>,
): Promise<void> {
  const answers = lines ? [...lines] : [];
  const ask = async (prompt: string): Promise<string> => {
    if (answers.length > 0) {
      return (answers.shift() ?? '').trim();
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await new Promise((resolve) => {
        rl.question(prompt, (answer) => resolve(answer.trim()));
      });
    } finally {
      rl.close();
    }
  };

  console.log('Add provider profile');
  const typeRaw = (await ask('Provider type (ollama | openai-compatible) [ollama]: ')).toLowerCase();
  const type: LlmProviderBackendType =
    typeRaw === 'openai-compatible' || typeRaw === 'openai' ? 'openai-compatible' : 'ollama';

  const name = await ask('Profile name: ');
  if (!name) {
    throw new Error('Profile name is required');
  }

  const defaultBase =
    type === 'ollama' ? 'http://localhost:11434' : 'http://127.0.0.1:20128/v1';
  const baseUrl = (await ask(`Base URL [${defaultBase}]: `)) || defaultBase;
  const model = (await ask('Default model (optional): ')) || undefined;

  let apiKey: string | undefined;
  if (type === 'openai-compatible') {
    apiKey = await ask('API key: ');
    if (!apiKey) {
      throw new Error('API key is required for openai-compatible providers');
    }
  }

  await addProviderProfile(store, { name, type, baseUrl, model, apiKey });
}
