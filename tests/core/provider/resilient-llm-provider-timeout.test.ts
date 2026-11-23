/**
 * AC-08 timeout failover — proves fresh AbortSignal per attempt,
 * real HTTP hang→failover, caller cancellation safety, and
 * TaskExecutionService non-duplication of the outer operation.
 */
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AddressInfo } from 'net';
import { ResilientLlmProvider } from '../../../src/core/provider/resilient-llm-provider';
import { OllamaProvider } from '../../../src/core/provider/ollama-provider';
import {
  ProviderAuthenticationError,
  ProviderError,
  ProviderExhaustedError,
  ProviderModelNotFoundError,
  ProviderRateLimitError,
  ProviderUnavailableError,
} from '../../../src/domain/errors/provider-errors';
import { Provider, ModelRequest, ModelResponse } from '../../../src/contracts/provider';
import { FileTaskRunStore } from '../../../src/app/file-task-run-store';
import { TaskExecutionService } from '../../../src/app/task-execution-service';
import { makeWorkflowResult } from '../../app/fixtures/run-fixtures';

const baseReq: ModelRequest = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'hello-ac08' }],
  temperature: 0,
  maxTokens: 16,
};

class RecordingProvider implements Provider {
  public calls: ModelRequest[] = [];
  constructor(
    private readonly impl: (req: ModelRequest, seq: number) => Promise<ModelResponse>,
  ) {}
  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.calls.push(request);
    return this.impl(request, this.calls.length);
  }
}

function ollamaOkBody(model: string): string {
  return JSON.stringify({
    model,
    message: { role: 'assistant', content: 'PONG' },
    done: true,
  });
}

async function listen(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => void,
): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => handler(req, res, Buffer.concat(chunks)));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    port,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

describe('ResilientLlmProvider AC-08 timeout failover', () => {
  it('A: attempt timeout → fresh signal on B → B succeeds', async () => {
    const seenSignals: AbortSignal[] = [];
    const aHang = new RecordingProvider(async (req) => {
      seenSignals.push(req.signal!);
      expect(req.signal?.aborted).toBe(false);
      await new Promise<void>((resolve) => {
        if (req.signal?.aborted) resolve();
        else req.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      throw new ProviderUnavailableError(
        'Ollama request timed out or was aborted: This operation was aborted',
      );
    });
    const b = new RecordingProvider(async (req) => {
      seenSignals.push(req.signal!);
      expect(req.signal?.aborted).toBe(false);
      return {
        content: 'ok:B',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });

    const resilient = new ResilientLlmProvider({
      candidates: [
        { name: 'A', provider: aHang },
        { name: 'B', provider: b },
      ],
      preferredName: 'A',
      attemptTimeoutMs: 80,
    });

    const res = await resilient.generate(baseReq);
    expect(res.content).toBe('ok:B');
    expect(aHang.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
    expect(seenSignals[0]).not.toBe(seenSignals[1]);
    expect(seenSignals[0].aborted).toBe(true);
    expect(seenSignals[1].aborted).toBe(false);
    expect(b.calls[0].messages).toEqual(baseReq.messages);
    expect(b.calls[0].model).toBe(baseReq.model);
  });

  it('B: timeout → timeout → success (A/B/C each one attempt)', async () => {
    const hang = (label: string) =>
      new RecordingProvider(async (req) => {
        await new Promise<void>((resolve) => {
          if (req.signal?.aborted) resolve();
          else req.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new ProviderUnavailableError(
          `Ollama request timed out or was aborted: ${label}`,
        );
      });
    const a = hang('A');
    const b = hang('B');
    const c = new RecordingProvider(async (req) => {
      expect(req.signal?.aborted).toBe(false);
      return {
        content: 'ok:C',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });
    const resilient = new ResilientLlmProvider({
      candidates: [
        { name: 'A', provider: a },
        { name: 'B', provider: b },
        { name: 'C', provider: c },
      ],
      preferredName: 'A',
      attemptTimeoutMs: 60,
    });
    const res = await resilient.generate(baseReq);
    expect(res.content).toBe('ok:C');
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
    expect(c.calls).toHaveLength(1);
  });

  it('C: all attempt timeouts → ProviderExhaustedError once each', async () => {
    const hang = () =>
      new RecordingProvider(async (req) => {
        await new Promise<void>((resolve) => {
          if (req.signal?.aborted) resolve();
          else req.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new ProviderUnavailableError(
          'Ollama request timed out or was aborted: This operation was aborted',
        );
      });
    const a = hang();
    const b = hang();
    const resilient = new ResilientLlmProvider({
      candidates: [
        { name: 'A', provider: a },
        { name: 'B', provider: b },
      ],
      attemptTimeoutMs: 50,
    });
    await expect(resilient.generate(baseReq)).rejects.toBeInstanceOf(ProviderExhaustedError);
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
  });

  it('D: caller cancellation does not failover', async () => {
    const caller = new AbortController();
    let bCalls = 0;
    const a = new RecordingProvider(async (req) => {
      // Simulate work; caller cancels mid-flight.
      setTimeout(() => caller.abort(), 20);
      await new Promise<void>((resolve) => {
        if (req.signal?.aborted) resolve();
        else req.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      throw new ProviderUnavailableError(
        'Ollama request timed out or was aborted: This operation was aborted',
      );
    });
    const b = new RecordingProvider(async () => {
      bCalls++;
      return {
        content: 'ok:B',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });
    const resilient = new ResilientLlmProvider({
      candidates: [
        { name: 'A', provider: a },
        { name: 'B', provider: b },
      ],
      attemptTimeoutMs: 5_000,
    });
    await expect(
      resilient.generate({ ...baseReq, signal: caller.signal }),
    ).rejects.toBeTruthy();
    expect(bCalls).toBe(0);
    expect(b.calls).toHaveLength(0);
  });

  it('D2: already-aborted caller signal does not start providers', async () => {
    const caller = new AbortController();
    caller.abort();
    const a = new RecordingProvider(async () => ({
      content: 'nope',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }));
    const resilient = new ResilientLlmProvider({
      candidates: [{ name: 'A', provider: a }],
    });
    await expect(
      resilient.generate({ ...baseReq, signal: caller.signal }),
    ).rejects.toBeTruthy();
    expect(a.calls).toHaveLength(0);
  });

  it('E: connection / 429 / 502 / 503 / 504 still failover', async () => {
    const cases: Array<{ err: Error; label: string }> = [
      { err: new ProviderUnavailableError('connection refused'), label: 'conn' },
      { err: new ProviderRateLimitError('HTTP 429'), label: '429' },
      { err: new ProviderUnavailableError('HTTP 502'), label: '502' },
      { err: new ProviderUnavailableError('HTTP 503'), label: '503' },
      { err: new ProviderUnavailableError('HTTP 504'), label: '504' },
    ];
    for (const c of cases) {
      const a = new RecordingProvider(async () => {
        throw c.err;
      });
      const b = new RecordingProvider(async () => ({
        content: `ok:${c.label}`,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }));
      const resilient = new ResilientLlmProvider({
        candidates: [
          { name: 'A', provider: a },
          { name: 'B', provider: b },
        ],
      });
      await expect(resilient.generate(baseReq)).resolves.toMatchObject({
        content: `ok:${c.label}`,
      });
      expect(b.calls).toHaveLength(1);
    }
  });

  it('F: non-retryable errors do not failover', async () => {
    const cases: Error[] = [
      new ProviderError('malformed / HTTP 400'),
      new ProviderAuthenticationError('bad key'),
      new ProviderModelNotFoundError('missing model'),
    ];
    for (const err of cases) {
      const a = new RecordingProvider(async () => {
        throw err;
      });
      const b = new RecordingProvider(async () => ({
        content: 'ok',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }));
      const resilient = new ResilientLlmProvider({
        candidates: [
          { name: 'A', provider: a },
          { name: 'B', provider: b },
        ],
      });
      await expect(resilient.generate(baseReq)).rejects.toBe(err);
      expect(b.calls).toHaveLength(0);
    }
  });

  it('G: logical request identity preserved across timeout failover', async () => {
    const seen: ModelRequest[] = [];
    const a = new RecordingProvider(async (req) => {
      seen.push(req);
      await new Promise<void>((resolve) => {
        if (req.signal?.aborted) resolve();
        else req.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      throw new ProviderUnavailableError(
        'Ollama request timed out or was aborted: This operation was aborted',
      );
    });
    const b = new RecordingProvider(async (req) => {
      seen.push(req);
      return {
        content: 'ok',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });
    const tools = [{ name: 't', description: 'd', parameters: { type: 'object' } }];
    const req: ModelRequest = {
      ...baseReq,
      tools,
      observability: { stage: 'planner', retryAttempt: 0 },
    };
    const resilient = new ResilientLlmProvider({
      candidates: [
        { name: 'A', provider: a },
        { name: 'B', provider: b },
      ],
      attemptTimeoutMs: 50,
    });
    await resilient.generate(req);
    expect(seen).toHaveLength(2);
    expect(seen[0].signal).not.toBe(seen[1].signal);
    expect(seen[0].messages).toEqual(req.messages);
    expect(seen[1].messages).toEqual(req.messages);
    expect(seen[0].model).toBe(req.model);
    expect(seen[1].model).toBe(req.model);
    expect(seen[0].tools).toEqual(tools);
    expect(seen[1].tools).toEqual(tools);
    expect(seen[0].observability).toEqual(req.observability);
    expect(seen[1].observability).toEqual(req.observability);
  });

  it('H: TaskExecutionService outer operation is not duplicated by provider failover', async () => {
    const hangThen = new RecordingProvider(async (req) => {
      await new Promise<void>((resolve) => {
        if (req.signal?.aborted) resolve();
        else req.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      throw new ProviderUnavailableError(
        'Ollama request timed out or was aborted: This operation was aborted',
      );
    });
    const ok = new RecordingProvider(async () => ({
      content: 'planned',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }));
    const resilient = new ResilientLlmProvider({
      candidates: [
        { name: 'A', provider: hangThen },
        { name: 'B', provider: ok },
      ],
      attemptTimeoutMs: 50,
    });

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-ac08-tes-'));
    const store = new FileTaskRunStore(root);
    let orchestratorCalls = 0;
    let generateCallsFromOrchestrator = 0;
    const service = new TaskExecutionService(
      {
        execute: async () => {
          orchestratorCalls++;
          generateCallsFromOrchestrator++;
          // Single logical LLM op inside the one orchestrator invocation
          const out = await resilient.generate(baseReq);
          return {
            roleId: 'coder',
            success: true,
            workflowResult: makeWorkflowResult({
              success: true,
              plan: {
                id: 'plan-1',
                steps: [{ id: 'step-1', description: out.content, requiredTools: [] }],
              } as any,
            }),
          } as any;
        },
      },
      store,
      root,
    );

    const outcome = await service.execute({ task: 'AC-08 no duplication' });
    expect(orchestratorCalls).toBe(1);
    expect(generateCallsFromOrchestrator).toBe(1);
    expect(hangThen.calls).toHaveLength(1);
    expect(ok.calls).toHaveLength(1);
    expect(outcome.runId).toBeDefined();
    const runs = await store.list();
    expect(runs).toHaveLength(1);
    expect(runs[0].runId).toBe(outcome.runId);
    expect(runs[0].taskId).toBe(outcome.taskId);
  });

  it('I: real HTTP hang on A then B receives an actual HTTP request', async () => {
    let aHits = 0;
    let bHits = 0;
    const hang = await listen((req, res) => {
      if (req.url?.startsWith('/api/tags')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [] }));
        return;
      }
      if (req.url?.startsWith('/api/chat')) {
        aHits++;
        // Accept connection but never respond — attempt timeout must abort.
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const ok = await listen((req, res) => {
      if (req.url?.startsWith('/api/tags')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [] }));
        return;
      }
      if (req.url?.startsWith('/api/chat')) {
        bHits++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(ollamaOkBody('test-model'));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    try {
      const resilient = new ResilientLlmProvider({
        candidates: [
          { name: 'A', provider: new OllamaProvider(`http://127.0.0.1:${hang.port}`) },
          { name: 'B', provider: new OllamaProvider(`http://127.0.0.1:${ok.port}`) },
        ],
        preferredName: 'A',
        attemptTimeoutMs: 150,
      });
      const res = await resilient.generate({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Reply PONG' }],
      });
      expect(res.content).toBe('PONG');
      expect(aHits).toBe(1);
      expect(bHits).toBe(1);
    } finally {
      await hang.close();
      await ok.close();
    }
  });
});
