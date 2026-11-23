import { ProviderAvailabilityService } from '../../../src/core/provider/provider-availability-service';
import { ProviderProfileStore } from '../../../src/core/provider/provider-profile-store';
import { LocalRuntimeRepository } from '../../../src/core/runtime/local-runtime-repository';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function tempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-avail-'));
}

describe('ProviderAvailabilityService', () => {
  let root: string;
  let store: ProviderProfileStore;

  beforeEach(() => {
    root = tempWorkspace();
    fs.mkdirSync(path.join(root, '.ai'), { recursive: true });
    store = new ProviderProfileStore(new LocalRuntimeRepository(root));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('AC-01/P: missing API key is never healthy merely because profile exists', async () => {
    await store.upsertProfile(
      'omniroute',
      { type: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', model: 'auto' },
      'sk-temp',
    );
    // Wipe secret after upsert
    await store.saveSecrets({});

    const report = await new ProviderAvailabilityService(store).discover();
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].hasApiKey).toBe(false);
    expect(report.entries[0].healthy).toBe(false);
    expect(report.healthy).toHaveLength(0);
    expect(report.entries[0].health.status).toBe('unauthorized');
  });

  it('AC-26: availability is based on actual health status healthy', async () => {
    await store.upsertProfile(
      'ollama',
      { type: 'ollama', baseUrl: 'http://127.0.0.1:9', model: 'qwen2.5:3b' },
    );

    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as any;

    try {
      const report = await new ProviderAvailabilityService(store).discover();
      expect(report.healthy).toHaveLength(0);
      expect(report.entries[0].health.status).toBe('unavailable');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('AC-02: one healthy provider is reported', async () => {
    await store.upsertProfile(
      'ollama',
      { type: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:3b' },
    );

    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: [] }),
      text: async () => '',
    })) as any;

    try {
      const report = await new ProviderAvailabilityService(store).discover();
      expect(report.healthy).toHaveLength(1);
      expect(report.healthy[0].name).toBe('ollama');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('AC-03: multiple healthy providers are all reported in sorted order', async () => {
    await store.upsertProfile(
      'omniroute',
      { type: 'openai-compatible', baseUrl: 'http://127.0.0.1:20128/v1', model: 'auto' },
      'sk-test',
    );
    await store.upsertProfile(
      'ollama',
      { type: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:3b' },
    );

    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: [], data: [] }),
      text: async () => '',
    })) as any;

    try {
      const report = await new ProviderAvailabilityService(store).discover();
      expect(report.healthy.map((h) => h.name)).toEqual(['ollama', 'omniroute']);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
