/**
 * HTTP API routes vs Next.js filesystem paths.
 *
 * Filesystem: app/api/save/route.ts
 * HTTP route: /api/save
 *
 * Never treat the filename `route` as a path segment.
 * Never invent app/api/save/route/route.ts.
 */

const HTTP_METHOD_RE = /\b(GET|POST|PUT|PATCH|DELETE)\b/;
const METHOD_AND_ROUTE_RE = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[A-Za-z0-9/_-]*[A-Za-z0-9_-])/i;
const APP_ROUTER_FILE_RE = /\b((?:src\/)?app\/api\/(?:[\w\-./]+\/)?route\.(?:ts|js|tsx|jsx))\b/i;
const PAGES_API_FILE_RE = /\b((?:src\/)?pages\/api\/[\w\-./]+\.(?:ts|js|tsx|jsx))\b/i;

export function normalizeApiRoute(route: string): string {
  let r = route.replace(/\\/g, '/').split(/[?\s,#;]/)[0];
  r = r.replace(/\.tsx?$/i, '').replace(/\.jsx?$/i, '');
  r = r.replace(/\/route$/i, '');
  r = r.replace(/\/+$/, '');
  if (!r.startsWith('/')) r = '/' + r;
  if (r === '/api/' || r === '/api') return '/api';
  return r;
}

export function sourceFileToApiRoute(file: string): string | undefined {
  const n = file.replace(/\\/g, '/');
  const app = n.match(/(?:^|\/)(?:src\/)?app\/api\/(?:(.+)\/)?route\.(ts|js|tsx|jsx)$/i);
  if (app) {
    let segments = (app[1] || '').replace(/\\/g, '/').replace(/\/route$/i, '');
    segments = segments.replace(/\/index$/i, '');
    return segments ? '/api/' + segments : '/api';
  }
  const pages = n.match(/(?:^|\/)(?:src\/)?pages\/api\/(.+)\.(ts|js|tsx|jsx)$/i);
  if (pages) {
    const segments = pages[1].replace(/\\/g, '/').replace(/\/index$/i, '');
    return '/api/' + segments;
  }
  return undefined;
}

export function apiRouteToSourceFile(route: string): string {
  const normalized = normalizeApiRoute(route);
  const trimmed = normalized.replace(/^\/api\/?/, '').replace(/\/$/, '');
  if (!trimmed) return 'app/api/route.ts';
  return 'app/api/' + trimmed + '/route.ts';
}

export function sanitizeImplicatedSourcePath(file: string): string {
  return file.replace(/\\/g, '/').replace(/\/route\/route\.(ts|js|tsx|jsx)$/i, '/route.$1');
}

export function extractHttpMethod(text: string): string | undefined {
  const match = text.match(HTTP_METHOD_RE);
  return match ? match[1].toUpperCase() : undefined;
}

/**
 * Prefer an explicit `POST /api/save` expression. Only infer from a
 * Next.js source path when the HTTP route is not written in the text.
 */
export function extractApiRouteFromText(text: string): string | undefined {
  if (!text) return undefined;

  const methodAndRoute = text.match(METHOD_AND_ROUTE_RE);
  if (methodAndRoute) return normalizeApiRoute(methodAndRoute[2]);

  const appFile = text.match(APP_ROUTER_FILE_RE);
  if (appFile) {
    const fromFile = sourceFileToApiRoute(appFile[1]);
    if (fromFile) return fromFile;
  }
  const pagesFile = text.match(PAGES_API_FILE_RE);
  if (pagesFile) {
    const fromFile = sourceFileToApiRoute(pagesFile[1]);
    if (fromFile) return fromFile;
  }

  const withoutFiles = text
    .replace(/\b(?:src\/)?(?:app|pages)\/api\/[\w\-./]+\.(?:ts|js|tsx|jsx)\b/gi, ' ');
  const standalone = withoutFiles.match(/(?:^|[^\w./])(\/api\/[A-Za-z0-9/_-]*[A-Za-z0-9_-])/);
  if (standalone) return normalizeApiRoute(standalone[1]);

  return undefined;
}
