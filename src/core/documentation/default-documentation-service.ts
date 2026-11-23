import { DocumentationService } from '../../contracts/documentation-service';
import { DocumentationRepository } from '../../contracts/documentation-repository';
import {
  DocumentationState,
  ComponentDocumentation,
  ArchitectureDecisionRecord,
  ComponentMapping,
} from '../../domain/architecture-documentation';

/**
 * DefaultDocumentationService is a deterministic documentation service.
 *
 * It does NOT use LLM. It does NOT make autonomous decisions.
 * It collects registered components and decisions, and produces
 * an immutable DocumentationState.
 */
export class DefaultDocumentationService implements DocumentationService {
  private components: ComponentDocumentation[] = [];
  private decisions: ArchitectureDecisionRecord[] = [];
  private mappings: ComponentMapping[] = [];

  constructor(private readonly repository: DocumentationRepository) {}

  registerComponent(component: ComponentDocumentation): void {
    this.components.push(Object.freeze(component));
  }

  registerDecision(decision: ArchitectureDecisionRecord): void {
    this.decisions.push(Object.freeze(decision));
  }

  registerMapping(mapping: ComponentMapping): void {
    this.mappings.push(Object.freeze(mapping));
  }

  async collectComponents(): Promise<ReadonlyArray<ComponentDocumentation>> {
    return Object.freeze([...this.components]);
  }

  async getDecisions(): Promise<ReadonlyArray<ArchitectureDecisionRecord>> {
    return Object.freeze([...this.decisions]);
  }

  async generateDocumentation(): Promise<DocumentationState> {
    const state: DocumentationState = Object.freeze({
      components: Object.freeze([...this.components]),
      decisions: Object.freeze([...this.decisions]),
      mappings: Object.freeze([...this.mappings]),
      generatedAt: new Date().toISOString(),
      version: '1.0.0',
    });

    await this.repository.save(state);
    return state;
  }

  async getState(): Promise<DocumentationState | null> {
    return this.repository.load();
  }
}
