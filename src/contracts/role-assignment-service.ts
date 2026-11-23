import { RoleAssignment } from '../domain/role-assignment';

export interface RoleAssignmentService {
  /**
   * Update the model assigned to a role.
   * Validates role, model, and provider before updating.
   * Persists the change to the repository.
   */
  updateAssignment(roleId: string, modelId: string): Promise<RoleAssignment>;

  /**
   * Get the current assignment for a role.
   */
  getAssignment(roleId: string): Promise<RoleAssignment | undefined>;

  /**
   * List all current assignments.
   */
  listAssignments(): Promise<ReadonlyArray<RoleAssignment>>;

  /**
   * Reload assignments from persistent storage.
   */
  reload(): Promise<void>;

  /**
   * Reset all assignments to their default values.
   * Persists the reset to the repository.
   */
  resetAssignments(): Promise<void>;
}
