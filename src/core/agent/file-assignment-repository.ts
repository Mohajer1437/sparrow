import { AssignmentRepository } from '../../contracts/assignment-repository';
import { RuntimeRepository } from '../../contracts/runtime-repository';
import { RoleAssignment } from '../../domain/role-assignment';

const CONFIG_PATH = 'config/role-assignments.json';

export class FileAssignmentRepository implements AssignmentRepository {
  constructor(private readonly runtimeRepository: RuntimeRepository) {}

  async save(assignments: ReadonlyArray<RoleAssignment>): Promise<void> {
    const data = JSON.stringify({ assignments, updatedAt: new Date().toISOString() }, null, 2);
    await this.runtimeRepository.writeFile(CONFIG_PATH, data);
  }

  async load(): Promise<ReadonlyArray<RoleAssignment>> {
    if (!await this.exists()) {
      return Object.freeze([]);
    }

    try {
      const raw = await this.runtimeRepository.readFile(CONFIG_PATH);
      if (!raw || raw.trim().length === 0) {
        return Object.freeze([]);
      }
      const parsed = JSON.parse(raw);
      const assignments = Array.isArray(parsed.assignments) ? parsed.assignments : [];
      return Object.freeze(assignments.map((a: any) => Object.freeze({
        roleId: a.roleId,
        modelId: a.modelId,
        providerId: a.providerId,
        assignedAt: a.assignedAt,
        updatedAt: a.updatedAt,
        source: a.source,
        metadata: a.metadata ? Object.freeze({ ...a.metadata }) : undefined,
      })));
    } catch (error: any) {
      console.warn(`[AssignmentRepository] Failed to load assignments: ${error.message}`);
      return Object.freeze([]);
    }
  }

  async exists(): Promise<boolean> {
    return this.runtimeRepository.exists(CONFIG_PATH);
  }
}
