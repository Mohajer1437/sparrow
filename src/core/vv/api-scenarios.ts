import { QualityProfile } from '../../domain/quality-profile';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ApiScenarioKind =
  | 'happy-path'
  | 'missing-input'
  | 'invalid-input'
  | 'boundary-value'
  | 'malformed-input'
  | 'unauthorized'
  | 'forbidden'
  | 'missing-resource'
  | 'duplicate-request'
  | 'repeated-request';

export interface DiscoveredEndpoint {
  readonly route: string;
  readonly methods: ReadonlyArray<HttpMethod>;
  readonly file: string;
  readonly requiresAuth: boolean;
  readonly hasJsonBody: boolean;
  readonly queryParams: ReadonlyArray<string>;
  readonly jsonFields: ReadonlyArray<string>;
  readonly queryEquals: ReadonlyArray<{ readonly param: string; readonly value: string }>;
}

export interface ApiScenario {
  readonly id: string;
  readonly kind: ApiScenarioKind;
  readonly method: HttpMethod;
  readonly route: string;
  readonly path: string;
  readonly body?: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly expectedStatuses: ReadonlyArray<number>;
  readonly description: string;
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function parseRouteModule(file: string, content: string, route: string): DiscoveredEndpoint {
  const methods = METHODS.filter(method =>
    new RegExp('export\\s+(async\\s+)?function\\s+' + method + '\\b').test(content)
    || new RegExp('export\\s+const\\s+' + method + '\\b').test(content),
  );
  const requiresAuth = /cookies\(\)|authorization|getSession|unauthorized|auth\(/i.test(content);
  const hasJsonBody = /(?:req|request)\.json\(\)/i.test(content);
  const queryParams = unique(
    [...content.matchAll(/searchParams\.get\(['"](\w+)['"]\)/g)].map(match => match[1]),
  );
  const jsonFields = unique(
    [...content.matchAll(/\{\s*([A-Za-z_][\w]*(?:\s*,\s*[A-Za-z_][\w]*)*)\s*\}\s*=\s*await\s+\w+\.json\(\)/g)]
      .flatMap(match => match[1].split(',').map(part => part.trim().split(':')[0].trim()))
      .filter(field => /^[A-Za-z_][\w]*$/.test(field)),
  );
  const queryEquals = [...content.matchAll(/(\w+)\s*===\s*['"]([^'"]+)['"]/g)]
    .filter(match => queryParams.includes(match[1]))
    .map(match => ({ param: match[1], value: match[2] }));
  return {
    route,
    methods: methods.length > 0 ? methods : ['GET'],
    file,
    requiresAuth,
    hasJsonBody,
    queryParams,
    jsonFields,
    queryEquals,
  };
}

export function generateScenarios(
  endpoint: DiscoveredEndpoint,
  profile: QualityProfile,
): ReadonlyArray<ApiScenario> {
  const out: ApiScenario[] = [];
  for (const method of endpoint.methods) {
    out.push(happyPath(endpoint, method));

    if (method === 'GET') {
      if (endpoint.queryParams.length > 0) {
        out.push(scenario(endpoint, method, 'missing-input', endpoint.route, undefined, [200, 400, 404, 422], 'GET without required query'));
        if (endpoint.queryEquals.length > 0) {
          const param = endpoint.queryEquals[0].param;
          out.push(scenario(
            endpoint,
            method,
            'invalid-input',
            withQuery(endpoint.route, param, '__invalid__'),
            undefined,
            [200, 400, 404, 422],
            'GET with unknown ' + param,
          ));
        }
      }
      if (looksDynamic(endpoint.route)) {
        out.push(scenario(endpoint, method, 'missing-resource', withMissingId(endpoint.route), undefined, [404, 400], 'GET missing resource'));
      }
    }

    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      if (endpoint.hasJsonBody) {
        out.push(scenario(endpoint, method, 'missing-input', endpoint.route, undefined, [400, 422], 'JSON body missing required fields'));
        out.push(scenario(
          endpoint,
          method,
          'invalid-input',
          endpoint.route,
          invalidBody(endpoint),
          [400, 422],
          'JSON body with invalid field types',
        ));
        out.push(scenario(endpoint, method, 'malformed-input', endpoint.route, '{', [400, 415, 422], 'Malformed JSON body'));
        if (profile === 'PRODUCTION' || profile === 'STANDARD') {
          out.push(scenario(
            endpoint,
            method,
            'boundary-value',
            endpoint.route,
            boundaryBody(endpoint),
            [200, 201, 400, 413, 422],
            'Boundary-length field value',
          ));
        }
        if (profile === 'PRODUCTION') {
          out.push(scenario(
            endpoint,
            method,
            'duplicate-request',
            endpoint.route,
            happyBody(endpoint),
            [200, 201, 400, 409, 422],
            'Duplicate ' + method + ' with the same payload',
          ));
          out.push(scenario(
            endpoint,
            method,
            'repeated-request',
            endpoint.route,
            happyBody(endpoint),
            [200, 201, 400, 409, 422],
            'Repeated ' + method + ' with the same payload',
          ));
        }
      }
    }

    if (method === 'DELETE') {
      if (looksDynamic(endpoint.route)) {
        out.push(scenario(endpoint, method, 'missing-resource', withMissingId(endpoint.route), undefined, [404, 400, 405], 'DELETE missing resource'));
      }
    }

    if (endpoint.requiresAuth) {
      out.push(unauthorized(endpoint, method));
      if (profile === 'PRODUCTION' && /userId|ownerId|accountId/i.test(endpoint.file + endpoint.route)) {
        out.push(scenario(
          endpoint,
          method,
          'forbidden',
          endpoint.route,
          method === 'GET' ? undefined : happyBody(endpoint),
          [401, 403, 404],
          'Authenticated caller accessing another principal resource',
          { Cookie: 'auth=true' },
        ));
      }
    }
  }
  return capScenarios(out, profile);
}

export function scenarioPassed(scenario: ApiScenario, status: number): boolean {
  if (status >= 500) return false;
  if (scenario.kind === 'happy-path') return status >= 200 && status < 400;
  if (scenario.expectedStatuses.length === 0) return status < 500;
  return scenario.expectedStatuses.includes(status) || (status >= 400 && status < 500);
}

export function formatApiEvidence(input: {
  readonly method: string;
  readonly url: string;
  readonly route: string;
  readonly scenario: string;
  readonly expected: string;
  readonly actual: number;
  readonly response: string;
  readonly timestamp?: string;
  readonly file?: string;
  readonly request?: string;
}): string {
  const parts = [
    'method: ' + input.method,
    'URL: ' + input.url,
    'route: ' + input.route,
    'scenario: ' + input.scenario,
    'Expected: ' + input.expected,
    'Actual: ' + input.actual,
    'response: ' + input.response.slice(0, 400),
  ];
  if (input.request) parts.push('request: ' + input.request.slice(0, 200));
  if (input.timestamp) parts.push('timestamp: ' + input.timestamp);
  if (input.file) parts.push('source: ' + input.file);
  return parts.join('; ');
}

export function sensitiveFieldsIn(body: string): string[] {
  const hits: string[] = [];
  try {
    const parsed = JSON.parse(body);
    walkSensitive(parsed, '', hits);
  } catch {
    if (/password|privateKey|secret|ssn|creditCard/i.test(body)) hits.push('opaque-sensitive-token');
  }
  return hits;
}

function walkSensitive(value: unknown, path: string, hits: string[]): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.slice(0, 5).forEach((item, index) => walkSensitive(item, path + '[' + index + ']', hits));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = path ? path + '.' + key : key;
    if (/password|privateKey|secret|ssn|creditCard/i.test(key) && child) {
      hits.push(next);
    }
    walkSensitive(child, next, hits);
  }
}

function happyPath(endpoint: DiscoveredEndpoint, method: HttpMethod): ApiScenario {
  let path = endpoint.route;
  if (method === 'GET' && endpoint.queryEquals.length > 0) {
    const first = endpoint.queryEquals[0];
    path = withQuery(endpoint.route, first.param, first.value);
  }
  const body = method === 'GET' || method === 'DELETE' ? undefined : (endpoint.hasJsonBody ? happyBody(endpoint) : undefined);
  const headers: Record<string, string> = {};
  if (body) headers['content-type'] = 'application/json';
  if (endpoint.requiresAuth) headers.Cookie = 'auth=true';
  return scenario(endpoint, method, 'happy-path', path, body, [200, 201, 204], method + ' happy path', headers);
}

function unauthorized(endpoint: DiscoveredEndpoint, method: HttpMethod): ApiScenario {
  const body = method === 'GET' || method === 'DELETE' ? undefined : (endpoint.hasJsonBody ? happyBody(endpoint) : undefined);
  return scenario(
    endpoint,
    method,
    'unauthorized',
    endpoint.route,
    body,
    [401, 403, 404],
    method + ' without credentials',
    body ? { 'content-type': 'application/json' } : {},
  );
}

function scenario(
  endpoint: DiscoveredEndpoint,
  method: HttpMethod,
  kind: ApiScenarioKind,
  path: string,
  body: string | undefined,
  expectedStatuses: number[],
  description: string,
  extraHeaders: Record<string, string> = {},
): ApiScenario {
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined && !headers['content-type'] && !headers['Content-Type']) {
    headers['content-type'] = 'application/json';
  }
  return {
    id: 'api-' + kind + '-' + method.toLowerCase() + '-' + endpoint.route.replace(/[^\w]+/g, '-'),
    kind,
    method,
    route: endpoint.route,
    path,
    body,
    headers,
    expectedStatuses,
    description,
  };
}

function happyBody(endpoint: DiscoveredEndpoint): string {
  const obj: Record<string, unknown> = {};
  const fields = endpoint.jsonFields.length > 0 ? endpoint.jsonFields : ['id'];
  for (const field of fields) {
    obj[field] = field.toLowerCase().includes('id') ? 'vv-probe' : 'ok';
  }
  return JSON.stringify(obj);
}

function invalidBody(endpoint: DiscoveredEndpoint): string {
  const obj: Record<string, unknown> = {};
  const fields = endpoint.jsonFields.length > 0 ? endpoint.jsonFields : ['id'];
  for (const field of fields) {
    obj[field] = null;
  }
  obj['__unexpected'] = { nested: true };
  return JSON.stringify(obj);
}

function boundaryBody(endpoint: DiscoveredEndpoint): string {
  const obj: Record<string, unknown> = {};
  const fields = endpoint.jsonFields.length > 0 ? endpoint.jsonFields : ['id'];
  for (const field of fields) {
    obj[field] = 'x'.repeat(field.toLowerCase().includes('id') ? 256 : 4000);
  }
  return JSON.stringify(obj);
}

function withQuery(route: string, param: string, value: string): string {
  return route + (route.includes('?') ? '&' : '?') + encodeURIComponent(param) + '=' + encodeURIComponent(value);
}

function looksDynamic(route: string): boolean {
  return /\[[^\]]+\]|:[\w]+/.test(route);
}

function withMissingId(route: string): string {
  return route.replace(/\[[^\]]+\]/g, 'missing-vv-id').replace(/:[\w]+/g, 'missing-vv-id');
}

function capScenarios(scenarios: ApiScenario[], profile: QualityProfile): ApiScenario[] {
  const max = profile === 'PRODUCTION' ? 8 : 4;
  const preferred: ApiScenarioKind[] = [
    'happy-path',
    'missing-input',
    'malformed-input',
    'invalid-input',
    'unauthorized',
    'missing-resource',
    'boundary-value',
    'duplicate-request',
    'repeated-request',
    'forbidden',
  ];
  const sorted = scenarios.slice().sort((a, b) => preferred.indexOf(a.kind) - preferred.indexOf(b.kind));
  const seen = new Set<string>();
  const out: ApiScenario[] = [];
  for (const item of sorted) {
    const key = item.kind + ':' + item.method + ':' + item.path;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
