/**
 * R2.1: Workspace Knowledge Domain Types
 *
 * These types represent the shape of project knowledge files.
 * They are intentionally lightweight - WorkspaceMemory only needs
 * to load and pass them through, not interpret their internals.
 *
 * Future subsystems (R2.2, R2.3, R3) will consume these types
 * via the WorkspaceMemory contract.
 */

/** A single file entry in the architectural map */
export interface ArchMapFile {
  readonly path: string;
  readonly hash?: string;
  readonly type: string;
  readonly responsibility: string;
  readonly architectural_role: string;
  readonly interacts_with: ReadonlyArray<string>;
}

/** A module in the architectural map */
export interface ArchMapModule {
  readonly module_name: string;
  readonly directory_path: string;
  readonly purpose: string;
  readonly files: ReadonlyArray<ArchMapFile>;
}

/** Top-level architectural map structure */
export interface ArchitecturalMapData {
  readonly meta: {
    readonly project_name: string;
    readonly architecture_style: string;
    readonly generated_at: string;
    readonly generation_mode?: string;
  };
  readonly system_overview: {
    readonly description: string;
    readonly core_modules: ReadonlyArray<string>;
  };
  readonly module_map: ReadonlyArray<ArchMapModule>;
}

/** A function entry in the codebase map */
export interface CodebaseFunction {
  readonly name: string;
  readonly signature: string;
  readonly purpose: string;
  readonly calls: ReadonlyArray<string>;
  readonly called_by: ReadonlyArray<string>;
}

/** A file entry in the codebase map */
export interface CodebaseFile {
  readonly path: string;
  readonly hash?: string;
  readonly role: string;
  readonly functions: ReadonlyArray<CodebaseFunction>;
}

/** A context in the codebase map */
export interface CodebaseContext {
  readonly context_name: string;
  readonly tags: ReadonlyArray<string>;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly files: ReadonlyArray<CodebaseFile>;
}

/** Top-level codebase map structure */
export interface CodebaseMapData {
  readonly meta: {
    readonly project_name: string;
    readonly map_version: string;
    readonly generated_at: string;
    readonly total_contexts: number;
    readonly generation_mode?: string;
  };
  readonly contexts: ReadonlyArray<CodebaseContext>;
}

/** A rule in the knowledge base */
export interface KnowledgeRule {
  readonly id: string;
  readonly category: string;
  readonly rule: string;
  readonly reason: string;
}

/** A successful pattern in the knowledge base */
export interface KnowledgePattern {
  readonly id: string;
  readonly context: string;
  readonly approach: string;
  readonly why_it_works: string;
  readonly code_snippet?: string;
}

/** A failed pattern in the knowledge base */
export interface KnowledgeAntiPattern {
  readonly id: string;
  readonly context: string;
  readonly bad_approach: string;
  readonly why_it_failed: string;
  readonly correct_approach: string;
}

/** A bug fix in the knowledge base */
export interface KnowledgeBugFix {
  readonly id: string;
  readonly bug_description: string;
  readonly root_cause: string;
  readonly fix_applied: string;
  readonly prevention_tip: string;
}

/** Top-level knowledge base structure */
export interface KnowledgeBaseData {
  readonly meta: {
    readonly project_name: string;
    readonly version: string;
    readonly last_updated: string;
    readonly description: string;
    readonly generation_mode?: string;
  };
  readonly project_context: {
    readonly tech_stack: ReadonlyArray<string>;
    readonly current_state: {
      readonly project_nature: string;
      readonly architecture_overview: string;
      readonly recent_focus: string;
    };
    readonly environment_quirks: ReadonlyArray<string>;
  };
  readonly domain_contexts: ReadonlyArray<{
    readonly module_name: string;
    readonly core_concepts: ReadonlyArray<string>;
    readonly summary: string;
  }>;
  readonly knowledge_base: {
    readonly strict_rules: ReadonlyArray<KnowledgeRule>;
    readonly successful_patterns: ReadonlyArray<KnowledgePattern>;
    readonly failed_patterns: ReadonlyArray<KnowledgeAntiPattern>;
    readonly bug_fixes: ReadonlyArray<KnowledgeBugFix>;
  };
}

/**
 * The complete workspace knowledge snapshot.
 * This is what WorkspaceMemory returns.
 *
 * null means "file did not exist or was invalid".
 * This is NOT an error - it simply means that knowledge
 * has not been generated yet for that artifact.
 */
export interface WorkspaceKnowledge {
  readonly architecturalMap: ArchitecturalMapData | null;
  readonly codebaseMap: CodebaseMapData | null;
  readonly knowledgeBase: KnowledgeBaseData | null;
  readonly loadedAt: string;
  readonly isEmpty: boolean;
}
