import { InMemoryRoleRegistry } from '../../../src/core/agent/in-memory-role-registry';
import { RoleConfiguration } from '../../../src/domain/role-configuration';

describe('InMemoryRoleRegistry', () => {
  let registry: InMemoryRoleRegistry;
  const mockRole: RoleConfiguration = {
    id: 'test-role',
    name: 'Test Role',
    providerId: 'ollama',
    modelId: 'qwen3-32b',
    contextScope: 'full',
  };

  beforeEach(() => {
    registry = new InMemoryRoleRegistry();
  });

  it('registers a role successfully', () => {
    registry.register(mockRole);
    expect(registry.get('test-role')).toEqual(mockRole);
  });

  it('throws on duplicate registration', () => {
    registry.register(mockRole);
    expect(() => registry.register(mockRole)).toThrow('Role already registered: test-role');
  });

  it('returns undefined for unknown role', () => {
    expect(registry.get('unknown')).toBeUndefined();
  });

  it('lists all registered roles', () => {
    registry.register(mockRole);
    registry.register({ ...mockRole, id: 'role-2', name: 'Role 2' });
    expect(registry.list()).toHaveLength(2);
  });

  it('returns immutable list', () => {
    registry.register(mockRole);
    const list = registry.list();
    expect(Object.isFrozen(list)).toBe(true);
  });
});
