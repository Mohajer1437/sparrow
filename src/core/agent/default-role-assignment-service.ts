import { RoleAssignmentService } from '../../contracts/role-assignment-service';
import { RoleAssignmentRegistry } from '../../contracts/role-assignment-registry';
import { RoleRegistry } from '../../contracts/role-registry';
import { ModelRegistry } from '../../contracts/model-registry';
import { ProviderRegistry } from '../../contracts/provider-registry';
import { AssignmentRepository } from '../../contracts/assignment-repository';
import { RoleAssignment } from '../../domain/role-assignment';
import { DEFAULT_ASSIGNMENTS } from './default-role-assignments';

export class DefaultRoleAssignmentService implements RoleAssignmentService {
  constructor(
    private readonly roleRegistry: RoleRegistry,
    private readonly roleAssignmentRegistry: RoleAssignmentRegistry,
    private readonly modelRegistry: ModelRegistry,
    private readonly providerRegistry: ProviderRegistry,
    private readonly assignmentRepository: AssignmentRepository
  ) {}

  async updateAssignment(roleId: string, modelId: string): Promise<RoleAssignment> {
    // Step 1: Validate role exists
    const role = this.roleRegistry.get(roleId);
    if (!role) {
      throw new Error(`Role not found: ${roleId}`);
    }

    // Step 2: Validate model exists
    const model = this.modelRegistry.get(modelId);
    if (!model) {
      throw new Error(`Model not found in registry: ${modelId}`);
    }

    // Step 3: Validate model is available
    if (model.availability !== 'available') {
      throw new Error(`Model not available: ${modelId} (status: ${model.availability})`);
    }

    // Step 4: Validate provider exists
    if (!this.providerRegistry.has(model.providerId as any)) {
      throw new Error(`Provider not found: ${model.providerId}`);
    }

    // Step 5: Create new assignment
    const now = new Date().toISOString();
    const existing = this.roleAssignmentRegistry.get(roleId);
    
    const assignment: RoleAssignment = Object.freeze({
      roleId,
      modelId,
      providerId: model.providerId,
      assignedAt: existing?.assignedAt ?? now,
      updatedAt: now,
      source: 'user' as const,
      metadata: Object.freeze({ previousModel: existing?.modelId ?? 'none' }),
    });

    // Step 6: Update registry
    this.roleAssignmentRegistry.update(assignment);

    // Step 7: Persist to repository
    await this.assignmentRepository.save(this.roleAssignmentRegistry.list());

    return assignment;
  }

  async getAssignment(roleId: string): Promise<RoleAssignment | undefined> {
    return this.roleAssignmentRegistry.get(roleId);
  }

  async listAssignments(): Promise<ReadonlyArray<RoleAssignment>> {
    return this.roleAssignmentRegistry.list();
  }

  async reload(): Promise<void> {
    const assignments = await this.assignmentRepository.load();
    for (const assignment of assignments) {
      this.roleAssignmentRegistry.update(assignment);
    }
  }

  async resetAssignments(): Promise<void> {
    for (const assignment of DEFAULT_ASSIGNMENTS) {
      this.roleAssignmentRegistry.update(assignment);
    }
    await this.assignmentRepository.save(this.roleAssignmentRegistry.list());
  }
}
