import { ModelRegistry } from '../../contracts/model-registry';
import { ModelDescriptor, ModelFilter } from '../../domain/model-registry';

export class InMemoryModelRegistry implements ModelRegistry {
  private readonly models = new Map<string, ModelDescriptor>();

  register(descriptor: ModelDescriptor): void {
    if (this.models.has(descriptor.id)) {
      throw new Error(`Model already registered: ${descriptor.id}`);
    }
    
    // Deep freeze for immutability
    const frozenDescriptor: ModelDescriptor = Object.freeze({
      ...descriptor,
      tags: Object.freeze([...descriptor.tags]),
      metadata: Object.freeze({ ...descriptor.metadata }),
    });
    
    this.models.set(descriptor.id, frozenDescriptor);
  }

  get(id: string): ModelDescriptor | undefined {
    return this.models.get(id);
  }

  list(): ReadonlyArray<ModelDescriptor> {
    return Object.freeze(Array.from(this.models.values()));
  }

  find(filter: ModelFilter): ReadonlyArray<ModelDescriptor> {
    const results = Array.from(this.models.values()).filter(model => {
      if (filter.providerId !== undefined && model.providerId !== filter.providerId) return false;
      if (filter.supportsTools !== undefined && model.supportsTools !== filter.supportsTools) return false;
      if (filter.supportsVision !== undefined && model.supportsVision !== filter.supportsVision) return false;
      if (filter.supportsThinking !== undefined && model.supportsThinking !== filter.supportsThinking) return false;
      if (filter.isLocal !== undefined && model.isLocal !== filter.isLocal) return false;
      if (filter.availability !== undefined && model.availability !== filter.availability) return false;
      if (filter.tags !== undefined && !filter.tags.every(tag => model.tags.includes(tag))) return false;
      return true;
    });
    return Object.freeze(results);
  }

  isAvailable(id: string): boolean {
    const model = this.models.get(id);
    return model !== undefined && model.availability === 'available';
  }
}
