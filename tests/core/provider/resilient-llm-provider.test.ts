import { ResilientLlmProvider } from '../../../src/core/provider/resilient-llm-provider';
import {
  ProviderAuthenticationError,
  ProviderError,
  ProviderExhaustedError,
  ProviderRateLimitError,
  ProviderUnavailableError,
} from '../../../src/domain/errors/provider-errors';
import { Provider, ModelRequest, ModelResponse } from '../../../src/contracts/provider';

class SeqFakeProvider implements Provider {
  public callCount = 0;
  constructor(
    private readonly behavior: Array<'ok' | Error>,
    public readonly label: string,
  ) {}
  async generate(_request: ModelRequest): Promise<ModelResponse> {
    const step = this.behavior[Math.min(this.callCount, this.behavior.length - 1)];
    this.callCount++;
    if (step instanceof Error) throw step;
    return {
      content: `ok:${this.label}`,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
  }
}

const req: ModelRequest = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'hello' }],
};

describe('ResilientLlmProvider', () => {
  it('AC-06/D: selected provider succeeds → no failover', async () => {
    const a = new SeqFakeProvider(['ok'], 'A');
    const b = new SeqFakeProvider(['ok'], 'B');
    const messages: string[] = [];
    const resilient = new ResilientLlmProvider({
      candidates: [
        { name: 'A', provider: a },
        { name: 'B', provider: b },
      ],
      preferredName: 'A',
      onFailoverMessage: (m) => messages.push(m),
    });
    const res = await resilient.generate(req);
    expect(res.content).toBe('ok:A');
    expect(a.callCount).toBe(1);
    expect(b.callCount).toBe(0);
    expect(messages).toHaveLength(0);
  });

  it('AC-07/E: connection failure → next provider used', async () => {
    const a = new SeqFakeProvider(
      [new ProviderUnavailableError('connection refused')],
      'A',
    );
    const b = new SeqFakeProvider(['ok'], 'B');
    const messages: string[] = [];
    const resilient = new ResilientLlmProvider({
      candidates: [
        { name: 'A', provider: a },
        { name: 'B', provider: b },
      ],
      preferredName: 'A',
      onFailoverMessage: (m) => messages.push(m),
    });
    const res = await resilient.generate(req);
    expect(res.content).toBe('ok:B');
    expect(a.callCount).toBe(1);
    expect(b.callCount).toBe(1);
    expect(messages[0]).toMatch(/Provider "A" failed/);
    expect(messages[0]).toMatch(/Switching to provider "B"/);
  });

  it('AC-11/F: HTTP 503 → failover', async () => {
    const a = new SeqFakeProvider(
      [new ProviderUnavailableError('unavailable: HTTP 503')],
      'A',
    );
    const b = new SeqFakeProvider(['ok'], 'B');
    const resilient = new ResilientLlmProvider({
      candidates: [
        { name: 'A', provider: a },
        { name: 'B', provider: b },
      ],
    });
    await expect(resilient.generate(req)).resolves.toMatchObject({ content: 'ok:B' });
  });

  it('AC-09/G: HTTP 429 → failover', async () => {
    const a = new SeqFakeProvider([new ProviderRateLimitError('HTTP 429')], 'A');
    const b = new SeqFakeProvider(['ok'], 'B');
    const resilient = new ResilientLlmProvider({
      candidates: [
        { name: 'A', provider: a },
        { name: 'B', provider: b },
      ],
    });
    await expect(resilient.generate(req)).resolves.toMatchObject({ content: 'ok:B' });
  });

  it('AC-13/H: application/request error → NO failover', async () => {
    const a = new SeqFakeProvider([new ProviderError('malformed request')], 'A');
    const b = new SeqFakeProvider(['ok'], 'B');
    const resilient = new ResilientLlmProvider({
      candidates: [
        { name: 'A', provider: a },
        { name: 'B', provider: b },
      ],
    });
    await expect(resilient.generate(req)).rejects.toBeInstanceOf(ProviderError);
    expect(b.callCount).toBe(0);
  });

  it('AC-13: authentication error → NO failover', async () => {
    const a = new SeqFakeProvider(
      [new ProviderAuthenticationError('bad key')],
      'A',
    );
    const b = new SeqFakeProvider(['ok'], 'B');
    const resilient = new ResilientLlmProvider({
      candidates: [
        { name: 'A', provider: a },
        { name: 'B', provider: b },
      ],
    });
    await expect(resilient.generate(req)).rejects.toBeInstanceOf(ProviderAuthenticationError);
    expect(b.callCount).toBe(0);
  });

  it('AC-14/I: first fails, second succeeds → exactly one retry of same operation', async () => {
    const a = new SeqFakeProvider(
      [new ProviderUnavailableError('down')],
      'A',
    );
    const b = new SeqFakeProvider(['ok'], 'B');
    const resilient = new ResilientLlmProvider({
      candidates: [
        { name: 'A', provider: a },
        { name: 'B', provider: b },
      ],
    });
    await resilient.generate(req);
    expect(a.callCount).toBe(1);
    expect(b.callCount).toBe(1);
  });

  it('AC-15/J: first two fail, third succeeds → deterministic cascade', async () => {
    const a = new SeqFakeProvider([new ProviderUnavailableError('a')], 'A');
    const b = new SeqFakeProvider([new ProviderUnavailableError('b')], 'B');
    const c = new SeqFakeProvider(['ok'], 'C');
    const resilient = new ResilientLlmProvider({
      candidates: [
        { name: 'A', provider: a },
        { name: 'B', provider: b },
        { name: 'C', provider: c },
      ],
      preferredName: 'A',
    });
    const res = await resilient.generate(req);
    expect(res.content).toBe('ok:C');
    expect(a.callCount).toBe(1);
    expect(b.callCount).toBe(1);
    expect(c.callCount).toBe(1);
  });

  it('AC-16/K: all providers fail → aggregated exhaustion', async () => {
    const a = new SeqFakeProvider([new ProviderUnavailableError('a')], 'A');
    const b = new SeqFakeProvider([new ProviderUnavailableError('b')], 'B');
    const resilient = new ResilientLlmProvider({
      candidates: [
        { name: 'A', provider: a },
        { name: 'B', provider: b },
      ],
    });
    try {
      await resilient.generate(req);
      fail('expected exhaustion');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ProviderExhaustedError);
      expect(err.message).toMatch(/All available providers failed/);
      expect(err.attempts).toHaveLength(2);
      expect(err.attempts[0].providerName).toBe('A');
      expect(err.attempts[1].providerName).toBe('B');
    }
  });

  it('AC-17/L: failed provider is not retried within same operation', async () => {
    let calls = 0;
    const flaky: Provider = {
      async generate() {
        calls++;
        throw new ProviderUnavailableError('always down');
      },
    };
    const ok = new SeqFakeProvider(['ok'], 'B');
    const resilient = new ResilientLlmProvider({
      candidates: [
        { name: 'A', provider: flaky },
        { name: 'B', provider: ok },
      ],
    });
    await resilient.generate(req);
    expect(calls).toBe(1);
    // Second generate in same session should skip A
    await resilient.generate(req);
    expect(calls).toBe(1);
    expect(ok.callCount).toBe(2);
  });

  it('AC-18: identical logical ModelRequest payload is passed to failover candidate', async () => {
    const seen: ModelRequest[] = [];
    const a: Provider = {
      async generate(r) {
        seen.push(r);
        throw new ProviderUnavailableError('down');
      },
    };
    const b: Provider = {
      async generate(r) {
        seen.push(r);
        return { content: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      },
    };
    const resilient = new ResilientLlmProvider({
      candidates: [
        { name: 'A', provider: a },
        { name: 'B', provider: b },
      ],
    });
    await resilient.generate(req);
    expect(seen).toHaveLength(2);
    // Same logical payload; attempt-specific AbortSignal may differ (AC-08).
    for (const r of seen) {
      expect(r.model).toBe(req.model);
      expect(r.messages).toEqual(req.messages);
      expect(r.temperature).toBe(req.temperature);
      expect(r.maxTokens).toBe(req.maxTokens);
      expect(r.tools).toEqual(req.tools);
    }
  });

  it('AC-24: exhaustion attempts do not include secrets', async () => {
    const a = new SeqFakeProvider(
      [new ProviderUnavailableError('Bearer sk-secretkey123456789 failed')],
      'A',
    );
    const resilient = new ResilientLlmProvider({
      candidates: [{ name: 'A', provider: a }],
    });
    try {
      await resilient.generate(req);
      fail('expected exhaustion');
    } catch (err: any) {
      const blob = JSON.stringify(err.attempts);
      expect(blob).not.toMatch(/sk-secretkey/);
      expect(blob).toMatch(/\*\*\*/);
    }
  });
});
