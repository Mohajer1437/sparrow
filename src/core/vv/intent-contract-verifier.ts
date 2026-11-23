import { QualityProfile } from '../../domain/quality-profile';
import { VerificationCheck } from '../../domain/verification-check';
import { ProductAnalysis } from '../../domain/product-analysis';
import { formatApiEvidence } from './api-scenarios';
import { apiRouteToSourceFile, extractApiRouteFromText, extractHttpMethod } from './api-route';

export interface AuthzProbe {
  readonly method: string;
  readonly route: string;
  readonly expectedStatuses: ReadonlyArray<number>;
  readonly criterion: string;
  readonly sourceFile?: string;
}

export function extractAuthzProbes(
  criteria: ReadonlyArray<string> | undefined,
  task: string | undefined,
): AuthzProbe[] {
  const blobs = [...(criteria ?? []), task || ''].filter(Boolean);
  const out: AuthzProbe[] = [];
  const seen = new Set<string>();
  for (const blob of blobs) {
    if (!/\b(unauthenticated|only authenticated|authenticated users? may|401|403)\b/i.test(blob)) continue;
    const method = extractHttpMethod(blob) || extractHttpMethod(task || '') || 'POST';
    const route = extractApiRouteFromText(blob) || extractApiRouteFromText(task || '');
    if (!route) continue;
    const key = method + ' ' + route;
    if (seen.has(key)) continue;
    seen.add(key);
    const expectedStatuses = /401/.test(blob) && /403/.test(blob)
      ? [401, 403]
      : /401/.test(blob)
        ? [401]
        : /403/.test(blob)
          ? [403]
          : [401, 403];
    const sourceFile = apiRouteToSourceFile(route);
    out.push({ method, route, expectedStatuses, criterion: blob, sourceFile });
  }
  return out;
}

/**
 * Compares accepted Product QA criteria against observed product behavior.
 * Does not invent browser/API feature expansion; it only probes intent that
 * already named an authorization boundary.
 */
export async function verifyIntentContract(input: {
  readonly workspacePath: string;
  readonly profile: QualityProfile;
  readonly task?: string;
  readonly acceptanceCriteria?: ReadonlyArray<string>;
  readonly intentContract?: ProductAnalysis;
}): Promise<ReadonlyArray<VerificationCheck>> {
  const criteria = input.acceptanceCriteria
    ?? input.intentContract?.acceptanceCriteria
    ?? [];
  const checks: VerificationCheck[] = [];

  if (input.profile === 'MVP') {
    return Object.freeze(checks);
  }

  if (criteria.length > 0 || input.intentContract) {
    checks.push(Object.freeze({
      id: 'intent-acceptance-traceability',
      category: 'deterministic' as const,
      name: 'Acceptance contract available to V&V',
      passed: criteria.length > 0,
      severity: (criteria.length > 0 ? 'LOW' : 'HIGH') as 'LOW' | 'HIGH',
      evidence: criteria.length > 0
        ? 'V&V received ' + criteria.length + ' pre-planning acceptance criteria: '
          + criteria.slice(0, 6).join(' | ')
        : 'No pre-planning acceptance criteria reached post-execution V&V',
      acceptanceCriterion: 'The same acceptance criteria generated before planning remain available to verification',
    }));
  }

  const probes = extractAuthzProbes(criteria, input.task);
  if (probes.length === 0) {
    return Object.freeze(checks);
  }

  const baseUrl = process.env.AGENT_VV_BASE_URL
    || (input.profile === 'PRODUCTION' ? 'http://127.0.0.1:3010' : 'http://127.0.0.1:3000');

  for (const probe of probes.slice(0, 2)) {
    checks.push(await runAuthzProbe(baseUrl, probe));
  }

  return Object.freeze(checks);
}

async function runAuthzProbe(baseUrl: string, probe: AuthzProbe): Promise<VerificationCheck> {
  const url = baseUrl.replace(/\/$/, '') + probe.route;
  const body = probe.method === 'GET' || probe.method === 'HEAD' ? undefined : '{}';
  const headers: Record<string, string> = body ? { 'content-type': 'application/json' } : {};
  const result = await probeHttp(url, probe.method, body, headers);
  const expected = probe.expectedStatuses.join('|');
  const passed = result.status > 0 && probe.expectedStatuses.includes(result.status);
  const evidence = formatApiEvidence({
    method: probe.method,
    url,
    route: probe.route,
    scenario: 'intent-unauthorized',
    expected,
    actual: result.status,
    response: result.detail,
    timestamp: new Date().toISOString(),
    file: probe.sourceFile,
    request: body,
  });
  return Object.freeze({
    id: 'intent-authz-' + probe.method.toLowerCase() + '-' + probe.route.replace(/[^\w]+/g, '-'),
    category: 'api' as const,
    name: 'Intent ' + probe.method + ' ' + probe.route + ' unauthenticated',
    passed,
    severity: (passed ? 'LOW' : 'HIGH') as 'LOW' | 'HIGH',
    evidence,
    acceptanceCriterion: probe.criterion,
  });
}

async function probeHttp(
  url: string,
  method: string,
  body: string | undefined,
  headers: Readonly<Record<string, string>>,
): Promise<{ status: number; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  if (typeof (timer as NodeJS.Timeout).unref === 'function') (timer as NodeJS.Timeout).unref();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    return { status: res.status, detail: (res.statusText || '') + (text ? ' ' + text.slice(0, 300) : '') };
  } catch (error: any) {
    return { status: 0, detail: error?.message || 'request failed' };
  } finally {
    clearTimeout(timer);
  }
}
