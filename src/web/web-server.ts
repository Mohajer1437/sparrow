import * as http from 'http';
import { TaskQueryService } from '../app/task-query-service';
import { ReliabilityService, parseAggregationOptions } from '../app/reliability-service';
import { ConfirmationService } from '../app/confirmation-service';
import { ConfirmationStatus } from '../domain/confirmation';
import { PLATFORM_API_VERSION, buildCapabilityCatalog } from '../app/platform-capabilities';
import {
  ApplicationCommandService,
  ExecuteTaskCommand,
} from '../app/application-command-service';
import { TaskExecutionService } from '../app/task-execution-service';
import {
  InterfaceErrorBody,
  classifyError,
  httpStatusFor,
  toInterfaceErrorBody,
} from '../app/interface-error';
import { renderIndexHtml } from './ui/index-html';

export interface WebServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly pollIntervalMs?: number;
  readonly commandService?: ApplicationCommandService;
  readonly executionService?: TaskExecutionService;
}

export interface StartedWebServer {
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

const DEFAULT_PORT = 4177;
/** Loopback only: the operator UI is local to 127.0.0.1 */
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_POLL_MS = 1000;
const HEARTBEAT_MS = 15000;

/**
 * Local Operator HTTP and SSE surface over the Application Command & Query Layer (UI-2.1).
 *
 * Exposes:
 * - Structured task execution & cancellation commands
 * - Full read-only domain queries for all pipeline stages
 * - Exact pipeline log file correlation & controlled raw viewer
 * - Reconnect-capable SSE streams with run isolation
 * - Human-in-the-loop confirmation & ephemeral test credential submission
 */
export function createWebServer(
  queriesOrCommands: TaskQueryService | ApplicationCommandService,
  options?: WebServerOptions,
  reliability?: ReliabilityService,
  confirmation?: ConfirmationService,
  commandsArg?: ApplicationCommandService | TaskExecutionService,
): { server: http.Server; listen(): Promise<StartedWebServer> } {
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_MS;
  const streams = new Set<{ res: http.ServerResponse; timer: NodeJS.Timeout }>();

  let queries: TaskQueryService;
  let commands: ApplicationCommandService | undefined;

  if (queriesOrCommands instanceof ApplicationCommandService) {
    commands = queriesOrCommands;
    queries = queriesOrCommands.getQueries();
    reliability = reliability ?? queriesOrCommands.getReliabilityService();
    confirmation = confirmation ?? queriesOrCommands.getConfirmationService();
  } else {
    queries = queriesOrCommands;
    if (options?.commandService) {
      commands = options.commandService;
    } else if (commandsArg instanceof ApplicationCommandService) {
      commands = commandsArg;
    } else if (commandsArg instanceof TaskExecutionService) {
      commands = new ApplicationCommandService(
        commandsArg,
        queries,
        confirmation,
        reliability,
      );
    } else if (options?.executionService) {
      commands = new ApplicationCommandService(
        options.executionService,
        queries,
        confirmation,
        reliability,
      );
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      sendError(res, toInterfaceErrorBody('INTERNAL_ERROR', 'The request could not be completed'));
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const rawPath = req.url ?? '/';

    const url = new URL(rawPath, 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);

    let apiSegments = segments;
    if (apiSegments[0] === 'api') apiSegments = apiSegments.slice(1);
    if (apiSegments[0] === PLATFORM_API_VERSION) apiSegments = apiSegments.slice(1);

    const isMutatingRoute =
      method === 'POST'
      && (apiSegments[0] === 'confirmations'
        || apiSegments[0] === 'execute'
        || (apiSegments[0] === 'tasks' && apiSegments[1] === 'execute')
        || (apiSegments[0] === 'commands' && apiSegments[1] === 'execute')
        || (apiSegments[0] === 'tasks' && apiSegments[2] === 'cancel')
        || (apiSegments[0] === 'runs' && apiSegments[2] === 'cancel'));

    if (method !== 'GET' && method !== 'HEAD' && !isMutatingRoute) {
      sendError(res, toInterfaceErrorBody('METHOD_NOT_ALLOWED', 'The method is not allowed on this endpoint'));
      return;
    }

    if (segments.length === 0) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(renderIndexHtml());
      return;
    }

    if (segments[0] !== 'api') {
      sendError(res, toInterfaceErrorBody('NOT_FOUND', 'Unknown path'));
      return;
    }

    try {
      await handleApi(apiSegments, url, req, res);
    } catch (error) {
      sendError(res, classifyError(error));
    }
  }

  async function handleApi(
    segments: ReadonlyArray<string>,
    url: URL,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const [first, second, third, fourth, fifth, sixth] = segments;

    // --- Task Execution Commands (UI-2.2, UI-2.3, UI-2.39) ---
    if (
      (first === 'execute' && segments.length === 1 && method === 'POST')
      || (first === 'tasks' && second === 'execute' && segments.length === 2 && method === 'POST')
      || (first === 'commands' && second === 'execute' && segments.length === 2 && method === 'POST')
    ) {
      if (!commands) {
        sendError(res, toInterfaceErrorBody(
          'NOT_IMPLEMENTED',
          'Task execution command service is not configured',
          'EXECUTION_UNAVAILABLE',
        ));
        return;
      }
      const body = await readJsonBody(req);
      const taskText = typeof body.task === 'string' ? body.task.trim() : '';
      if (!taskText) {
        sendError(res, toInterfaceErrorBody('VALIDATION_ERROR', 'Task prompt is required'));
        return;
      }
      const execCommand: ExecuteTaskCommand = {
        task: taskText,
        executionMode: body.executionMode,
        roleId: body.roleId,
        targetFiles: Array.isArray(body.targetFiles) ? body.targetFiles : undefined,
        requestedCapabilities: Array.isArray(body.requestedCapabilities) ? body.requestedCapabilities : undefined,
        confirmationContext: body.confirmationContext,
        taskId: body.taskId,
        runId: body.runId,
        sessionId: body.sessionId,
        idempotencyKey: body.idempotencyKey,
        waitForCompletion: body.waitForCompletion === true,
      };
      const result = await commands.executeTask(execCommand);
      sendJson(res, 200, result);
      return;
    }

    // --- Task Cancellation Command (UI-2.39) ---
    if (
      (first === 'tasks' && second && third === 'cancel' && segments.length === 3 && method === 'POST')
      || (first === 'runs' && second && third === 'cancel' && segments.length === 3 && method === 'POST')
    ) {
      if (!commands) {
        sendError(res, toInterfaceErrorBody(
          'NOT_IMPLEMENTED',
          'Task cancellation service is not configured',
          'CANCELLATION_UNAVAILABLE',
        ));
        return;
      }
      const body = await readJsonBody(req);
      const isRun = first === 'runs';
      const outcome = await commands.cancelTask({
        taskId: isRun ? '' : second,
        runId: isRun ? second : undefined,
        reason: body.reason,
        actor: body.actor ?? 'web-operator',
      });
      sendJson(res, 200, outcome);
      return;
    }

    // --- Confirmations API (UI-2.26, UI-2.27) ---
    if (first === 'confirmations') {
      if (!confirmation && !commands) {
        sendError(res, toInterfaceErrorBody(
          'NOT_IMPLEMENTED',
          'Confirmation service is not configured',
          'CONFIRMATION_UNAVAILABLE',
        ));
        return;
      }
      const conf = confirmation ?? commands?.getConfirmationService();
      if (!conf) {
        sendError(res, toInterfaceErrorBody(
          'NOT_IMPLEMENTED',
          'Confirmation service is not configured',
          'CONFIRMATION_UNAVAILABLE',
        ));
        return;
      }

      if (segments.length === 1 && method === 'GET') {
        const status = url.searchParams.get('status') as ConfirmationStatus | null;
        const taskId = url.searchParams.get('taskId') || undefined;
        const list = await conf.listRequests({
          status: status || undefined,
          taskId,
        });
        sendJson(res, 200, { confirmations: list });
        return;
      }
      if (second && segments.length === 2 && method === 'GET') {
        const reqResult = await conf.getRequest(second);
        if (!reqResult) {
          sendError(res, toInterfaceErrorBody('NOT_FOUND', `Confirmation request not found: ${second}`));
          return;
        }
        sendJson(res, 200, reqResult);
        return;
      }
      if (second && third === 'approve' && segments.length === 3 && method === 'POST') {
        const body = await readJsonBody(req);
        if (commands) {
          const reqResult = await commands.approveConfirmation({
            requestId: second,
            actor: body.actor ?? 'web-operator',
            reason: body.reason,
            fingerprint: body.fingerprint,
            runId: body.runId,
            taskId: body.taskId,
          });
          sendJson(res, 200, reqResult);
        } else {
          const reqResult = await conf.approve(second, {
            actor: body.actor ?? 'web-operator',
            reason: body.reason,
          });
          sendJson(res, 200, reqResult);
        }
        return;
      }
      if (second && third === 'reject' && segments.length === 3 && method === 'POST') {
        const body = await readJsonBody(req);
        if (commands) {
          const reqResult = await commands.rejectConfirmation({
            requestId: second,
            actor: body.actor ?? 'web-operator',
            reason: body.reason,
            fingerprint: body.fingerprint,
            runId: body.runId,
            taskId: body.taskId,
          });
          sendJson(res, 200, reqResult);
        } else {
          const reqResult = await conf.reject(second, {
            actor: body.actor ?? 'web-operator',
            reason: body.reason,
          });
          sendJson(res, 200, reqResult);
        }
        return;
      }
      if (second && third === 'provide-credential' && segments.length === 3 && method === 'POST') {
        const body = await readJsonBody(req);
        if (!body.token) {
          sendError(res, toInterfaceErrorBody('VALIDATION_ERROR', 'Credential token is required'));
          return;
        }
        if (commands) {
          const reqResult = await commands.provideCredential({
            requestId: second,
            token: body.token,
            actor: body.actor ?? 'web-operator',
            reason: body.reason,
            fingerprint: body.fingerprint,
            runId: body.runId,
            taskId: body.taskId,
          });
          sendJson(res, 200, reqResult);
        } else {
          const reqResult = await conf.provideCredential(second, body.token, {
            actor: body.actor ?? 'web-operator',
            reason: body.reason,
          });
          sendJson(res, 200, reqResult);
        }
        return;
      }
      if (second && third === 'cancel' && segments.length === 3 && method === 'POST') {
        const body = await readJsonBody(req);
        const reqResult = await conf.cancel(second, {
          actor: body.actor ?? 'web-operator',
          reason: body.reason,
        });
        sendJson(res, 200, reqResult);
        return;
      }
    }

    // --- Health, Capabilities & Workspace Queries ---
    if (first === 'health' && segments.length === 1) {
      sendJson(res, 200, {
        status: 'ok',
        readOnly: true,
        apiVersion: PLATFORM_API_VERSION,
      });
      return;
    }

    if (first === 'capabilities' && segments.length === 1) {
      sendJson(res, 200, buildCapabilityCatalog());
      return;
    }

    if (first === 'workspace' && segments.length === 1) {
      sendJson(res, 200, queries.workspace());
      return;
    }

    if (first === 'stream' && segments.length === 1) {
      startStream(req, res, url);
      return;
    }

    // --- Reliability Service Queries (UI-2.28, UI-2.29) ---
    if (first === 'reliability') {
      const rel = reliability ?? commands?.getReliabilityService();
      if (!rel) {
        sendError(res, toInterfaceErrorBody(
          'NOT_IMPLEMENTED',
          'Reliability service is not configured',
          'RELIABILITY_UNAVAILABLE',
        ));
        return;
      }
      const aggregation = parseAggregationOptions({
        window: url.searchParams.get('window'),
        workspace: url.searchParams.get('workspace'),
        projectType: url.searchParams.get('projectType'),
        framework: url.searchParams.get('framework'),
        skill: url.searchParams.get('skill'),
        population: url.searchParams.get('population'),
        minSample: url.searchParams.get('minSample'),
      });
      if (segments.length === 1) {
        sendJson(res, 200, await rel.getReport(aggregation));
        return;
      }
      if (second === 'runs' && third && segments.length === 3) {
        sendJson(res, 200, await rel.getRecord(third));
        return;
      }
      if (second === 'runs' && third === undefined && segments.length === 2) {
        sendJson(res, 200, { records: await rel.listRecords() });
        return;
      }
      if (second === 'metrics' && third && segments.length === 3) {
        sendJson(res, 200, await rel.getContribution(third, aggregation));
        return;
      }
      if (second === 'suspicion' && third && segments.length === 3) {
        sendJson(res, 200, await rel.getSuspicionDetail(third));
        return;
      }
    }

    // --- Tasks List Query (UI-2.4) ---
    if (first === 'tasks' && segments.length === 1) {
      const limit = parsePositiveInt(url.searchParams.get('limit'), 50);
      sendJson(res, 200, { tasks: await queries.listTasks(limit) });
      return;
    }

    // --- Runs Queries (UI-2.5, UI-2.6) ---
    if (first === 'runs') {
      if (segments.length === 1) {
        const limit = parsePositiveInt(url.searchParams.get('limit'), 50);
        sendJson(res, 200, { runs: await queries.listTasks(limit) });
        return;
      }
      if (second && segments.length === 2) {
        sendJson(res, 200, await queries.getRun(second));
        return;
      }
      if (second && third === 'events' && segments.length === 3) {
        const sinceSeq = parsePositiveInt(url.searchParams.get('sinceSeq'), 0);
        const limit = parsePositiveInt(url.searchParams.get('limit'), 300);
        sendJson(res, 200, await queries.getEventsByRun(second, sinceSeq || undefined, limit));
        return;
      }
      if (second && third === 'timeline' && segments.length === 3) {
        sendJson(res, 200, await queries.getTimelineForRun(second));
        return;
      }
      if (second && third === 'outcome' && segments.length === 3) {
        const runSnapshot = await queries.getRun(second);
        sendJson(res, 200, await queries.getOutcomeSummary(runSnapshot.taskId, second));
        return;
      }
      if (second && third === 'logs' && segments.length === 3) {
        const runSnapshot = await queries.getRun(second);
        sendJson(res, 200, await queries.getLogInfo(runSnapshot.taskId, second));
        return;
      }
      if (second && third === 'logs' && fourth === 'raw' && segments.length === 4) {
        const limit = parsePositiveInt(url.searchParams.get('limit'), 500);
        const runSnapshot = await queries.getRun(second);
        sendJson(res, 200, await queries.getRawLogLines(runSnapshot.taskId, second, limit));
        return;
      }
    }

    // --- Task Specific Routes (UI-2.6 - UI-2.33) ---
    if (first === 'tasks' && second) {
      if (segments.length === 2) {
        sendJson(res, 200, await queries.getTask(second));
        return;
      }

      // Sub-routes under tasks/:taskId/runs
      if (third === 'runs') {
        if (segments.length === 3) {
          sendJson(res, 200, { taskId: second, runs: await queries.listRuns(second) });
          return;
        }
        if (fourth && segments.length === 4) {
          sendJson(res, 200, await queries.getTaskRun(second, fourth));
          return;
        }
        if (fourth && fifth === 'events' && segments.length === 5) {
          const sinceSeq = parsePositiveInt(url.searchParams.get('sinceSeq'), 0);
          const limit = parsePositiveInt(url.searchParams.get('limit'), 300);
          sendJson(res, 200, await queries.getEventsForTaskRun(second, fourth, sinceSeq || undefined, limit));
          return;
        }
        if (fourth && fifth === 'logs' && segments.length === 5) {
          sendJson(res, 200, await queries.getLogInfo(second, fourth));
          return;
        }
        if (fourth && fifth === 'logs' && sixth === 'raw' && segments.length === 6) {
          const limit = parsePositiveInt(url.searchParams.get('limit'), 500);
          sendJson(res, 200, await queries.getRawLogLines(second, fourth, limit));
          return;
        }
        if (fourth && fifth === 'timeline' && segments.length === 5) {
          sendJson(res, 200, await queries.getTimeline(second, fourth));
          return;
        }
        if (fourth && fifth === 'backend' && segments.length === 5) {
          sendJson(res, 200, await queries.getBackend(second, fourth));
          return;
        }
        if (fourth && fifth === 'database' && segments.length === 5) {
          sendJson(res, 200, await queries.getDatabase(second, fourth));
          return;
        }
        if (fourth && segments.length === 5) {
          switch (fifth) {
            case 'context':
              sendJson(res, 200, await queries.getContext(second, fourth));
              return;
            case 'skills':
              sendJson(res, 200, await queries.getSkills(second, fourth));
              return;
            case 'todos':
              sendJson(res, 200, await queries.getTodos(second, fourth));
              return;
            case 'version':
              sendJson(res, 200, await queries.getVersion(second, fourth));
              return;
            case 'impact':
              sendJson(res, 200, await queries.getImpact(second, fourth));
              return;
            case 'regression':
              sendJson(res, 200, await queries.getRegression(second, fourth));
              return;
            case 'execution':
              sendJson(res, 200, await queries.getExecution(second, fourth));
              return;
            case 'verification':
              sendJson(res, 200, await queries.getVerification(second, fourth));
              return;
            case 'workspace':
              sendJson(res, 200, await queries.getWorkspace(second, fourth));
              return;
            case 'failure':
              sendJson(res, 200, await queries.getFailure(second, fourth));
              return;
            case 'repair':
              sendJson(res, 200, await queries.getRepair(second, fourth));
              return;
            case 'outcome':
              sendJson(res, 200, await queries.getOutcomeSummary(second, fourth));
              return;
            default:
              break;
          }
        }
      }

      // Sub-routes under tasks/:taskId/context
      if (third === 'context' && segments.length === 3) {
        sendJson(res, 200, await queries.getContext(second));
        return;
      }
      if (third === 'context' && segments.length === 4) {
        const index = Number(fourth);
        if (!Number.isInteger(index) || index < 0) {
          sendError(res, toInterfaceErrorBody(
            'VALIDATION_ERROR',
            'Context index must be a non-negative integer',
            'INVALID_CONTEXT_INDEX',
          ));
          return;
        }
        sendJson(res, 200, await queries.getContextItem(second, index));
        return;
      }

      // Domain views under tasks/:taskId/*
      if (segments.length === 3) {
        switch (third) {
          case 'skills':
            sendJson(res, 200, await queries.getSkills(second));
            return;
          case 'version':
            sendJson(res, 200, await queries.getVersion(second));
            return;
          case 'impact':
            sendJson(res, 200, await queries.getImpact(second));
            return;
          case 'regression':
            sendJson(res, 200, await queries.getRegression(second));
            return;
          case 'timeline':
            sendJson(res, 200, await queries.getTimeline(second));
            return;
          case 'todos':
            sendJson(res, 200, await queries.getTodos(second));
            return;
          case 'execution':
            sendJson(res, 200, await queries.getExecution(second));
            return;
          case 'verification':
            sendJson(res, 200, await queries.getVerification(second));
            return;
          case 'workspace':
            sendJson(res, 200, await queries.getWorkspace(second));
            return;
          case 'failure':
            sendJson(res, 200, await queries.getFailure(second));
            return;
          case 'repair':
            sendJson(res, 200, await queries.getRepair(second));
            return;
          case 'backend':
            sendJson(res, 200, await queries.getBackend(second));
            return;
          case 'database':
            sendJson(res, 200, await queries.getDatabase(second));
            return;
          case 'logs':
            sendJson(res, 200, await queries.getLogInfo(second));
            return;
          case 'outcome':
            sendJson(res, 200, await queries.getOutcomeSummary(second));
            return;
          case 'events': {
            const sinceSeq = parsePositiveInt(url.searchParams.get('sinceSeq'), 0);
            const limit = parsePositiveInt(url.searchParams.get('limit'), 300);
            sendJson(res, 200, await queries.getEvents(second, sinceSeq || undefined, limit));
            return;
          }
          default:
            break;
        }
      }
    }

    sendError(res, toInterfaceErrorBody('NOT_FOUND', 'Unknown API route'));
  }

  function startStream(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');

    const scopedRunId = url.searchParams.get('runId') || undefined;
    const scopedTaskId = url.searchParams.get('taskId') || undefined;
    let sinceSeq = parsePositiveInt(url.searchParams.get('sinceSeq') ?? (req.headers['last-event-id'] as string), 0);

    let lastToken = -1;
    let lastHeartbeat = Date.now();
    let inFlight = false;

    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void (async () => {
        try {
          const token = await queries.changeToken();
          if (token !== lastToken) {
            lastToken = token;
            if (scopedRunId) {
              const run = await queries.getRun(scopedRunId).catch(() => null);
              if (run && scopedTaskId && run.taskId !== scopedTaskId) {
                // Cross-run isolation violation: terminate stream for mismatched task/run
                res.write(`event: error\ndata: ${JSON.stringify({ error: 'TASK_RUN_MISMATCH' })}\n\n`);
                return;
              }
              const eventPayload = await queries.getEventsByRun(scopedRunId, sinceSeq || undefined, 100).catch(() => null);
              const events = eventPayload?.events ?? [];
              if (events.length > 0) {
                sinceSeq = Math.max(sinceSeq, ...events.map(e => e.seq));
              }
              res.write(`event: run\ndata: ${JSON.stringify({
                token,
                run,
                events,
                runId: scopedRunId,
                taskId: run?.taskId,
                attemptId: run?.attemptCount ? `attempt-${run.attemptCount}` : 'attempt-1',
                phase: run?.liveStatus,
                timestamp: new Date().toISOString(),
              })}\n\n`);
            } else if (scopedTaskId) {
              const task = await queries.getTask(scopedTaskId).catch(() => null);
              const eventPayload = await queries.getEvents(scopedTaskId, sinceSeq || undefined, 100).catch(() => null);
              const events = eventPayload?.events ?? [];
              if (events.length > 0) {
                sinceSeq = Math.max(sinceSeq, ...events.map(e => e.seq));
              }
              res.write(`event: task\ndata: ${JSON.stringify({
                token,
                task,
                events,
                taskId: scopedTaskId,
                runId: task?.runId,
                attemptId: task?.attemptCount ? `attempt-${task.attemptCount}` : 'attempt-1',
                phase: task?.liveStatus,
                timestamp: new Date().toISOString(),
              })}\n\n`);
            } else {
              const tasks = await queries.listTasks(50);
              res.write(`event: change\ndata: ${JSON.stringify({ token, tasks })}\n\n`);
            }
            lastHeartbeat = Date.now();
          } else if (Date.now() - lastHeartbeat > HEARTBEAT_MS) {
            res.write(': heartbeat\n\n');
            lastHeartbeat = Date.now();
          }
        } catch {
          // An observer must never be able to break the pipeline or the server.
        } finally {
          inFlight = false;
        }
      })();
    }, pollIntervalMs);
    timer.unref?.();

    const entry = { res, timer };
    streams.add(entry);
    res.on('close', () => {
      clearInterval(timer);
      streams.delete(entry);
    });
  }

  return {
    server,
    listen: () => new Promise<StartedWebServer>((resolve, reject) => {
      const port = options?.port ?? DEFAULT_PORT;
      const host = options?.host ?? DEFAULT_HOST;
      server.once('error', reject);
      server.listen(port, host, () => {
        const address = server.address();
        const boundPort = typeof address === 'object' && address ? address.port : port;
        resolve({
          url: `http://${host}:${boundPort}`,
          port: boundPort,
          close: () => new Promise<void>(done => {
            for (const entry of streams) {
              clearInterval(entry.timer);
              entry.res.end();
            }
            streams.clear();
            server.close(() => done());
          }),
        });
      });
    }),
  };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res: http.ServerResponse, body: InterfaceErrorBody): void {
  sendJson(res, httpStatusFor(body.error.code), body);
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

async function readJsonBody<T = any>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({} as T);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}
