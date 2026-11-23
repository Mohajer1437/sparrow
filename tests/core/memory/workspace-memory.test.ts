import { DefaultWorkspaceMemory } from '../../../src/core/memory/workspace-memory';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';

describe('DefaultWorkspaceMemory', () => {
  let mockRuntime: jest.Mocked<RuntimeRepository>;
  let memory: DefaultWorkspaceMemory;

  const VALID_ARCH_MAP = JSON.stringify({
    meta: { project_name: 'test-project', architecture_style: 'Clean', generated_at: '2026-01-01' },
    system_overview: { description: 'A test project', core_modules: ['Core'] },
    module_map: [{ module_name: 'Core', directory_path: 'src/core', purpose: 'Core logic', files: [] }]
  });

  const VALID_CODEBASE_MAP = JSON.stringify({
    meta: { project_name: 'test-project', map_version: '1.0.0', generated_at: '2026-01-01', total_contexts: 1 },
    contexts: [{ context_name: 'Core', tags: ['#core'], description: 'Core', dependencies: [], files: [] }]
  });

  const VALID_KNOWLEDGE_BASE = JSON.stringify({
    meta: { project_name: 'test-project', version: '1.0.0', last_updated: '2026-01-01', description: 'Test' },
    project_context: {
      tech_stack: ['TypeScript'],
      current_state: { project_nature: 'Test', architecture_overview: 'Clean', recent_focus: 'Testing' },
      environment_quirks: []
    },
    domain_contexts: [],
    knowledge_base: { strict_rules: [], successful_patterns: [], failed_patterns: [], bug_fixes: [] }
  });

  beforeEach(() => {
    mockRuntime = {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      exists: jest.fn(),
      listFiles: jest.fn(),
      mkdir: jest.fn(),
      appendFeedbackCandidates: jest.fn(),
    } as any;
    memory = new DefaultWorkspaceMemory(mockRuntime);
  });

  // ─── Test: All files exist ───────────────────────────────────
  describe('when all knowledge files exist', () => {
    beforeEach(() => {
      mockRuntime.exists.mockResolvedValue(true);
      mockRuntime.readFile
        .mockResolvedValueOnce(VALID_ARCH_MAP)
        .mockResolvedValueOnce(VALID_CODEBASE_MAP)
        .mockResolvedValueOnce(VALID_KNOWLEDGE_BASE);
    });

    it('loads all three knowledge artifacts', async () => {
      const knowledge = await memory.load();

      expect(knowledge.isEmpty).toBe(false);
      expect(knowledge.architecturalMap).not.toBeNull();
      expect(knowledge.codebaseMap).not.toBeNull();
      expect(knowledge.knowledgeBase).not.toBeNull();
      expect(knowledge.architecturalMap!.meta.project_name).toBe('test-project');
      expect(knowledge.codebaseMap!.meta.total_contexts).toBe(1);
      expect(knowledge.knowledgeBase!.meta.version).toBe('1.0.0');
      expect(knowledge.loadedAt).toBeDefined();
    });

    it('returns frozen objects', async () => {
      const knowledge = await memory.load();
      expect(Object.isFrozen(knowledge)).toBe(true);
    });
  });

  // ─── Test: Only one file exists ──────────────────────────────
  describe('when only architectural-map exists', () => {
    beforeEach(() => {
      mockRuntime.exists.mockImplementation(async (path: string) => {
        return path === 'knowledge/architectural-map.json';
      });
      mockRuntime.readFile.mockResolvedValue(VALID_ARCH_MAP);
    });

    it('loads architectural map, others are null', async () => {
      const knowledge = await memory.load();

      expect(knowledge.isEmpty).toBe(false);
      expect(knowledge.architecturalMap).not.toBeNull();
      expect(knowledge.codebaseMap).toBeNull();
      expect(knowledge.knowledgeBase).toBeNull();
    });
  });

  // ─── Test: No files exist ────────────────────────────────────
  describe('when no knowledge files exist', () => {
    beforeEach(() => {
      mockRuntime.exists.mockResolvedValue(false);
    });

    it('returns empty knowledge without throwing', async () => {
      const knowledge = await memory.load();

      expect(knowledge.isEmpty).toBe(true);
      expect(knowledge.architecturalMap).toBeNull();
      expect(knowledge.codebaseMap).toBeNull();
      expect(knowledge.knowledgeBase).toBeNull();
      expect(knowledge.loadedAt).toBeDefined();
    });
  });

  // ─── Test: Invalid JSON ──────────────────────────────────────
  describe('when a file contains invalid JSON', () => {
    beforeEach(() => {
      mockRuntime.exists.mockResolvedValue(true);
      mockRuntime.readFile
        .mockResolvedValueOnce('{ invalid json !!!')
        .mockResolvedValueOnce(VALID_CODEBASE_MAP)
        .mockResolvedValueOnce(VALID_KNOWLEDGE_BASE);
    });

    it('returns null for invalid file, loads others', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const knowledge = await memory.load();

      expect(knowledge.architecturalMap).toBeNull();
      expect(knowledge.codebaseMap).not.toBeNull();
      expect(knowledge.knowledgeBase).not.toBeNull();
      expect(knowledge.isEmpty).toBe(false);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid JSON in architectural-map')
      );

      warnSpy.mockRestore();
    });

    it('never throws', async () => {
      jest.spyOn(console, 'warn').mockImplementation();
      await expect(memory.load()).resolves.toBeDefined();
      jest.restoreAllMocks();
    });
  });

  // ─── Test: Missing directory ─────────────────────────────────
  describe('when knowledge directory does not exist', () => {
    beforeEach(() => {
      mockRuntime.exists.mockResolvedValue(false);
    });

    it('hasKnowledge returns false', async () => {
      const result = await memory.hasKnowledge();
      expect(result).toBe(false);
    });

    it('load returns empty knowledge', async () => {
      const knowledge = await memory.load();
      expect(knowledge.isEmpty).toBe(true);
    });
  });

  // ─── Test: Empty directory ───────────────────────────────────
  describe('when knowledge directory exists but is empty', () => {
    beforeEach(() => {
      mockRuntime.exists.mockImplementation(async (path: string) => {
        return path === 'knowledge';
      });
    });

    it('hasKnowledge returns false', async () => {
      const result = await memory.hasKnowledge();
      expect(result).toBe(false);
    });

    it('load returns empty knowledge', async () => {
      const knowledge = await memory.load();
      expect(knowledge.isEmpty).toBe(true);
      expect(knowledge.architecturalMap).toBeNull();
      expect(knowledge.codebaseMap).toBeNull();
      expect(knowledge.knowledgeBase).toBeNull();
    });
  });

  // ─── Test: Corrupted file (empty string) ─────────────────────
  describe('when a file exists but is empty', () => {
    beforeEach(() => {
      mockRuntime.exists.mockResolvedValue(true);
      mockRuntime.readFile
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('   ')
        .mockResolvedValueOnce(VALID_KNOWLEDGE_BASE);
    });

    it('treats empty files as null', async () => {
      const knowledge = await memory.load();

      expect(knowledge.architecturalMap).toBeNull();
      expect(knowledge.codebaseMap).toBeNull();
      expect(knowledge.knowledgeBase).not.toBeNull();
      expect(knowledge.isEmpty).toBe(false);
    });
  });

  // ─── Test: Runtime throws unexpected error ───────────────────
  describe('when runtime throws unexpected error', () => {
    beforeEach(() => {
      mockRuntime.exists.mockRejectedValue(new Error('Disk failure'));
    });

    it('load never throws, returns empty knowledge', async () => {
      jest.spyOn(console, 'warn').mockImplementation();
      const knowledge = await memory.load();
      expect(knowledge.isEmpty).toBe(true);
      jest.restoreAllMocks();
    });

    it('hasKnowledge returns false', async () => {
      const result = await memory.hasKnowledge();
      expect(result).toBe(false);
    });
  });

  // ─── Test: getKnowledgeDir ───────────────────────────────────
  describe('getKnowledgeDir', () => {
    it('returns the knowledge directory path', () => {
      expect(memory.getKnowledgeDir()).toBe('knowledge');
    });
  });
});
