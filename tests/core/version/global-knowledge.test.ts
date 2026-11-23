import {
  GLOBAL_VERSION_KNOWLEDGE,
  GlobalVersionKnowledgeRegistry,
} from '../../../src/core/version/global-knowledge';

describe('Global Version Knowledge Storage & Matching', () => {
  let registry: GlobalVersionKnowledgeRegistry;

  beforeEach(() => {
    registry = new GlobalVersionKnowledgeRegistry();
  });

  it('contains stable knowledge definitions for Next.js, Prisma, and NestJS', () => {
    const list = registry.list();
    expect(list.length).toBeGreaterThanOrEqual(6);

    const next14 = registry.get('nextjs/14');
    expect(next14).toBeDefined();
    expect(next14?.versionRange).toBe('>=14.0.0 <15.0.0');
    expect(next14?.guidance.some(g => g.includes('App Router'))).toBe(true);

    const next15 = registry.get('nextjs/15');
    expect(next15).toBeDefined();
    expect(next15?.guidance.some(g => g.includes('Async Request APIs'))).toBe(true);
    expect(next15?.breakingChanges?.some(b => b.includes('cookies() and headers() return Promises'))).toBe(true);

    const next16 = registry.get('nextjs/16');
    expect(next16).toBeDefined();
    expect(next16?.guidance.some(g => g.includes('Dynamic IO'))).toBe(true);

    const prisma7 = registry.get('prisma/7');
    expect(prisma7).toBeDefined();
    expect(prisma7?.guidance.some(g => g.includes('createManyAndReturn'))).toBe(true);
    expect(prisma7?.guidance.some(g => g.includes('TypedSQL'))).toBe(true);
  });

  it('matches Next.js 14 correctly based on installed semver', () => {
    const matches = registry.findMatches('nextjs', '14.2.35');
    expect(matches.length).toBe(1);
    expect(matches[0].id).toBe('nextjs/14');
  });

  it('matches Next.js 15 correctly based on installed semver', () => {
    const matches = registry.findMatches('nextjs', '15.0.3');
    expect(matches.length).toBe(1);
    expect(matches[0].id).toBe('nextjs/15');
  });

  it('matches Prisma 7 correctly based on installed semver', () => {
    const matches = registry.findMatches('prisma', '7.2.1');
    expect(matches.length).toBe(1);
    expect(matches[0].id).toBe('prisma/7');
  });

  it('returns empty array when version is outside known ranges', () => {
    const matches = registry.findMatches('nextjs', '12.0.0');
    expect(matches.length).toBe(0);
  });

  it('returns all technology knowledge when version is unknown', () => {
    const matches = registry.findMatches('nextjs', 'UNKNOWN');
    expect(matches.length).toBe(3); // 14, 15, 16
  });

  it('supports registering new modular knowledge without modifying generic skills', () => {
    registry.register({
      id: 'express/5',
      technology: 'express',
      versionRange: '>=5.0.0 <6.0.0',
      knowledgeRef: 'knowledge/express/5',
      title: 'Express 5 Guidance',
      summary: 'Express 5 router changes and async error handling.',
      guidance: ['Native Promise-based error handling in route handlers.'],
      priority: 10,
      source: 'global',
    });

    const match = registry.findMatches('express', '5.0.1');
    expect(match.length).toBe(1);
    expect(match[0].id).toBe('express/5');
  });
});
