import {
  DocumentationState,
  ComponentDocumentation,
  ArchitectureDecisionRecord,
} from '../domain/architecture-documentation';

/**
 * DocumentationService collects architecture information and
 * generates documentation artifacts.
 *
 * Deterministic. No LLM calls. No autonomous decision-making.
 */
export interface DocumentationService {
  collectComponents(): Promise<ReadonlyArray<ComponentDocumentation>>;
  getDecisions(): Promise<ReadonlyArray<ArchitectureDecisionRecord>>;
  generateDocumentation(): Promise<DocumentationState>;
  getState(): Promise<DocumentationState | null>;
}
