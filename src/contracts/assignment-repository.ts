import { RoleAssignment } from '../domain/role-assignment';

export interface AssignmentRepository {
  /**
   * Save all assignments to persistent storage.
   */
  save(assignments: ReadonlyArray<RoleAssignment>): Promise<void>;

  /**
   * Load all assignments from persistent storage.
   * Returns empty array if no file exists.
   */
  load(): Promise<ReadonlyArray<RoleAssignment>>;

  /**
   * Check if persistent storage exists.
   */
  exists(): Promise<boolean>;
}
