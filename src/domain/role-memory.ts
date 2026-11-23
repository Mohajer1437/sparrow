export interface RoleMemoryEntry {
  readonly id: string;
  readonly roleId: string;
  readonly content: string;
  readonly category: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

export interface SharedMemoryEntry {
  readonly id: string;
  readonly content: string;
  readonly category: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

export type MemoryOwnership = 'shared' | 'role';
