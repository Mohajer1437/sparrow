import { DefaultMemoryContextBuilder } from '../../../src/core/memory/memory-context-builder';
import { WorkspaceKnowledge } from '../../../src/domain/workspace-knowledge';

describe('DefaultMemoryContextBuilder', () => {
  let builder: DefaultMemoryContextBuilder;

  const buildKnowledge = (overrides: Partial<WorkspaceKnowledge> = {}): WorkspaceKnowledge => ({
    architecturalMap: null,
    codebaseMap: null,
    knowledgeBase: null,
    loadedAt: new Date().toISOString(),
    isEmpty: true,
    ...overrides,
  });

  beforeEach(() => {
    builder = new DefaultMemoryContextBuilder();
  });

  describe('empty knowledge', () => {
    it('returns empty string when knowledge is empty', () => {
      const knowledge = buildKnowledge({ isEmpty: true });
      expect(builder.build(knowledge)).toBe('');
    });

    it('returns empty string when all artifacts are null', () => {
      const knowledge = buildKnowledge({
        isEmpty: true,
        architecturalMap: null,
        codebaseMap: null,
        knowledgeBase: null,
      });
      expect(builder.build(knowledge)).toBe('');
    });
  });

  describe('architecture section', () => {
    it('includes architecture style', () => {
      const knowledge = buildKnowledge({
        isEmpty: false,
        architecturalMap: {
          meta: {
            project_name: 'test',
            architecture_style: 'Clean Architecture',
            generated_at: '2026-01-01',
          },
          system_overview: { description: 'A test project', core_modules: [] },
          module_map: [],
        },
      });

      const result = builder.build(knowledge);
      expect(result).toContain('PROJECT CONTEXT');
      expect(result).toContain('Architecture: Clean Architecture');
    });

    it('includes core modules', () => {
      const knowledge = buildKnowledge({
        isEmpty: false,
        architecturalMap: {
          meta: { project_name: 'x', architecture_style: 'X', generated_at: '2026-01-01' },
          system_overview: {
            description: 'Test',
            core_modules: ['Core', 'CLI', 'Knowledge', 'Memory'],
          },
          module_map: [],
        },
      });

      const result = builder.build(knowledge);
      expect(result).toContain('Core modules: Core, CLI, Knowledge, Memory');
    });

    it('limits core modules to 8', () => {
      const modules = Array.from({ length: 20 }, (_, i) => `Module${i}`);
      const knowledge = buildKnowledge({
        isEmpty: false,
        architecturalMap: {
          meta: { project_name: 'x', architecture_style: 'X', generated_at: '2026-01-01' },
          system_overview: { description: 'Test', core_modules: modules },
          module_map: [],
        },
      });

      const result = builder.build(knowledge);
      expect(result).toContain('Module0');
      expect(result).toContain('Module7');
      expect(result).not.toContain('Module8');
    });
  });

  describe('rules section (highest priority)', () => {
    it('includes strict rules', () => {
      const knowledge = buildKnowledge({
        isEmpty: false,
        knowledgeBase: {
          meta: { project_name: 'x', version: '1.0', last_updated: '2026-01-01', description: '' },
          project_context: {
            tech_stack: [],
            current_state: { project_nature: '', architecture_overview: '', recent_focus: '' },
            environment_quirks: [],
          },
          domain_contexts: [],
          knowledge_base: {
            strict_rules: [
              { id: 'RULE-01', category: 'Arch', rule: 'Never access FS directly', reason: '' },
              { id: 'RULE-02', category: 'Arch', rule: 'Use Workspace abstraction', reason: '' },
            ],
            successful_patterns: [],
            failed_patterns: [],
            bug_fixes: [],
          },
        },
      });

      const result = builder.build(knowledge);
      expect(result).toContain('Important Rules:');
      expect(result).toContain('[RULE-01] Never access FS directly');
      expect(result).toContain('[RULE-02] Use Workspace abstraction');
    });

    it('limits rules to 15', () => {
      const rules = Array.from({ length: 25 }, (_, i) => ({
        id: `RULE-${i.toString().padStart(2, '0')}`,
        category: 'Test',
        rule: `Rule number ${i}`,
        reason: '',
      }));

      const knowledge = buildKnowledge({
        isEmpty: false,
        knowledgeBase: {
          meta: { project_name: 'x', version: '1.0', last_updated: '2026-01-01', description: '' },
          project_context: {
            tech_stack: [],
            current_state: { project_nature: '', architecture_overview: '', recent_focus: '' },
            environment_quirks: [],
          },
          domain_contexts: [],
          knowledge_base: {
            strict_rules: rules,
            successful_patterns: [],
            failed_patterns: [],
            bug_fixes: [],
          },
        },
      });

      const result = builder.build(knowledge);
      expect(result).toContain('[RULE-00] Rule number 0');
      expect(result).toContain('[RULE-14] Rule number 14');
      expect(result).not.toContain('[RULE-15]');
    });
  });

  describe('patterns section', () => {
    it('includes successful patterns', () => {
      const knowledge = buildKnowledge({
        isEmpty: false,
        knowledgeBase: {
          meta: { project_name: 'x', version: '1.0', last_updated: '2026-01-01', description: '' },
          project_context: {
            tech_stack: [],
            current_state: { project_nature: '', architecture_overview: '', recent_focus: '' },
            environment_quirks: [],
          },
          domain_contexts: [],
          knowledge_base: {
            strict_rules: [],
            successful_patterns: [
              { id: 'DO-01', context: '', approach: 'Use DI', why_it_works: '' },
              { id: 'DO-02', context: '', approach: 'Prefer immutability', why_it_works: '' },
            ],
            failed_patterns: [],
            bug_fixes: [],
          },
        },
      });

      const result = builder.build(knowledge);
      expect(result).toContain('Successful Patterns:');
      expect(result).toContain('[DO-01] Use DI');
      expect(result).toContain('[DO-02] Prefer immutability');
    });
  });

  describe('domains section', () => {
    it('includes domain contexts', () => {
      const knowledge = buildKnowledge({
        isEmpty: false,
        knowledgeBase: {
          meta: { project_name: 'x', version: '1.0', last_updated: '2026-01-01', description: '' },
          project_context: {
            tech_stack: [],
            current_state: { project_nature: '', architecture_overview: '', recent_focus: '' },
            environment_quirks: [],
          },
          domain_contexts: [
            { module_name: 'Workspace', core_concepts: [], summary: 'Handles file I/O' },
            { module_name: 'Memory', core_concepts: [], summary: 'Loads knowledge' },
          ],
          knowledge_base: {
            strict_rules: [],
            successful_patterns: [],
            failed_patterns: [],
            bug_fixes: [],
          },
        },
      });

      const result = builder.build(knowledge);
      expect(result).toContain('Important Domains:');
      expect(result).toContain('Workspace: Handles file I/O');
      expect(result).toContain('Memory: Loads knowledge');
    });

    it('limits domains to 5', () => {
      const domains = Array.from({ length: 10 }, (_, i) => ({
        module_name: `Domain${i}`,
        core_concepts: [],
        summary: `Summary ${i}`,
      }));

      const knowledge = buildKnowledge({
        isEmpty: false,
        knowledgeBase: {
          meta: { project_name: 'x', version: '1.0', last_updated: '2026-01-01', description: '' },
          project_context: {
            tech_stack: [],
            current_state: { project_nature: '', architecture_overview: '', recent_focus: '' },
            environment_quirks: [],
          },
          domain_contexts: domains,
          knowledge_base: {
            strict_rules: [],
            successful_patterns: [],
            failed_patterns: [],
            bug_fixes: [],
          },
        },
      });

      const result = builder.build(knowledge);
      expect(result).toContain('Domain0');
      expect(result).toContain('Domain4');
      expect(result).not.toContain('Domain5');
    });
  });

  describe('size limit', () => {
    it('truncates when total context exceeds 4000 chars', () => {
      const rules = Array.from({ length: 15 }, (_, i) => ({
        id: `RULE-${i}`,
        category: 'Test',
        rule: 'A'.repeat(300),
        reason: '',
      }));

      const knowledge = buildKnowledge({
        isEmpty: false,
        knowledgeBase: {
          meta: { project_name: 'x', version: '1.0', last_updated: '2026-01-01', description: '' },
          project_context: {
            tech_stack: [],
            current_state: { project_nature: '', architecture_overview: '', recent_focus: '' },
            environment_quirks: [],
          },
          domain_contexts: [],
          knowledge_base: {
            strict_rules: rules,
            successful_patterns: [],
            failed_patterns: [],
            bug_fixes: [],
          },
        },
      });

      const result = builder.build(knowledge);
      expect(result.length).toBeLessThanOrEqual(4000);
      expect(result).toContain('[Context truncated for brevity');
    });
  });

  describe('never throws', () => {
    it('returns empty string when passed null-ish value', () => {
      expect(builder.build(null as any)).toBe('');
      expect(builder.build(undefined as any)).toBe('');
    });

    it('returns empty string when knowledge has malformed data', () => {
      const knowledge = buildKnowledge({
        isEmpty: false,
        knowledgeBase: {
          meta: null as any,
          project_context: null as any,
          domain_contexts: null as any,
          knowledge_base: null as any,
        },
      });

      expect(() => builder.build(knowledge)).not.toThrow();
    });
  });

  describe('ignores irrelevant data', () => {
    it('does not include raw function lists from codebase map', () => {
      const knowledge = buildKnowledge({
        isEmpty: false,
        codebaseMap: {
          meta: {
            project_name: 'x',
            map_version: '1.0',
            generated_at: '2026-01-01',
            total_contexts: 1,
          },
          contexts: [{
            context_name: 'Core',
            tags: ['#core'],
            description: 'Core logic',
            dependencies: [],
            files: [{
              path: 'src/core/task-executor.ts',
              role: 'Executor',
              functions: [
                { name: 'execute', signature: 'async execute()', purpose: 'Execute task', calls: [], called_by: [] },
                { name: 'build', signature: 'build()', purpose: 'Build', calls: [], called_by: [] },
              ],
            }],
          }],
        },
      });

      const result = builder.build(knowledge);
      expect(result).not.toContain('execute()');
      expect(result).not.toContain('src/core/task-executor.ts');
      expect(result).not.toContain('Function');
    });
  });
});
