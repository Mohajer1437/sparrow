import { promises as fs } from 'fs';
import * as path from 'path';
import { ApiVerifier } from '../../contracts/api-verifier';
import { QualityProfile } from '../../domain/quality-profile';
import { VerificationCheck } from '../../domain/verification-check';
import { Skill } from '../../domain/skill';
import { TodoPlan } from '../../domain/todo-plan';
import { PersistenceAssertion } from '../../domain/endpoint-verification';
import { ReadOnlyDatabase } from '../../contracts/read-only-database';
import {
  ApiScenario,
  DiscoveredEndpoint,
  formatApiEvidence,
  generateScenarios,
  parseRouteModule,
  scenarioPassed,
  sensitiveFieldsIn,
} from './api-scenarios';
import { sourceFileToApiRoute } from './api-route';
import { BackendVerificationEngine } from '../backend/endpoint-verifier';
import { RuntimeSecretHolder } from '../backend/runtime-secrets';
import { backendReportToChecks } from '../backend/report-to-checks';
import { frameworksFromPackage, readPackageJson } from '../backend/bounded-walk';
import { allowsHttpMethod } from '../../domain/execution-mode';
import {
  VerificationSideEffect,
  VerificationSideEffectPolicy,
} from '../../domain/verification-side-effect';

export interface DefaultApiVerifierOptions {
  readonly secrets?: RuntimeSecretHolder;
  readonly database?: ReadOnlyDatabase;
  readonly engine?: BackendVerificationEngine;
}

export class DefaultApiVerifier implements ApiVerifier {
  private readonly engine: BackendVerificationEngine;
  private readonly secrets: RuntimeSecretHolder;
  private sideEffects: VerificationSideEffect[] = [];

  /**
   * R1.27: the ledger of what the last verify() did to project state.
   * A mutating probe against a running app can write real data files, so it
   * is either declared and recorded, or refused and recorded as BLOCKED.
   */
  drainSideEffects(): ReadonlyArray<VerificationSideEffect> {
    const effects = Object.freeze([...this.sideEffects]);
    this.sideEffects = [];
    return effects;
  }

  constructor(options: DefaultApiVerifierOptions = {}) {
    this.secrets = options.secrets ?? new RuntimeSecretHolder();
    this.engine = options.engine ?? new BackendVerificationEngine(this.secrets, options.database);
  }
  async verify(input: {
    readonly workspacePath: string;
    readonly profile: QualityProfile;
    readonly changedFiles?: ReadonlyArray<string>;
    readonly task?: string;
    readonly acceptanceCriteria?: ReadonlyArray<string>;
    readonly todoPlan?: TodoPlan;
    readonly skills?: ReadonlyArray<Skill>;
    readonly persistenceAssertions?: ReadonlyArray<{
      readonly endpointId: string;
      readonly assertion: PersistenceAssertion;
    }>;
    readonly sideEffectPolicy?: VerificationSideEffectPolicy;
  }): Promise<ReadonlyArray<VerificationCheck>> {
    this.sideEffects = [];
    // The policy decision belongs to the caller that knows the execution mode
    // (DefaultVvAgent / the orchestrator). Absent that decision the verifier keeps
    // its historical behaviour and records every effect in the ledger instead.
    const sideEffectPolicy: VerificationSideEffectPolicy = input.sideEffectPolicy ?? 'CONTROLLED_MUTATION';
    if (input.profile === 'MVP') {
      return Object.freeze([]);
    }

    if (await this.shouldUseBackendEngine(input)) {
      const report = await this.engine.verify({
        workspacePath: input.workspacePath,
        profile: input.profile,
        task: input.task,
        changedFiles: input.changedFiles,
        acceptanceCriteria: input.acceptanceCriteria,
        todoPlan: input.todoPlan,
        skills: input.skills,
        persistenceAssertions: input.persistenceAssertions,
      });
      try {
        return backendReportToChecks(report);
      } finally {
        this.secrets.clear();
      }
    }

    const endpoints = await this.discoverEndpoints(input.workspacePath);
    const checks: VerificationCheck[] = [];
    checks.push(Object.freeze({
      id: 'api-route-discovery',
      category: 'api' as const,
      name: 'API route discovery',
      passed: true,
      severity: 'LOW' as const,
      evidence: endpoints.length > 0
        ? 'Discovered ' + endpoints.length + ' API endpoint(s): ' + endpoints.slice(0, 8).map(e => e.methods.join('|') + ' ' + e.route).join(', ')
        : 'No API routes discovered under app/api, pages/api, or OpenAPI',
    }));

    if (endpoints.length === 0) {
      return Object.freeze(checks);
    }

    const focused = this.focusEndpoints(endpoints, input.changedFiles, input.task, input.acceptanceCriteria);
    const apiRelevant = this.isApiRelevant(input.task, input.acceptanceCriteria, input.changedFiles, focused);
    if (!apiRelevant && input.profile !== 'PRODUCTION') {
      return Object.freeze(checks);
    }
    const baseUrl = process.env.AGENT_VV_BASE_URL || 'http://127.0.0.1:3000';
    const reachable = await this.isReachable(baseUrl);
    if (!reachable) {
      const passed = input.profile !== 'PRODUCTION';
      checks.push(Object.freeze({
        id: 'api-runtime',
        category: 'api' as const,
        name: 'API runtime availability',
        passed,
        severity: (passed ? 'MEDIUM' : 'HIGH') as 'MEDIUM' | 'HIGH',
        evidence: passed
          ? 'API server not reachable at ' + baseUrl + '; STANDARD records this as a gap, not a blocker'
          : 'PRODUCTION requires live API verification but ' + baseUrl + ' is not reachable',
        acceptanceCriterion: 'HTTP API server is reachable for discovered routes',
      }));
      return Object.freeze(checks);
    }

    const endpointCap = input.profile === 'PRODUCTION' ? 4 : 2;
    for (const endpoint of focused.slice(0, endpointCap)) {
      const scenarios = generateScenarios(endpoint, input.profile);
      for (const scenario of scenarios) {
        // R1.21/R1.28: a POST/PUT/PATCH/DELETE probe against a live app is a
        // real mutation of that app's data. Under READ_ONLY it is refused and
        // recorded instead of quietly writing to the project.
        if (sideEffectPolicy === 'READ_ONLY' && !allowsHttpMethod('READ_ONLY', scenario.method)) {
          this.sideEffects.push(Object.freeze({
            id: `api-probe-${scenario.id}`,
            source: 'DefaultApiVerifier',
            kind: 'HTTP_MUTATION' as const,
            target: `${scenario.method} ${endpoint.route}`,
            policy: 'READ_ONLY' as const,
            status: 'BLOCKED' as const,
            declared: true,
            reversible: false,
            detail: 'mutating API probe skipped because verification is read-only',
          }));
          continue;
        }
        if (!allowsHttpMethod('READ_ONLY', scenario.method)) {
          this.sideEffects.push(Object.freeze({
            id: `api-probe-${scenario.id}`,
            source: 'DefaultApiVerifier',
            kind: 'HTTP_MUTATION' as const,
            target: `${scenario.method} ${endpoint.route}`,
            policy: 'CONTROLLED_MUTATION' as const,
            status: 'PERFORMED' as const,
            declared: true,
            reversible: false,
            detail: 'declared mutating API probe against the running application',
          }));
        }
        checks.push(await this.runScenario(baseUrl, endpoint, scenario));
      }
    }

    return Object.freeze(checks);
  }

  async runStoredScenario(input: {
    readonly baseUrl: string;
    readonly method: string;
    readonly path: string;
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly expectedStatuses?: ReadonlyArray<number>;
    readonly scenario?: string;
    readonly route?: string;
    readonly file?: string;
  }): Promise<VerificationCheck> {
    const url = input.baseUrl.replace(/\/$/, '') + (input.path.startsWith('/') ? input.path : '/' + input.path);
    const result = await this.probe(url, input.method, input.body, input.headers || {});
    const expected = (input.expectedStatuses && input.expectedStatuses.length > 0)
      ? input.expectedStatuses.join('|')
      : '<500';
    const scenario = {
      kind: (input.scenario || 'happy-path') as ApiScenario['kind'],
      expectedStatuses: input.expectedStatuses || [],
    } as ApiScenario;
    const passed = result.status > 0 && scenarioPassed(scenario, result.status);
    const evidence = formatApiEvidence({
      method: input.method,
      url,
      route: input.route || input.path,
      scenario: input.scenario || 'replay',
      expected,
      actual: result.status,
      response: result.detail,
      timestamp: new Date().toISOString(),
      file: input.file,
    });
    return Object.freeze({
      id: 'regression-replay-api-' + (input.route || input.path).replace(/[^\w]+/g, '-'),
      category: 'api' as const,
      name: 'Replay ' + input.method + ' ' + (input.route || input.path),
      passed,
      severity: (passed ? 'LOW' : 'HIGH') as 'LOW' | 'HIGH',
      evidence,
      acceptanceCriterion: input.method + ' ' + (input.route || input.path) + ' must match stored expected status ' + expected,
    });
  }

  private async runScenario(
    baseUrl: string,
    endpoint: DiscoveredEndpoint,
    scenario: ApiScenario,
  ): Promise<VerificationCheck> {
    const url = baseUrl.replace(/\/$/, '') + scenario.path;
    const first = await this.probe(url, scenario.method, scenario.body, scenario.headers);
    let status = first.status;
    let detail = first.detail;
    if (scenario.kind === 'duplicate-request' || scenario.kind === 'repeated-request') {
      const second = await this.probe(url, scenario.method, scenario.body, scenario.headers);
      status = second.status;
      detail = first.detail + ' then ' + second.detail;
    }
    const passed = status > 0 && scenarioPassed(scenario, status) && sensitiveFieldsIn(detail).length === 0;
    const sensitive = sensitiveFieldsIn(detail);
    const evidence = formatApiEvidence({
      method: scenario.method,
      url,
      route: endpoint.route,
      scenario: scenario.kind,
      expected: scenario.expectedStatuses.join('|') || '<500',
      actual: status,
      response: sensitive.length > 0 ? 'sensitive fields leaked: ' + sensitive.join(', ') : detail,
      timestamp: new Date().toISOString(),
      file: endpoint.file,
      request: scenario.body,
    });
    return Object.freeze({
      id: scenario.id,
      category: 'api' as const,
      name: scenario.method + ' ' + endpoint.route + ' ' + scenario.kind,
      passed,
      severity: (passed ? 'LOW' : 'HIGH') as 'LOW' | 'HIGH',
      evidence,
      acceptanceCriterion: scenario.description + '; expected HTTP ' + (scenario.expectedStatuses.join('|') || '<500') + ' and never 5xx',
    });
  }

  private isApiRelevant(
    task?: string,
    criteria?: ReadonlyArray<string>,
    changedFiles?: ReadonlyArray<string>,
    endpoints: DiscoveredEndpoint[] = [],
  ): boolean {
    const text = [task, ...(criteria ?? [])].filter(Boolean).join(' ');
    if (/\/api\/|endpoint|\bREST\b|OpenAPI|JSON payload|malformed JSON/i.test(text)) return true;
    if (changedFiles?.some(file => /(?:^|\/)api\//i.test(file.replace(/\\/g, '/')))) return true;
    if (endpoints.some(endpoint => text.includes(endpoint.route))) return true;
    return false;
  }

  private focusEndpoints(
    endpoints: DiscoveredEndpoint[],
    changedFiles?: ReadonlyArray<string>,
    task?: string,
    criteria?: ReadonlyArray<string>,
  ): DiscoveredEndpoint[] {
    const text = [task, ...(criteria ?? [])].filter(Boolean).join(' ');
    const mentioned = endpoints.filter(endpoint =>
      text.includes(endpoint.route) || new RegExp(endpoint.route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text),
    );
    if (mentioned.length > 0) return mentioned;
    if (changedFiles && changedFiles.length > 0) {
      const focused = endpoints.filter(endpoint =>
        changedFiles.some(file => {
          const normalized = file.replace(/\\/g, '/');
          const endpointFile = endpoint.file.replace(/\\/g, '/');
          return endpointFile === normalized
            || endpointFile.endsWith('/' + normalized)
            || normalized.endsWith(endpointFile)
            || normalized.includes(endpoint.route);
        }),
      );
      if (focused.length > 0) return focused;
    }
    return endpoints;
  }

  private async discoverEndpoints(workspacePath: string): Promise<DiscoveredEndpoint[]> {
    const fromFiles = await this.discoverFromFiles(workspacePath);
    const fromOpenApi = await this.discoverFromOpenApi(workspacePath);
    const byRoute = new Map<string, DiscoveredEndpoint>();
    for (const endpoint of [...fromFiles, ...fromOpenApi]) {
      const existing = byRoute.get(endpoint.route);
      if (!existing) {
        byRoute.set(endpoint.route, endpoint);
        continue;
      }
      byRoute.set(endpoint.route, {
        ...existing,
        methods: uniqueMethods([...existing.methods, ...endpoint.methods]),
        queryParams: uniqueStrings([...existing.queryParams, ...endpoint.queryParams]),
        jsonFields: uniqueStrings([...existing.jsonFields, ...endpoint.jsonFields]),
        requiresAuth: existing.requiresAuth || endpoint.requiresAuth,
        hasJsonBody: existing.hasJsonBody || endpoint.hasJsonBody,
      });
    }
    return [...byRoute.values()];
  }

  private async discoverFromFiles(workspacePath: string): Promise<DiscoveredEndpoint[]> {
    const roots = [
      path.join(workspacePath, 'src', 'app', 'api'),
      path.join(workspacePath, 'app', 'api'),
      path.join(workspacePath, 'src', 'pages', 'api'),
      path.join(workspacePath, 'pages', 'api'),
    ];
    const files: string[] = [];
    for (const rootDir of roots) {
      await this.walk(rootDir, files);
    }
    const endpoints: DiscoveredEndpoint[] = [];
    for (const file of files) {
      const route = fileToRoute(file);
      if (!route) continue;
      let content = '';
      try {
        content = await fs.readFile(file, 'utf8');
      } catch {
        content = '';
      }
      const relative = path.relative(workspacePath, file).replace(/\\/g, '/');
      endpoints.push(parseRouteModule(relative, content, route));
    }
    return endpoints;
  }

  private async discoverFromOpenApi(workspacePath: string): Promise<DiscoveredEndpoint[]> {
    const candidates = [
      'openapi.json',
      'swagger.json',
      'public/openapi.json',
      'docs/openapi.json',
    ];
    for (const rel of candidates) {
      const full = path.join(workspacePath, rel);
      try {
        const raw = await fs.readFile(full, 'utf8');
        const json = JSON.parse(raw);
        const paths = json.paths || {};
        const endpoints: DiscoveredEndpoint[] = [];
        for (const [route, spec] of Object.entries(paths as Record<string, any>)) {
          const methods = Object.keys(spec || {})
            .map(key => key.toUpperCase())
            .filter(key => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(key)) as DiscoveredEndpoint['methods'][number][];
          if (methods.length === 0) continue;
          endpoints.push({
            route,
            methods,
            file: rel,
            requiresAuth: JSON.stringify(spec).toLowerCase().includes('security'),
            hasJsonBody: methods.some(method => method !== 'GET' && method !== 'DELETE'),
            queryParams: [],
            jsonFields: [],
            queryEquals: [],
          });
        }
        return endpoints;
      } catch {
        // try next candidate
      }
    }
    return [];
  }

  private async walk(dir: string, out: string[]): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await this.walk(full, out);
        } else if (/\.(ts|js|tsx|jsx)$/i.test(entry.name)) {
          out.push(full);
        }
      }
    } catch {
      // directory missing
    }
  }

  private async isReachable(baseUrl: string): Promise<boolean> {
    const result = await this.probe(baseUrl, 'GET');
    return result.status > 0;
  }

  private async probe(
    url: string,
    method: string,
    body?: string,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<{ status: number; detail: string }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      if (typeof (timer as NodeJS.Timeout).unref === 'function') (timer as NodeJS.Timeout).unref();
      const res = await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const text = await res.text().catch(() => '');
      return { status: res.status, detail: (res.statusText || '') + (text ? ' ' + text.slice(0, 300) : '') };
    } catch (error: any) {
      return { status: 0, detail: error?.message || 'request failed' };
    }
  }

  private async shouldUseBackendEngine(input: {
    readonly workspacePath: string;
    readonly todoPlan?: TodoPlan;
    readonly skills?: ReadonlyArray<Skill>;
    readonly task?: string;
  }): Promise<boolean> {
    if ((input.skills ?? []).some(skill => skill.verificationRules.backendVerification)) {
      return true;
    }
    const todoReqs = input.todoPlan?.todos.flatMap(todo => [...todo.verificationRequirements]) ?? [];
    if (todoReqs.some(req => req === 'auth' || req === 'authorization' || req === 'error-handling' || req === 'database-read-check')) {
      return true;
    }
    const pkg = await readPackageJson(input.workspacePath);
    const frameworks = frameworksFromPackage(pkg);
    if (frameworks.includes('nestjs') || frameworks.includes('express') || frameworks.includes('fastify')) {
      return true;
    }
    return false;
  }
}

function fileToRoute(file: string): string | undefined {
  return sourceFileToApiRoute(file);
}

function uniqueMethods(methods: DiscoveredEndpoint['methods'][number][]): DiscoveredEndpoint['methods'][number][] {
  return [...new Set(methods)];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
