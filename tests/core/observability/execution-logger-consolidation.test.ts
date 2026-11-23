import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ExecutionLogger } from '../../../src/core/observability/execution-logger';

describe('ExecutionLogger — Consolidation + Noise Filter', () => {
  const tmpDir = path.join(os.tmpdir(), `sparrow-log-test-${Date.now()}`);
  let originalConsoleLog: typeof console.log;
  let consoleOutput: string[] = [];

  beforeAll(() => {
    fs.mkdirSync(path.join(tmpDir, '.ai', 'logs', 'pipeline'), { recursive: true });
    originalConsoleLog = console.log;
    console.log = (...args: any[]) => {
      consoleOutput.push(args.join(' '));
    };
  });

  afterAll(() => {
    console.log = originalConsoleLog;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    consoleOutput = [];
    // Clear existing log files to ensure test isolation
    const logDir = path.join(tmpDir, '.ai', 'logs', 'pipeline');
    if (fs.existsSync(logDir)) {
      fs.readdirSync(logDir).forEach(f => {
        fs.unlinkSync(path.join(logDir, f));
      });
    }
    // Reset internal state by re-initing
    ExecutionLogger.init(tmpDir, 'test-session');
  });

  it('writes all non-noisy logs to a SINGLE file per session', () => {
    ExecutionLogger.log('WORKFLOW', '-', '-', 'Session started');
    ExecutionLogger.log('STEP', '-', '-', 'Step 1/3');
    ExecutionLogger.log('STEP', '-', '-', 'Step 2/3');
    ExecutionLogger.log('STEP', '-', '-', 'Step 3/3');
    ExecutionLogger.log('REFLECTION', '-', '-', 'Reflection generated: success');

    const logDir = path.join(tmpDir, '.ai', 'logs', 'pipeline');
    const files = fs.readdirSync(logDir).filter(f => f.includes('test-session'));
    
    expect(files.length).toBe(1);

    const content = fs.readFileSync(path.join(logDir, files[0]), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(5);
  });

  it('filters PROVIDER logs from file but keeps them in terminal', () => {
    ExecutionLogger.log('WORKFLOW', '-', '-', 'Session started');
    ExecutionLogger.log('PROVIDER', 'coder', 'qwen2.5-coder:7b', 'Prompt sent to LLM');
    ExecutionLogger.log('PROVIDER', 'coder', 'qwen2.5-coder:7b', 'LLM Response: 1 tool calls');
    ExecutionLogger.log('TOOL', '-', '-', 'Tool read_file completed');

    const logDir = path.join(tmpDir, '.ai', 'logs', 'pipeline');
    const files = fs.readdirSync(logDir).filter(f => f.includes('test-session'));
    const content = fs.readFileSync(path.join(logDir, files[0]), 'utf-8');
    const lines = content.trim().split('\n');

    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('WORKFLOW');
    expect(lines[1]).toContain('TOOL');

    expect(consoleOutput.length).toBe(4);
    expect(consoleOutput.some(line => line.includes('PROVIDER'))).toBe(true);
  });

  it('persists PROVIDER_META while still filtering verbose PROVIDER', () => {
    ExecutionLogger.log('PROVIDER', 'coder', 'gpt-oss:20b-cloud', 'Prompt sent to LLM', {
      systemPrompt: 'do-not-persist',
    });
    ExecutionLogger.log('PROVIDER_META', 'executor', 'gpt-oss:20b-cloud', 'chat attempt seq=1 status=200 retry=0', {
      stage: 'executor',
      requestSeq: 1,
      retryAttempt: 0,
      isRetry: false,
      messageCount: 2,
      promptChars: 100,
      toolCount: 3,
      startedAt: '2026-09-20T21:42:20.123Z',
      durationMs: 10,
      httpStatus: 200,
      success: true,
    });

    const logDir = path.join(tmpDir, '.ai', 'logs', 'pipeline');
    const files = fs.readdirSync(logDir).filter(f => f.includes('test-session'));
    const content = fs.readFileSync(path.join(logDir, files[0]), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]);
    expect(event.phase).toBe('PROVIDER_META');
    expect(event.requestSeq).toBe(1);
    expect(content).not.toContain('do-not-persist');
    expect(content).not.toContain('"phase":"PROVIDER"');
  });

  it('all log phases still appear in terminal output', () => {
    const phases = ['REPL', 'AGENT', 'WORKFLOW', 'STEP', 'EXECUTION', 'PROVIDER', 'TOOL', 'REFLECTION'];
    for (const phase of phases) {
      ExecutionLogger.log(phase, '-', '-', `Test ${phase}`);
    }
    expect(consoleOutput.length).toBe(phases.length);
  });
});
