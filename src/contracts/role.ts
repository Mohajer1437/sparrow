import { RoleConfig } from '../domain/role-config';

export interface Role {
  getName(): string;
  getConfig(): RoleConfig;
}
