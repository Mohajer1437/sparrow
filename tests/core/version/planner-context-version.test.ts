import { DefaultPlannerContextSerializer } from '../../../src/core/planning/planner-context-serializer';
import { DefaultPlannerContextAssembler } from '../../../src/core/planning/planner-context-assembler';
import { PlannerContextStrategyBuilder } from '../../../src/core/planning/planner-context-strategy-builder';
import { createDefaultSkillRegistry } from '../../../src/core/skill/default-skills';
import { freezeAiContextDiscovery } from '../../../src/domain/ai-context';
import { freezeProjectProfile } from '../../../src/domain/project-profile';
import { freezeGatheredContext } from '../../../src/domain/gathered-context';
import { DEFAULT_CONTEXT_GATHERING_LIMITS } from '../../../src/domain/context-gathering-limits';
import {
  freezeEffectiveVersionKnowledge,
  freezeProjectDependency,
  freezeStaleVersionKnowledge,
  freezeVersionIntelligenceContext,
  freezeVersionKnowledgeConflict,
} from '../../../src/domain/version-intelligence';

describe('PlannerContext Version Intelligence Integration', () => {
  let serializer: DefaultPlannerContextSerializer;
  let assembler: DefaultPlannerContextAssembler;
  let strategyBuilder: PlannerContextStrategyBuilder;
  const skillRegistry = createDefaultSkillRegistry();

  beforeEach(() => {
    serializer = new DefaultPlannerContextSerializer();
    assembler = new DefaultPlannerContextAssembler();
    strategyBuilder = new PlannerContextStrategyBuilder();
  });

  function makeResolvedSkills(skillIds: string[]) {
    return {
      skills: skillIds.map(id => skillRegistry.get(id)!),
      reasons: skillIds.map(id => ({ skillId: id, source: 'explicit' as const, detail: 'test' })),
      mode: 'explicit' as const,
    };
  }

  it('serializes resolved version intelligence and guidance into the prompt', () => {
    const projectProfile = freezeProjectProfile({
      workspaceRoot: 'E:/test-app',
      projectType: 'frontend',
      detectedFrameworks: ['nextjs'],
      languages: ['typescript'],
      packageManager: 'npm',
      availableTestingTools: ['jest'],
      detectedDomains: ['frontend'],
      capabilities: ['frontend.core'],
    });

    const aiContext = freezeAiContextDiscovery({
      workspaceRoot: 'E:/test-app',
      rootPath: 'E:/test-app/.ai',
      exists: true,
      files: [],
    });

    const resolvedSkills = makeResolvedSkills(['frontend.core']);

    const vi = freezeVersionIntelligenceContext({
      summary: '1 dependencies, 1 effective knowledge items (0 stale, 0 conflicts)',
      dependencies: [
        freezeProjectDependency({
          name: 'next',
          normalizedName: 'nextjs',
          category: 'framework',
          declaredVersion: '^14.2.0',
          resolvedVersion: '14.2.35',
          versionSource: 'lockfile',
          dependencyType: 'dependencies',
        }),
      ],
      effectiveKnowledge: [
        freezeEffectiveVersionKnowledge({
          technology: 'nextjs',
          declaredVersion: '^14.2.0',
          resolvedVersion: '14.2.35',
          normalizedVersion: '14.2.35',
          versionSource: 'lockfile',
          status: 'RESOLVED',
          effectiveSource: 'global',
          matchedKnowledgeRef: 'knowledge/nextjs/14',
          summary: 'Next.js 14 App Router guidance',
          guidance: [
            'Use Next.js 14 App Router conventions.',
            'Server Actions must be defined in separate actions files or top-level "use server".',
          ],
          provenance: 'Resolved from global knowledge nextjs/14 (range: >=14.0.0 <15.0.0)',
        }),
      ],
      staleItems: [],
      conflicts: [],
    });

    const strategy = strategyBuilder.build({
      userTask: 'Add a new feature',
      executionDirective: {},
      projectProfile,
      resolvedSkills,
      aiContext,
    });

    const gathered = freezeGatheredContext({
      workspaceRoot: 'E:/test-app',
      records: [],
      totalBytes: 0,
      fileCount: 0,
      truncatedCount: 0,
      limitReached: false,
      limits: DEFAULT_CONTEXT_GATHERING_LIMITS,
    });

    const plannerContext = assembler.assemble({
      userTask: 'Add a new feature',
      executionDirective: {},
      projectProfile,
      resolvedSkills,
      aiContext,
      strategy,
      gathered,
      versionIntelligence: vi,
    });

    const serialized = serializer.serialize(plannerContext);

    expect(serialized).toContain('--- VERSION INTELLIGENCE (authoritative dependency versions & guidance) ---');
    expect(serialized).toContain('- next (nextjs, category=framework): declared=^14.2.0, resolved=14.2.35, source=lockfile');
    expect(serialized).toContain('Technology: nextjs (version=14.2.35, status=RESOLVED, source=global)');
    expect(serialized).toContain('provenance: Resolved from global knowledge nextjs/14');
    expect(serialized).toContain('guidance:');
    expect(serialized).toContain('Use Next.js 14 App Router conventions.');
  });

  it('serializes stale knowledge warnings and conflicts explicitly', () => {
    const projectProfile = freezeProjectProfile({
      workspaceRoot: 'E:/test-app',
      projectType: 'backend',
      detectedFrameworks: [],
      languages: ['typescript'],
      packageManager: 'npm',
      availableTestingTools: [],
      detectedDomains: ['backend'],
      capabilities: ['backend.core'],
    });

    const aiContext = freezeAiContextDiscovery({
      workspaceRoot: 'E:/test-app',
      rootPath: 'E:/test-app/.ai',
      exists: true,
      files: [],
    });

    const resolvedSkills = makeResolvedSkills(['backend.core']);

    const vi = freezeVersionIntelligenceContext({
      summary: '1 dependencies, 1 effective knowledge items (1 stale, 1 conflicts)',
      dependencies: [
        freezeProjectDependency({
          name: 'prisma',
          normalizedName: 'prisma',
          category: 'orm',
          declaredVersion: '^7.0.0',
          resolvedVersion: '7.2.1',
          versionSource: 'lockfile',
          dependencyType: 'dependencies',
        }),
      ],
      effectiveKnowledge: [
        freezeEffectiveVersionKnowledge({
          technology: 'prisma',
          declaredVersion: '^7.0.0',
          resolvedVersion: '7.2.1',
          normalizedVersion: '7.2.1',
          versionSource: 'lockfile',
          status: 'STALE_KNOWLEDGE',
          effectiveSource: 'global',
          matchedKnowledgeRef: 'knowledge/prisma/7',
          summary: 'Prisma 7 guidance fallback',
          guidance: ['Use Prisma 7 TypedSQL.'],
          staleReason: 'Project override targets ^6.0.0 but project uses 7.2.1',
          provenance: 'Global knowledge fallback due to stale project override',
        }),
      ],
      staleItems: [
        freezeStaleVersionKnowledge({
          technology: 'prisma',
          overridePath: '.ai/dependencies/prisma.md',
          declaredApplicableVersion: '^6.0.0',
          installedVersion: '7.2.1',
          reason: 'Project override targets ^6.0.0 but project uses 7.2.1',
        }),
      ],
      conflicts: [
        freezeVersionKnowledgeConflict({
          technology: 'prisma',
          overridePath: '.ai/dependencies/prisma.md',
          globalKnowledgeId: 'prisma/7',
          globalGuidance: ['Prisma 7 standard guidance'],
          overrideGuidance: ['Prisma 6 override guidance'],
          resolution: 'Project override applies with precedence',
        }),
      ],
    });

    const strategy = strategyBuilder.build({
      userTask: 'Add db query',
      executionDirective: {},
      projectProfile,
      resolvedSkills,
      aiContext,
    });

    const gathered = freezeGatheredContext({
      workspaceRoot: 'E:/test-app',
      records: [],
      totalBytes: 0,
      fileCount: 0,
      truncatedCount: 0,
      limitReached: false,
      limits: DEFAULT_CONTEXT_GATHERING_LIMITS,
    });

    const plannerContext = assembler.assemble({
      userTask: 'Add db query',
      executionDirective: {},
      projectProfile,
      resolvedSkills,
      aiContext,
      strategy,
      gathered,
      versionIntelligence: vi,
    });

    const serialized = serializer.serialize(plannerContext);

    expect(serialized).toContain('Stale Project Knowledge Detected:');
    expect(serialized).toContain('! [STALE] prisma: installed=7.2.1, target=^6.0.0 in .ai/dependencies/prisma.md');
    expect(serialized).toContain('Knowledge Conflicts Resolved:');
    expect(serialized).toContain('~ [CONFLICT] prisma');
  });
});
