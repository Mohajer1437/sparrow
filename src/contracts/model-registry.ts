import { ModelDescriptor, ModelFilter } from '../domain/model-registry';

export interface ModelRegistry {
  /**
   * Register a model descriptor.
   * Only called during startup/initialization.
   * Throws on duplicate registration.
   */
  register(descriptor: ModelDescriptor): void;

  /**
   * Get a model by ID.
   * Returns undefined if not found.
   */
  get(id: string): ModelDescriptor | undefined;

  /**
   * List all registered models.
   * Returns immutable array.
   */
  list(): ReadonlyArray<ModelDescriptor>;

  /**
   * Find models matching a filter.
   * Returns immutable array.
   */
  find(filter: ModelFilter): ReadonlyArray<ModelDescriptor>;

  /**
   * Check if a model exists and is available.
   */
  isAvailable(id: string): boolean;
}
