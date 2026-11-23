import { InMemoryProviderRegistry } from '../../../src/core/provider/in-memory-provider-registry';
import { Provider } from '../../../src/contracts/provider';
import { createProviderId, ProviderId } from '../../../src/domain/provider-id';

describe('InMemoryProviderRegistry', () => {
  const mockProvider: Provider = {
    generate: jest.fn()
  };

  it('should resolve a registered provider', () => {
    const id = createProviderId('test-provider');
    const registry = new InMemoryProviderRegistry(
      new Map<ProviderId, Provider>([[id, mockProvider]])
    );

    expect(registry.has(id)).toBe(true);
    expect(registry.get(id)).toBe(mockProvider);
  });

  it('should return undefined for unknown provider', () => {
    const registry = new InMemoryProviderRegistry(new Map());
    const id = createProviderId('unknown');

    expect(registry.has(id)).toBe(false);
    expect(registry.get(id)).toBeUndefined();
  });

  it('should return immutable list of provider ids', () => {
    const id1 = createProviderId('provider-a');
    const id2 = createProviderId('provider-b');
    const registry = new InMemoryProviderRegistry(
      new Map<ProviderId, Provider>([
        [id1, mockProvider],
        [id2, mockProvider]
      ])
    );

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list).toContain(id1);
    expect(list).toContain(id2);
    expect(Object.isFrozen(list)).toBe(true);
  });

  it('should reject empty provider id', () => {
    expect(() => createProviderId('')).toThrow('ProviderId cannot be empty');
    expect(() => createProviderId('   ')).toThrow('ProviderId cannot be empty');
  });

  it('should not be affected by external mutation of source map', () => {
    const id = createProviderId('stable');
    const sourceMap = new Map<ProviderId, Provider>([[id, mockProvider]]);
    const registry = new InMemoryProviderRegistry(sourceMap);

    sourceMap.delete(id);

    expect(registry.has(id)).toBe(true);
  });
});
