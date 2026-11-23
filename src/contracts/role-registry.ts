import { RoleConfiguration } from '../domain/role-configuration';

export interface RoleRegistry {
  register(role: RoleConfiguration): void;
  get(id: string): RoleConfiguration | undefined;
  list(): ReadonlyArray<RoleConfiguration>;
}
