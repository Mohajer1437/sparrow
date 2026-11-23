import { RoleAssignment } from '../domain/role-assignment';

export interface RoleAssignmentRegistry {
  /**
   * Assign a model to a role.
   * Throws on duplicate assignment.
   */
  assign(assignment: RoleAssignment): void;

  /**
   * Get the assignment for a role.
   * Returns undefined if no assignment exists.
   */
  get(roleId: string): RoleAssignment | undefined;

  /**
   * Update an existing assignment or create a new one.
   * Does not throw on duplicate (unlike assign).
   */
  update(assignment: RoleAssignment): void;

  /**
   * List all assignments.
   * Returns immutable array.
   */
  list(): ReadonlyArray<RoleAssignment>;
}
