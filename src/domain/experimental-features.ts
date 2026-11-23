/**
 * Experimental features configuration.
 *
 * All features default to DISABLED (enabled: false).
 * When a feature is enabled, it may alter pipeline behavior.
 * When disabled, the system behaves EXACTLY as before these features were added.
 *
 * Promotion path:
 *   Experimental (enabled: false by default)
 *   → Beta (enabled: true by default, opt-out)
 *   → Stable (no flag, always on)
 */

export interface LspExperimentalConfig {
  /** Enable TypeScript Language Server-based semantic context */
  readonly enabled: boolean;
  /** Path to tsconfig.json (defaults to './tsconfig.json') */
  readonly tsconfigPath?: string;
  /** Path to typescript-language-server binary (defaults to auto-detect) */
  readonly serverPath?: string;
  /** Maximum number of semantic references to include */
  readonly maxReferences?: number;
}

export interface VectorRagExperimentalConfig {
  /** Enable vector-based semantic retrieval */
  readonly enabled: boolean;
  /** Embedding model ID (e.g., 'nomic-embed-text') */
  readonly embeddingModel?: string;
  /** Minimum cosine similarity threshold [0, 1] */
  readonly similarityThreshold?: number;
  /** Maximum number of results to return */
  readonly maxResults?: number;
}

export interface MultiAgentDebateExperimentalConfig {
  /** Enable multi-agent pre-execution debate */
  readonly enabled: boolean;
  /** Minimum task complexity to trigger debate */
  readonly minComplexity?: 'simple' | 'medium' | 'complex';
  /** Maximum debate rounds */
  readonly maxRounds?: number;
  /** Consensus threshold [0, 1] to approve a plan */
  readonly consensusThreshold?: number;
}

export interface ExperimentalFeatures {
  readonly lsp: LspExperimentalConfig;
  readonly vectorRag: VectorRagExperimentalConfig;
  readonly multiAgentDebate: MultiAgentDebateExperimentalConfig;
}
