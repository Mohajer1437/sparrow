import { RoleRegistry } from '../../contracts/role-registry';
import { RoleConfiguration } from '../../domain/role-configuration';

export class InMemoryRoleRegistry implements RoleRegistry {
  private readonly roles = new Map<string, RoleConfiguration>();

  register(role: RoleConfiguration): void {
    if (this.roles.has(role.id)) {
      throw new Error(`Role already registered: ${role.id}`);
    }
    this.roles.set(role.id, Object.freeze(role));
  }

  get(id: string): RoleConfiguration | undefined {
    return this.roles.get(id);
  }

  list(): ReadonlyArray<RoleConfiguration> {
    return Object.freeze(Array.from(this.roles.values()));
  }
}
