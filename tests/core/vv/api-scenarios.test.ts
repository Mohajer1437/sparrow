import { generateScenarios, parseRouteModule, scenarioPassed, sensitiveFieldsIn } from '../../../src/core/vv/api-scenarios';

const saveSource = `
import { NextResponse } from 'next/server';
export async function POST(req: Request) {
  const { id } = await req.json();
  return NextResponse.json({ success: true, id });
}
`;

const cardsSource = `
export async function GET(req: Request) {
  const type = req.nextUrl.searchParams.get('type');
  if (type === 'questions') return Response.json({ cards: [] });
  return Response.json({ cards: [] });
}
`;

describe('API scenario generation', () => {
  it('parses Next route methods, JSON fields, and query equals without using GET for POST-only', () => {
    const save = parseRouteModule('app/api/save/route.ts', saveSource, '/api/save');
    expect(save.methods).toEqual(['POST']);
    expect(save.hasJsonBody).toBe(true);
    expect(save.jsonFields).toEqual(['id']);
    const scenarios = generateScenarios(save, 'STANDARD');
    expect(scenarios.every(s => s.method === 'POST')).toBe(true);
    expect(scenarios.some(s => s.kind === 'happy-path')).toBe(true);
    expect(scenarios.some(s => s.kind === 'missing-input')).toBe(true);
    expect(scenarios.some(s => s.kind === 'malformed-input')).toBe(true);
    expect(scenarios.some(s => s.kind === 'invalid-input')).toBe(true);
    expect(scenarios.some(s => s.kind === 'happy-path' && s.method === 'GET')).toBe(false);
  });

  it('generates GET query scenarios rather than a POST body matrix', () => {
    const cards = parseRouteModule('app/api/cards/route.ts', cardsSource, '/api/cards');
    const scenarios = generateScenarios(cards, 'STANDARD');
    expect(scenarios.every(s => s.method === 'GET')).toBe(true);
    expect(scenarios.some(s => s.kind === 'happy-path' && s.path.includes('type=questions'))).toBe(true);
    expect(scenarios.some(s => s.kind === 'malformed-input')).toBe(false);
  });

  it('treats 5xx as failure for missing/malformed input even if 400 was expected', () => {
    const save = parseRouteModule('app/api/save/route.ts', saveSource, '/api/save');
    const missing = generateScenarios(save, 'STANDARD').find(s => s.kind === 'missing-input')!;
    const malformed = generateScenarios(save, 'STANDARD').find(s => s.kind === 'malformed-input')!;
    expect(scenarioPassed(missing, 500)).toBe(false);
    expect(scenarioPassed(malformed, 500)).toBe(false);
    expect(scenarioPassed(missing, 400)).toBe(true);
    expect(scenarioPassed(malformed, 400)).toBe(true);
  });

  it('flags unexpected sensitive fields in JSON responses', () => {
    expect(sensitiveFieldsIn('{"ok":true,"password":"secret"}')).toEqual(['password']);
    expect(sensitiveFieldsIn('{"cards":[]}')).toEqual([]);
  });
});
