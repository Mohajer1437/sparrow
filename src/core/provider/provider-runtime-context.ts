/**
 * Optional runtime context for multi-provider selection + failover.
 * Built by CLI/selection before AppFactory constructs the registry.
 */

import { LlmProviderSettings } from '../../domain/llm-provider-config';
import { ProviderSelectionSource } from './provider-selection-service';

export interface ProviderRuntimeCandidate {
  readonly name: string;
  readonly settings: LlmProviderSettings;
}

export interface ProviderRuntimeContext {
  readonly preferredName: string;
  readonly orderedCandidates: ReadonlyArray<ProviderRuntimeCandidate>;
  readonly selectionSource?: ProviderSelectionSource;
  readonly onFailoverMessage?: (message: string) => void;
  /**
   * Optional per-candidate generate timeout for ResilientLlmProvider.
   * When set, each failover attempt gets a fresh timeout signal.
   */
  readonly attemptTimeoutMs?: number;
}
