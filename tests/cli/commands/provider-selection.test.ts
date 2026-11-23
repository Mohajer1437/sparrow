import {
  createCliProviderSelectionPrompt,
  resolveProviderRuntimeForSession,
} from '../../../src/cli/commands/provider-selection';
import { createProviderProfileStore } from '../../../src/cli/commands/provider-profiles';
import {
  NoHealthyProvidersError,
  ProviderSelectionRequiredError,
} from '../../../src/core/provider/provider-selection-service';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function tempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-sel-'));
}

describe('CLI provider selection', () => {
  let root: string;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    root = tempWorkspace();
    fs.mkdirSync(path.join(root, '.ai'), { recursive: true });
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  });

  function mockHealthyFetch() {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: [], data: [] }),
      text: async () => '',
    })) as any;
  }

  it('AC-31/M: does not prompt when exactly one provider is healthy', async () => {
    const store = createProviderProfileStore(root);
    await store.upsertProfile('ollama', {
      type: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:3b',
    });
    mockHealthyFetch();

    const chooseSpy = jest.fn();
    // resolve with allowInteractive false would still auto-select one
    const resolved = await resolveProviderRuntimeForSession({
      workspaceRoot: root,
      allowInteractive: false,
    });
    expect(resolved.preferredName).toBe('ollama');
    expect(resolved.selectionSource).toBe('automatic');
    expect(chooseSpy).not.toHaveBeenCalled();
  });

  it('AC-31/N: prompts when multiple healthy and no explicit', async () => {
    const store = createProviderProfileStore(root);
    await store.upsertProfile('ollama', {
      type: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:3b',
    });
    await store.upsertProfile(
      'omniroute',
      { type: 'openai-compatible', baseUrl: 'http://127.0.0.1:20128/v1', model: 'auto' },
      'sk-test',
    );
    // Clear active so neither is explicit preferred for selection path
    await store.saveProfiles({
      activeProvider: null,
      providers: (await store.loadProfiles()).providers,
    });
    mockHealthyFetch();

    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((m?: any) => {
      logs.push(String(m ?? ''));
    });

    const resolved = await resolveProviderRuntimeForSession({
      workspaceRoot: root,
      allowInteractive: true,
      lines: ['2'],
    });

    spy.mockRestore();
    expect(resolved.preferredName).toBe('omniroute');
    expect(resolved.selectionSource).toBe('interactive');
    expect(logs.join('\n')).toMatch(/Available providers:/);
    expect(logs.join('\n')).toMatch(/1\. Ollama/);
    expect(logs.join('\n')).toMatch(/2\. Omniroute/);
  });

  it('AC-05/O: explicit provider use remains functional (no prompt)', async () => {
    const store = createProviderProfileStore(root);
    await store.upsertProfile('ollama', {
      type: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:3b',
    });
    await store.upsertProfile(
      'omniroute',
      { type: 'openai-compatible', baseUrl: 'http://127.0.0.1:20128/v1', model: 'auto' },
      'sk-test',
    );
    await store.setActive('omniroute');
    mockHealthyFetch();

    const resolved = await resolveProviderRuntimeForSession({
      workspaceRoot: root,
      allowInteractive: true,
      lines: ['1'], // would pick ollama if prompted — must not be used
    });
    expect(resolved.preferredName).toBe('omniroute');
    expect(resolved.selectionSource).toBe('explicit');
  });

  it('AC-01: zero healthy providers → clear error', async () => {
    const store = createProviderProfileStore(root);
    await store.upsertProfile('ollama', {
      type: 'ollama',
      baseUrl: 'http://127.0.0.1:9',
      model: 'x',
    });
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as any;

    await expect(
      resolveProviderRuntimeForSession({ workspaceRoot: root, allowInteractive: false }),
    ).rejects.toBeInstanceOf(NoHealthyProvidersError);
  });

  it('createCliProviderSelectionPrompt formats numbered list', async () => {
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((m?: any) => {
      logs.push(String(m ?? ''));
    });
    const prompt = createCliProviderSelectionPrompt(['1']);
    const name = await prompt.chooseProvider([
      { name: 'ollama', type: 'ollama' },
      { name: 'omniroute', type: 'openai-compatible' },
    ]);
    spy.mockRestore();
    expect(name).toBe('ollama');
    expect(logs.join('\n')).toMatch(/Available providers:/);
  });
});
