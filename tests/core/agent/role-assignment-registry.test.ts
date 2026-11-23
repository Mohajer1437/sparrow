import { InMemoryRoleAssignmentRegistry } from '../../../src/core/agent/in-memory-role-assignment-registry';
import { RoleAssignment } from '../../../src/domain/role-assignment';

describe('InMemoryRoleAssignmentRegistry', () => {
  let registry: InMemoryRoleAssignmentRegistry;

  const createMockAssignment = (overrides: Partial<RoleAssignment> = {}): RoleAssignment => ({
    roleId: 'test-role',
    modelId: 'qwen3-32b',
    providerId: 'ollama',
    assignedAt: new Date().toISOString(),
    metadata: { source: 'test' },
    ...overrides,
  });

  beforeEach(() => {
    registry = new InMemoryRoleAssignmentRegistry();
  });

  it('assigns model to role successfully', () => {
    const assignment = createMockAssignment();
    registry.assign(assignment);
    const retrieved = registry.get('test-role');
    expect(retrieved).toBeDefined();
    expect(retrieved?.modelId).toBe('qwen3-32b');
    expect(retrieved?.providerId).toBe('ollama');
  });

  it('throws on duplicate assignment', () => {
    const assignment = createMockAssignment();
    registry.assign(assignment);
    expect(() => registry.assign(assignment)).toThrow('Role already has an assignment: test-role');
  });

  it('returns undefined for unknown role', () => {
    expect(registry.get('unknown-role')).toBeUndefined();
  });

  it('lists all assignments', () => {
    registry.assign(createMockAssignment({ roleId: 'role-1' }));
    registry.assign(createMockAssignment({ roleId: 'role-2' }));
    registry.assign(createMockAssignment({ roleId: 'role-3' }));
    expect(registry.list()).toHaveLength(3);
  });

  it('returns immutable results', () => {
    registry.assign(createMockAssignment());
    
    const list = registry.list();
    expect(Object.isFrozen(list)).toBe(true);
    
    const assignment = registry.get('test-role');
    expect(Object.isFrozen(assignment)).toBe(true);
    expect(Object.isFrozen(assignment?.metadata)).toBe(true);
  });

  it('allows multiple roles using same model', () => {
    registry.assign(createMockAssignment({ roleId: 'coder', modelId: 'qwen3-32b' }));
    registry.assign(createMockAssignment({ roleId: 'reviewer', modelId: 'qwen3-32b' }));
    registry.assign(createMockAssignment({ roleId: 'planner', modelId: 'qwen3-32b' }));
    
    expect(registry.list()).toHaveLength(3);
    expect(registry.get('coder')?.modelId).toBe('qwen3-32b');
    expect(registry.get('reviewer')?.modelId).toBe('qwen3-32b');
    expect(registry.get('planner')?.modelId).toBe('qwen3-32b');
  });

  it('accepts any assignment (validation happens in orchestrator)', () => {
    const assignment = createMockAssignment({ modelId: 'unavailable-model' });
    registry.assign(assignment);
    expect(registry.get('test-role')).toBeDefined();
  });
});
