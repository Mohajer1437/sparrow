/**
 * The platform capability inventory and interface parity matrix (H.1, H.4, H.29).
 *
 * This is the single declared answer to "what can Sparrow do, and through which
 * window can you reach it". CLI, REPL and the Web API all read this one table,
 * so a gap is stated once and cannot be presented as supported by one interface
 * while another quietly lacks it. Entries describe what is actually wired today;
 * a capability that is deliberately not exposed carries the reason with it.
 */

export const PLATFORM_API_VERSION = 'v1';

export type InterfaceSupport = 'SUPPORTED' | 'PARTIAL' | 'BLOCKED' | 'NOT_APPLICABLE';

export type InterfaceId = 'cli' | 'repl' | 'api' | 'ui';

export interface CapabilityInterfaceState {
  readonly support: InterfaceSupport;
  /** How the capability is reached, or why it is not reachable. */
  readonly detail: string;
}

export interface PlatformCapability {
  readonly id: string;
  readonly title: string;
  /** Application-layer owner. Interfaces must not reimplement this logic. */
  readonly applicationService: string;
  readonly kind: 'command' | 'query';
  readonly cli: CapabilityInterfaceState;
  readonly repl: CapabilityInterfaceState;
  readonly api: CapabilityInterfaceState;
  readonly ui: CapabilityInterfaceState;
}

export interface CapabilityCatalog {
  readonly apiVersion: string;
  readonly generatedAt: string;
  readonly readOnlyApi: boolean;
  readonly localOperatorApi: true;
  readonly capabilities: ReadonlyArray<PlatformCapability>;
  readonly gaps: ReadonlyArray<{
    readonly capabilityId: string;
    readonly interfaceId: InterfaceId;
    readonly support: InterfaceSupport;
    readonly detail: string;
  }>;
}

function state(support: InterfaceSupport, detail: string): CapabilityInterfaceState {
  return Object.freeze({ support, detail });
}

const supported = (detail: string) => state('SUPPORTED', detail);
const partial = (detail: string) => state('PARTIAL', detail);
const blocked = (detail: string) => state('BLOCKED', detail);

const CAPABILITIES: ReadonlyArray<PlatformCapability> = Object.freeze([
  Object.freeze({
    id: 'task.execute',
    title: 'Task execution',
    applicationService: 'TaskExecutionService',
    kind: 'command' as const,
    cli: supported('agent ask <task>'),
    repl: supported('/execute <task>'),
    api: supported('POST /api/v1/tasks/execute (local loopback operator)'),
    ui: supported('Web UI task execution console'),
  }),
  Object.freeze({
    id: 'task.cancel',
    title: 'Task cancellation',
    applicationService: 'ApplicationCommandService',
    kind: 'command' as const,
    cli: supported('Ctrl+C in terminal / agent recovery'),
    repl: supported('Ctrl+C in REPL / /recovery'),
    api: supported('POST /api/v1/tasks/:taskId/cancel'),
    ui: supported('cancel button on active execution banner'),
  }),
  Object.freeze({
    id: 'log.inspect',
    title: 'Exact pipeline log file correlation',
    applicationService: 'TaskQueryService + PipelineEventReader',
    kind: 'query' as const,
    cli: supported('agent runs <taskId> --view logs / .ai/logs/pipeline/'),
    repl: supported('/runs <taskId> logs'),
    api: supported('GET /api/v1/tasks/:taskId/logs and /runs/:runId/logs/raw'),
    ui: supported('logs tab with exact log file name, copy path, and raw viewer'),
  }),
  Object.freeze({
    id: 'run.list',
    title: 'Task run history',
    applicationService: 'TaskQueryService',
    kind: 'query' as const,
    cli: supported('agent runs'),
    repl: supported('/runs'),
    api: supported('GET /api/v1/tasks'),
    ui: supported('task list and dashboard'),
  }),
  Object.freeze({
    id: 'run.detail',
    title: 'Task run detail',
    applicationService: 'TaskQueryService',
    kind: 'query' as const,
    cli: supported('agent runs <taskId>'),
    repl: supported('/runs <taskId>'),
    api: supported('GET /api/v1/tasks/:taskId'),
    ui: supported('task tab'),
  }),
  Object.freeze({
    id: 'run.timeline',
    title: 'Run timeline',
    applicationService: 'TaskQueryService',
    kind: 'query' as const,
    cli: supported('agent runs <taskId> --view timeline'),
    repl: supported('/runs <taskId> timeline'),
    api: supported('GET /api/v1/tasks/:taskId/timeline'),
    ui: supported('timeline tab'),
  }),
  Object.freeze({
    id: 'context.inspect',
    title: 'Context strategy and gathered context',
    applicationService: 'TaskQueryService',
    kind: 'query' as const,
    cli: supported('agent runs <taskId> --view context'),
    repl: supported('/runs <taskId> context'),
    api: supported('GET /api/v1/tasks/:taskId/context'),
    ui: supported('context tab'),
  }),
  Object.freeze({
    id: 'skills.inspect',
    title: 'Skill resolution',
    applicationService: 'TaskQueryService',
    kind: 'query' as const,
    cli: supported('agent runs <taskId> --view skills'),
    repl: supported('/runs <taskId> skills'),
    api: supported('GET /api/v1/tasks/:taskId/skills'),
    ui: supported('skills tab'),
  }),
  Object.freeze({
    id: 'version.inspect',
    title: 'Version intelligence',
    applicationService: 'TaskQueryService (recorded run) / VersionIntelligence (live project)',
    kind: 'query' as const,
    cli: supported('agent version (live), agent runs <taskId> --view version (recorded)'),
    repl: supported('/version, /runs <taskId> version'),
    api: partial('GET /api/v1/tasks/:taskId/version returns the recorded run evidence; live project scan is CLI/REPL only'),
    ui: partial('version tab shows the version recorded for the run, not a live rescan'),
  }),
  Object.freeze({
    id: 'plan.inspect',
    title: 'TodoPlan',
    applicationService: 'TaskQueryService',
    kind: 'query' as const,
    cli: supported('agent runs <taskId> --view plan'),
    repl: supported('/runs <taskId> plan'),
    api: supported('GET /api/v1/tasks/:taskId/todos'),
    ui: supported('plan tab'),
  }),
  Object.freeze({
    id: 'impact.inspect',
    title: 'Impact analysis',
    applicationService: 'TaskQueryService (recorded run) / ImpactAnalyzer (live files)',
    kind: 'query' as const,
    cli: supported('agent impact <files...> (live), agent runs <taskId> --view impact (recorded)'),
    repl: supported('/impact <files...>, /runs <taskId> impact'),
    api: partial('GET /api/v1/tasks/:taskId/impact returns recorded analysis; live analysis is CLI/REPL only'),
    ui: partial('impact tab shows the analysis recorded for the run'),
  }),
  Object.freeze({
    id: 'regression.inspect',
    title: 'Regression selection',
    applicationService: 'TaskQueryService (recorded run) / RegressionSelector (live)',
    kind: 'query' as const,
    cli: supported('agent runs <taskId> --view regression'),
    repl: supported('/runs <taskId> regression'),
    api: supported('GET /api/v1/tasks/:taskId/regression'),
    ui: supported('regression tab'),
  }),
  Object.freeze({
    id: 'execution.inspect',
    title: 'Execution steps',
    applicationService: 'TaskQueryService',
    kind: 'query' as const,
    cli: supported('agent runs <taskId> --view execution'),
    repl: supported('/runs <taskId> execution'),
    api: supported('GET /api/v1/tasks/:taskId/execution'),
    ui: supported('execution tab'),
  }),
  Object.freeze({
    id: 'verification.inspect',
    title: 'Verification (V&V)',
    applicationService: 'TaskQueryService',
    kind: 'query' as const,
    cli: supported('agent runs <taskId> --view verification'),
    repl: supported('/runs <taskId> verification'),
    api: supported('GET /api/v1/tasks/:taskId/verification'),
    ui: supported('verification tab'),
  }),
  Object.freeze({
    id: 'failure.inspect',
    title: 'Failure contract',
    applicationService: 'TaskQueryService',
    kind: 'query' as const,
    cli: supported('agent runs <taskId> --view failure'),
    repl: supported('/runs <taskId> failure'),
    api: supported('GET /api/v1/tasks/:taskId/failure'),
    ui: supported('failure tab'),
  }),
  Object.freeze({
    id: 'repair.inspect',
    title: 'Repair history',
    applicationService: 'TaskQueryService',
    kind: 'query' as const,
    cli: supported('agent runs <taskId> --view repair'),
    repl: supported('/runs <taskId> repair'),
    api: supported('GET /api/v1/tasks/:taskId/repair'),
    ui: supported('repair tab'),
  }),
  Object.freeze({
    id: 'reliability.report',
    title: 'Reliability measurement',
    applicationService: 'ReliabilityService',
    kind: 'query' as const,
    cli: supported('agent reliability'),
    repl: supported('/reliability'),
    api: supported('GET /api/v1/reliability'),
    ui: supported('reliability view'),
  }),
  Object.freeze({
    id: 'reliability.drilldown',
    title: 'Reliability metric drill-down',
    applicationService: 'ReliabilityService',
    kind: 'query' as const,
    cli: supported('agent reliability --metric <name> / --why <taskId>'),
    repl: supported('/reliability --metric <name>'),
    api: supported('GET /api/v1/reliability/metrics/:metric'),
    ui: supported('click a metric in the reliability view'),
  }),
  Object.freeze({
    id: 'events.stream',
    title: 'Live pipeline events',
    applicationService: 'TaskQueryService + PipelineEventReader',
    kind: 'query' as const,
    cli: partial('events are printed by the running pipeline, not queried after the fact'),
    repl: partial('events are printed by the running pipeline, not queried after the fact'),
    api: supported('GET /api/v1/tasks/:taskId/events and GET /api/v1/stream'),
    ui: supported('events tab and SSE updates'),
  }),
  Object.freeze({
    id: 'confirmation.lifecycle',
    title: 'Confirmation & Human-in-the-Loop',
    applicationService: 'ConfirmationService',
    kind: 'command' as const,
    cli: supported('agent confirm [list|get|approve|reject|provide-credential]'),
    repl: supported('/confirm, /approve, /reject, /provide-credential'),
    api: supported('GET/POST /api/v1/confirmations'),
    ui: supported('confirmations tab with approve/reject actions'),
  }),
  Object.freeze({
    id: 'credential.request',
    title: 'Test credential request (REQUIRES_TEST_CREDENTIAL)',
    applicationService: 'RuntimeSecretHolder + backend verification',
    kind: 'command' as const,
    cli: supported('agent confirm provide-credential'),
    repl: supported('/provide-credential'),
    api: supported('POST /api/v1/confirmations/:id/provide-credential (runtime only, never persisted)'),
    ui: supported('provide credential dialog in web UI (runtime only)'),
  }),
  Object.freeze({
    id: 'capabilities.discover',
    title: 'Capability discovery',
    applicationService: 'PlatformCapabilities',
    kind: 'query' as const,
    cli: supported('agent capabilities'),
    repl: supported('/capabilities'),
    api: supported('GET /api/v1/capabilities'),
    ui: supported('dashboard view'),
  }),
]);

export function listCapabilities(): ReadonlyArray<PlatformCapability> {
  return CAPABILITIES;
}

/** Catalog for interface adapters, including an explicit list of known gaps. */
export function buildCapabilityCatalog(now: Date = new Date()): CapabilityCatalog {
  const gaps: CapabilityCatalog['gaps'][number][] = [];
  for (const capability of CAPABILITIES) {
    for (const interfaceId of ['cli', 'repl', 'api', 'ui'] as const) {
      const entry = capability[interfaceId];
      if (entry.support === 'SUPPORTED') continue;
      gaps.push(Object.freeze({
        capabilityId: capability.id,
        interfaceId,
        support: entry.support,
        detail: entry.detail,
      }));
    }
  }
  return Object.freeze({
    apiVersion: PLATFORM_API_VERSION,
    generatedAt: now.toISOString(),
    readOnlyApi: false,
    localOperatorApi: true as const,
    capabilities: CAPABILITIES,
    gaps: Object.freeze(gaps),
  });
}
