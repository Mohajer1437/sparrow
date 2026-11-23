import { GlobalVersionKnowledgeRegistry } from '../../../src/core/version/global-knowledge';
import { VersionKnowledgeResolver } from '../../../src/core/version/version-knowledge-resolver';
import {
  ProjectDependency,
  ProjectDependencyOverride,
} from '../../../src/domain/version-intelligence';

describe('Version Knowledge Resolver', () => {
  let registry: GlobalVersionKnowledgeRegistry;
  let resolver: VersionKnowledgeResolver;

  beforeEach(() => {
    registry = new GlobalVersionKnowledgeRegistry();
    resolver = new VersionKnowledgeResolver(registry);
  });

  it('resolves global version knowledge when matching version is detected', () => {
    const deps: ProjectDependency[] = [
      {
        name: 'next',
        normalizedName: 'nextjs',
        category: 'framework',
        declaredVersion: '^14.2.0',
        resolvedVersion: '14.2.35',
        versionSource: 'lockfile',
        dependencyType: 'dependencies',
      },
    ];

    const result = resolver.resolve({
      dependencies: deps,
      projectOverrides: [],
    });

    expect(result.effectiveKnowledge.length).toBe(1);
    const ek = result.effectiveKnowledge[0];
    expect(ek.technology).toBe('nextjs');
    expect(ek.normalizedVersion).toBe('14.2.35');
    expect(ek.status).toBe('RESOLVED');
    expect(ek.effectiveSource).toBe('global');
    expect(ek.matchedKnowledgeRef).toBe('knowledge/nextjs/14');
    expect(ek.provenance).toContain('Resolved from global knowledge nextjs/14');
    expect(ek.guidance.some(g => g.includes('App Router'))).toBe(true);
    expect(result.staleItems.length).toBe(0);
    expect(result.conflicts.length).toBe(0);
  });

  it('enforces precedence: project override wins over global version knowledge', () => {
    const deps: ProjectDependency[] = [
      {
        name: 'prisma',
        normalizedName: 'prisma',
        category: 'orm',
        declaredVersion: '^7.0.0',
        resolvedVersion: '7.2.1',
        versionSource: 'lockfile',
        dependencyType: 'dependencies',
      },
    ];

    const overrides: ProjectDependencyOverride[] = [
      {
        technology: 'prisma',
        applicableVersion: '7.x',
        summary: 'Project-specific Prisma 7 configuration',
        guidance: ['Use PgBouncer driver adapter exclusively.'],
        filePath: '.ai/dependencies/prisma.md',
        source: 'project-override',
      },
    ];

    const result = resolver.resolve({
      dependencies: deps,
      projectOverrides: overrides,
    });

    expect(result.effectiveKnowledge.length).toBe(1);
    const ek = result.effectiveKnowledge[0];
    expect(ek.technology).toBe('prisma');
    expect(ek.status).toBe('PROJECT_OVERRIDE');
    expect(ek.effectiveSource).toBe('project-override');
    expect(ek.guidance).toEqual(['Use PgBouncer driver adapter exclusively.']);
    expect(ek.overridePath).toBe('.ai/dependencies/prisma.md');
    expect(ek.provenance).toContain('Project override .ai/dependencies/prisma.md took precedence over global knowledge prisma/7');

    // Conflict is recorded
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].technology).toBe('prisma');
    expect(result.conflicts[0].overridePath).toBe('.ai/dependencies/prisma.md');
  });

  it('detects STALE knowledge when project version violates override applicableVersion', () => {
    const deps: ProjectDependency[] = [
      {
        name: 'prisma',
        normalizedName: 'prisma',
        category: 'orm',
        declaredVersion: '^7.0.0',
        resolvedVersion: '7.2.1',
        versionSource: 'lockfile',
        dependencyType: 'dependencies',
      },
    ];

    const overrides: ProjectDependencyOverride[] = [
      {
        technology: 'prisma',
        applicableVersion: '^6.0.0', // Stale! Project is Prisma 7
        summary: 'Legacy Prisma 6 rules',
        guidance: ['Do not use createManyAndReturn.'],
        filePath: '.ai/dependencies/prisma.md',
        source: 'project-override',
      },
    ];

    const result = resolver.resolve({
      dependencies: deps,
      projectOverrides: overrides,
    });

    expect(result.staleItems.length).toBe(1);
    expect(result.staleItems[0].technology).toBe('prisma');
    expect(result.staleItems[0].installedVersion).toBe('7.2.1');
    expect(result.staleItems[0].declaredApplicableVersion).toBe('^6.0.0');
    expect(result.staleItems[0].overridePath).toBe('.ai/dependencies/prisma.md');

    // The stale override does NOT become the effective guidance. Global Prisma 7 knowledge is used instead with STALE_KNOWLEDGE status
    expect(result.effectiveKnowledge.length).toBe(1);
    const ek = result.effectiveKnowledge[0];
    expect(ek.status).toBe('STALE_KNOWLEDGE');
    expect(ek.effectiveSource).toBe('global');
    expect(ek.matchedKnowledgeRef).toBe('knowledge/prisma/7');
    expect(ek.staleReason).toContain('targets ^6.0.0');
  });

  it('handles known technology with unsupported version explicitly without guessing', () => {
    const deps: ProjectDependency[] = [
      {
        name: 'next',
        normalizedName: 'nextjs',
        category: 'framework',
        declaredVersion: '^12.0.0',
        resolvedVersion: '12.3.4',
        versionSource: 'lockfile',
        dependencyType: 'dependencies',
      },
    ];

    const result = resolver.resolve({
      dependencies: deps,
      projectOverrides: [],
    });

    expect(result.effectiveKnowledge.length).toBe(1);
    const ek = result.effectiveKnowledge[0];
    expect(ek.status).toBe('VERSION_KNOWN_KNOWLEDGE_UNAVAILABLE');
    expect(ek.effectiveSource).toBe('generic');
    expect(ek.guidance.some(g => g.includes('Rely on generic project patterns'))).toBe(true);
  });

  it('handles unknown version explicitly without fabricating version guidance', () => {
    const deps: ProjectDependency[] = [
      {
        name: 'next',
        normalizedName: 'nextjs',
        category: 'framework',
        declaredVersion: undefined,
        resolvedVersion: undefined,
        versionSource: 'unknown',
        dependencyType: 'dependencies',
      },
    ];

    const result = resolver.resolve({
      dependencies: deps,
      projectOverrides: [],
    });

    expect(result.effectiveKnowledge.length).toBe(1);
    const ek = result.effectiveKnowledge[0];
    expect(ek.status).toBe('VERSION_UNKNOWN');
    expect(ek.normalizedVersion).toBe('UNKNOWN');
  });
});
