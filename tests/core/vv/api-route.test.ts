import {
  apiRouteToSourceFile,
  extractApiRouteFromText,
  normalizeApiRoute,
  sanitizeImplicatedSourcePath,
  sourceFileToApiRoute,
} from '../../../src/core/vv/api-route';

describe('API route extraction', () => {
  it('extracts /api/save from method + route even when a route.ts file is named', () => {
    expect(extractApiRouteFromText('In app/api/save/route.ts, POST /api/save')).toBe('/api/save');
    expect(extractApiRouteFromText('In app/api/save/route.ts, POST /api/save')).not.toBe('/api/save/route');
  });

  it('converts an App Router API file to /api/<segments>', () => {
    expect(sourceFileToApiRoute('app/api/save/route.ts')).toBe('/api/save');
    expect(extractApiRouteFromText('see app/api/save/route.ts')).toBe('/api/save');
  });

  it('converts a Pages API file to /api/<segments>', () => {
    expect(sourceFileToApiRoute('pages/api/save.ts')).toBe('/api/save');
    expect(sourceFileToApiRoute('src/pages/api/hello.ts')).toBe('/api/hello');
    expect(extractApiRouteFromText('edit pages/api/save.ts')).toBe('/api/save');
  });

  it('extracts nested App Router paths without the route.ts filename', () => {
    expect(sourceFileToApiRoute('app/api/v1/users/route.ts')).toBe('/api/v1/users');
    expect(extractApiRouteFromText('PATCH /api/v1/users in app/api/v1/users/route.ts')).toBe('/api/v1/users');
  });

  it('never produces /api/save/route from a route.ts file path', () => {
    expect(normalizeApiRoute('/api/save/route')).toBe('/api/save');
    expect(sourceFileToApiRoute('app/api/save/route.ts')).not.toMatch(/\/route$/);
    expect(sourceFileToApiRoute('app/api/save/route/route.ts')).toBe('/api/save');
  });

  it('never invents app/api/save/route/route.ts from /api/save', () => {
    expect(apiRouteToSourceFile('/api/save')).toBe('app/api/save/route.ts');
    expect(apiRouteToSourceFile('/api/save/route')).toBe('app/api/save/route.ts');
    expect(sanitizeImplicatedSourcePath('app/api/save/route/route.ts')).toBe('app/api/save/route.ts');
  });
});
