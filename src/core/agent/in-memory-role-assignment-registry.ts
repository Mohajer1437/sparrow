import { RoleAssignmentRegistry } from '../../contracts/role-assignment-registry';
import { RoleAssignment } from '../../domain/role-assignment';

export class InMemoryRoleAssignmentRegistry implements RoleAssignmentRegistry {
  private readonly assignments = new Map<string, RoleAssignment>();

  assign(assignment: RoleAssignment): void {
    if (this.assignments.has(assignment.roleId)) {
      throw new Error(`Role already has an assignment: ${assignment.roleId}`);
    }

    // Deep freeze for immutability
    const frozenAssignment: RoleAssignment = Object.freeze({
      ...assignment,
      metadata: assignment.metadata ? Object.freeze({ ...assignment.metadata }) : undefined,
    });

    this.assignments.set(assignment.roleId, frozenAssignment);
  }

  get(roleId: string): RoleAssignment | undefined {
    return this.assignments.get(roleId);
  }

  update(assignment: RoleAssignment): void {
    // Deep freeze for immutability
    const frozenAssignment: RoleAssignment = Object.freeze({
      ...assignment,
      metadata: assignment.metadata ? Object.freeze({ ...assignment.metadata }) : undefined,
    });

    this.assignments.set(assignment.roleId, frozenAssignment);
  }

  list(): ReadonlyArray<RoleAssignment> {
    return Object.freeze(Array.from(this.assignments.values()));
  }
}
