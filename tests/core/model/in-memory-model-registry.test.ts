import { InMemoryModelRegistry } from '../../../src/core/model/in-memory-model-registry';
import { ModelDescriptor } from '../../../src/domain/model-registry';

describe('InMemoryModelRegistry', () => {
  let registry: InMemoryModelRegistry;

  const createMockModel = (overrides: Partial<ModelDescriptor> = {}): ModelDescriptor => ({
    id: 'test-model',
    providerId: 'ollama',
    displayName: 'Test Model',
    contextWindow: 32768,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsVision: false,
    supportsThinking: true,
    isLocal: true,
    availability: 'available',
    tags: ['coding', 'local'],
    metadata: { family: 'test' },
    ...overrides,
  });

  beforeEach(() => {
    registry = new InMemoryModelRegistry();
  });

  it('registers a model successfully', () => {
    const model = createMockModel();
    registry.register(model);
    expect(registry.get('test-model')).toBeDefined();
    expect(registry.get('test-model')?.displayName).toBe('Test Model');
  });

  it('throws on duplicate model registration', () => {
    const model = createMockModel();
    registry.register(model);
    expect(() => registry.register(model)).toThrow('Model already registered: test-model');
  });

  it('retrieves model by id', () => {
    const model = createMockModel({ id: 'qwen3-32b', displayName: 'Qwen 3 32B' });
    registry.register(model);
    const retrieved = registry.get('qwen3-32b');
    expect(retrieved).toBeDefined();
    expect(retrieved?.displayName).toBe('Qwen 3 32B');
  });

  it('returns undefined for unknown model', () => {
    expect(registry.get('unknown-model')).toBeUndefined();
  });

  it('lists all registered models', () => {
    registry.register(createMockModel({ id: 'model-1' }));
    registry.register(createMockModel({ id: 'model-2' }));
    registry.register(createMockModel({ id: 'model-3' }));
    expect(registry.list()).toHaveLength(3);
  });

  it('filters by provider', () => {
    registry.register(createMockModel({ id: 'ollama-model', providerId: 'ollama' }));
    registry.register(createMockModel({ id: 'openai-model', providerId: 'openai' }));
    
    const ollamaModels = registry.find({ providerId: 'ollama' });
    expect(ollamaModels).toHaveLength(1);
    expect(ollamaModels[0].id).toBe('ollama-model');
  });

  it('filters by capabilities - tools', () => {
    registry.register(createMockModel({ id: 'with-tools', supportsTools: true }));
    registry.register(createMockModel({ id: 'no-tools', supportsTools: false }));
    
    const toolModels = registry.find({ supportsTools: true });
    expect(toolModels).toHaveLength(1);
    expect(toolModels[0].id).toBe('with-tools');
  });

  it('filters by capabilities - vision', () => {
    registry.register(createMockModel({ id: 'with-vision', supportsVision: true }));
    registry.register(createMockModel({ id: 'no-vision', supportsVision: false }));
    
    const visionModels = registry.find({ supportsVision: true });
    expect(visionModels).toHaveLength(1);
    expect(visionModels[0].id).toBe('with-vision');
  });

  it('filters by capabilities - thinking', () => {
    registry.register(createMockModel({ id: 'with-thinking', supportsThinking: true }));
    registry.register(createMockModel({ id: 'no-thinking', supportsThinking: false }));
    
    const thinkingModels = registry.find({ supportsThinking: true });
    expect(thinkingModels).toHaveLength(1);
    expect(thinkingModels[0].id).toBe('with-thinking');
  });

  it('filters by tags', () => {
    registry.register(createMockModel({ id: 'coding-model', tags: ['coding', 'local'] }));
    registry.register(createMockModel({ id: 'general-model', tags: ['general', 'remote'] }));
    
    const codingModels = registry.find({ tags: ['coding'] });
    expect(codingModels).toHaveLength(1);
    expect(codingModels[0].id).toBe('coding-model');
  });

  it('checks availability correctly', () => {
    registry.register(createMockModel({ id: 'available-model', availability: 'available' }));
    registry.register(createMockModel({ id: 'deprecated-model', availability: 'deprecated' }));
    
    expect(registry.isAvailable('available-model')).toBe(true);
    expect(registry.isAvailable('deprecated-model')).toBe(false);
    expect(registry.isAvailable('unknown-model')).toBe(false);
  });

  it('returns immutable results', () => {
    registry.register(createMockModel());
    
    const list = registry.list();
    expect(Object.isFrozen(list)).toBe(true);
    
    const found = registry.find({ providerId: 'ollama' });
    expect(Object.isFrozen(found)).toBe(true);
    
    const model = registry.get('test-model');
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model?.tags)).toBe(true);
    expect(Object.isFrozen(model?.metadata)).toBe(true);
  });
});
