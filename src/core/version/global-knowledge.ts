/**
 * Global Version Knowledge definitions and registry.
 * Encodes durable version-specific implementation guidance for frameworks and tools.
 * Generic skills remain durable and version-agnostic.
 */

import {
  freezeVersionKnowledge,
  VersionKnowledge,
} from '../../domain/version-intelligence';
import { satisfiesRange } from './semver';

export const GLOBAL_VERSION_KNOWLEDGE: ReadonlyArray<VersionKnowledge> = Object.freeze([
  // Next.js 14
  freezeVersionKnowledge({
    id: 'nextjs/14',
    technology: 'nextjs',
    versionRange: '>=14.0.0 <15.0.0',
    knowledgeRef: 'knowledge/nextjs/14',
    title: 'Next.js 14 Implementation Guidance',
    summary: 'Next.js 14 App Router, Server Actions, and stable metadata configuration.',
    guidance: [
      'Use the App Router (app/ directory) as the standard routing paradigm.',
      'Server Components are default; add "use client" directive at the top of files only for client interactivity (hooks, event handlers).',
      'Server Actions require "use server" at top of file or within async functions.',
      'cookies() and headers() from next/headers are synchronous in Next.js 14.',
      'Page params and searchParams are synchronous objects in props in Next.js 14.',
      'Use next/font/google or next/font/local for font loading.',
    ],
    compatibilityNotes: [
      'Requires React 18 and Node.js >= 18.17.0.',
      'fetch() requests are cached by default (force-cache).',
    ],
    testingGuidance: [
      'Test server components using React Server Component testing utilities or end-to-end browser tests.',
    ],
    priority: 10,
    source: 'global',
  }),

  // Next.js 15
  freezeVersionKnowledge({
    id: 'nextjs/15',
    technology: 'nextjs',
    versionRange: '>=15.0.0 <16.0.0',
    knowledgeRef: 'knowledge/nextjs/15',
    title: 'Next.js 15 Implementation Guidance',
    summary: 'Next.js 15 Async Request APIs, React 19 support, and uncached fetch defaults.',
    guidance: [
      'Async Request APIs: cookies(), headers(), params, and searchParams are asynchronous and MUST be awaited (e.g. const cookieStore = await cookies(); const { id } = await params).',
      'fetch() requests are NOT cached by default; use cache: "force-cache" explicitly if caching is desired.',
      'Route handlers GET requests are no longer cached by default.',
      'Client components use React 19 features (useActionState, useOptimistic, use).',
      'next/after API is available for background processing after response finishes.',
    ],
    compatibilityNotes: [
      'Requires React 19 (or RC) and Node.js >= 18.18.0.',
      'Synchronous access to params or cookies() causes runtime warnings or errors.',
    ],
    breakingChanges: [
      'cookies() and headers() return Promises that must be awaited.',
      'params and searchParams in page/layout/route are Promises that must be awaited.',
    ],
    testingGuidance: [
      'Ensure test mocks for cookies(), headers(), and params return Promises.',
    ],
    priority: 10,
    source: 'global',
  }),

  // Next.js 16
  freezeVersionKnowledge({
    id: 'nextjs/16',
    technology: 'nextjs',
    versionRange: '>=16.0.0 <17.0.0',
    knowledgeRef: 'knowledge/nextjs/16',
    title: 'Next.js 16 Implementation Guidance',
    summary: 'Next.js 16 Dynamic IO, Cache Life profiles, and Turbopack default.',
    guidance: [
      'Dynamic IO is enabled by default for granular data-driven caching.',
      'Use use cache and cacheLife() directives instead of legacy revalidate segments.',
      'Turbopack is the default bundler for both dev and build workflows.',
      'Page and layout params remain asynchronous Promises.',
      'Enhanced Server Actions with built-in progressive enhancement and security boundaries.',
    ],
    compatibilityNotes: [
      'Requires React 19 and Node.js >= 20.9.0.',
    ],
    breakingChanges: [
      'Legacy unstable_cache is superseded by "use cache" directive.',
    ],
    priority: 10,
    source: 'global',
  }),

  // Prisma 6
  freezeVersionKnowledge({
    id: 'prisma/6',
    technology: 'prisma',
    versionRange: '>=6.0.0 <7.0.0',
    knowledgeRef: 'knowledge/prisma/6',
    title: 'Prisma 6 Implementation Guidance',
    summary: 'Prisma 6 query compiler optimizations and standard migration workflows.',
    guidance: [
      'Use standard Prisma Client queries with include and select.',
      'Use prisma migrate dev for local schema migrations and prisma migrate deploy in production.',
      'Use prisma db push for rapid prototyping or prototyping databases.',
      'Transactions use prisma.$transaction([ ... ]) or interactive callbacks.',
    ],
    compatibilityNotes: [
      'Requires Node.js >= 18.18.0.',
    ],
    priority: 10,
    source: 'global',
  }),

  // Prisma 7
  freezeVersionKnowledge({
    id: 'prisma/7',
    technology: 'prisma',
    versionRange: '>=7.0.0 <8.0.0',
    knowledgeRef: 'knowledge/prisma/7',
    title: 'Prisma 7 Implementation Guidance',
    summary: 'Prisma 7 createManyAndReturn, TypedSQL support, and Driver Adapters.',
    guidance: [
      'Use createManyAndReturn() to create multiple records and return fields or related records in a single query.',
      'Use TypedSQL (@prisma/client/sql) for type-safe raw SQL queries instead of raw untyped queryRaw.',
      'Use Driver Adapters (@prisma/adapter-pg, @prisma/adapter-planetscale, etc.) for database connection pooling.',
      'Do not use legacy removed CLI flags from Prisma 5/6.',
    ],
    compatibilityNotes: [
      'Requires Node.js >= 20.0.0.',
      'Driver Adapters are standard for serverless and edge environments.',
    ],
    breakingChanges: [
      'Legacy Prisma client engine flags removed in favor of Driver Adapters.',
    ],
    testingGuidance: [
      'Use in-memory database adapters or read-only assertion fixtures for verification.',
    ],
    priority: 10,
    source: 'global',
  }),

  // NestJS 10
  freezeVersionKnowledge({
    id: 'nestjs/10',
    technology: 'nestjs',
    versionRange: '>=10.0.0 <11.0.0',
    knowledgeRef: 'knowledge/nestjs/10',
    title: 'NestJS 10 Implementation Guidance',
    summary: 'NestJS 10 SWC compilation, Fastify v4 support, and RxJS 7 baseline.',
    guidance: [
      'Use standard NestJS module and controller decorators: @Controller, @Get, @Post, @Injectable, @Module.',
      'SWC builder is supported for high-speed local compilation via nest start -b swc.',
      'Requires RxJS >= 7.0.0.',
      'Fastify adapter uses Fastify v4.',
    ],
    compatibilityNotes: [
      'Requires Node.js >= 16.0.0 (Node 18+ recommended).',
    ],
    priority: 10,
    source: 'global',
  }),

  // NestJS 11
  freezeVersionKnowledge({
    id: 'nestjs/11',
    technology: 'nestjs',
    versionRange: '>=11.0.0 <12.0.0',
    knowledgeRef: 'knowledge/nestjs/11',
    title: 'NestJS 11 Implementation Guidance',
    summary: 'NestJS 11 Express v5 compatibility and updated decorator metadata.',
    guidance: [
      'Express v5 is supported as the default HTTP engine.',
      'Supports standard TypeScript 5+ decorator metadata and stage 3 decorators.',
      'Enhanced dependency injection resolution and lifecycle hooks.',
    ],
    compatibilityNotes: [
      'Requires Node.js >= 20.0.0.',
    ],
    priority: 10,
    source: 'global',
  }),
]);

/**
 * Storage and registry for Global Version Knowledge.
 */
export class GlobalVersionKnowledgeRegistry {
  private readonly items = new Map<string, VersionKnowledge>();

  constructor(initialItems: ReadonlyArray<VersionKnowledge> = GLOBAL_VERSION_KNOWLEDGE) {
    for (const item of initialItems) {
      this.items.set(item.id, freezeVersionKnowledge(item));
    }
  }

  register(item: VersionKnowledge): void {
    this.items.set(item.id, freezeVersionKnowledge(item));
  }

  get(id: string): VersionKnowledge | undefined {
    return this.items.get(id);
  }

  list(): ReadonlyArray<VersionKnowledge> {
    return Object.freeze([...this.items.values()]);
  }

  /**
   * Finds matching version knowledge items for a technology and version string.
   * Items are sorted by priority (highest first) and specificity.
   */
  findMatches(technology: string, versionStr?: string): ReadonlyArray<VersionKnowledge> {
    const techLower = technology.toLowerCase();
    const candidates = [...this.items.values()].filter(
      item => item.technology.toLowerCase() === techLower,
    );

    if (!versionStr || versionStr.toUpperCase() === 'UNKNOWN') {
      return Object.freeze(candidates);
    }

    const matches = candidates.filter(item => satisfiesRange(versionStr, item.versionRange));

    // Sort by priority desc, then ID asc
    matches.sort((a, b) => {
      const pA = a.priority ?? 0;
      const pB = b.priority ?? 0;
      if (pA !== pB) return pB - pA;
      return a.id.localeCompare(b.id);
    });

    return Object.freeze(matches);
  }
}
