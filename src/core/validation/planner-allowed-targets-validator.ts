import {
  InternalValidationOutcome,
  InternalValidationRequest,
  ValidatorContract,
  createValidationOutcome,
} from '../../domain/internal-validation';
import { resolveValidationTargets } from './validation-target-resolver';

export const PLANNER_ALLOWED_TARGETS_VALIDATOR = 'PlannerAllowedTargets';

/**
 * Checks declared execution targets against the supplied authority.
 *
 * The validator reports; it never repairs. Unauthorized targets are returned as
 * rejections rather than being dropped, reclassified as context, or normalized.
 */
export const plannerAllowedTargetsValidator: ValidatorContract = {
  name: PLANNER_ALLOWED_TARGETS_VALIDATOR,
  type: 'EXECUTION_AUTHORITY',
  deterministic: true,
  mutationPolicy: 'NONE',
  isolation: 'INTERNAL_VALIDATION_ONLY',
  // Reads the declared targets and the context paths, nothing else. No
  // filesystem, no process, no network, no model.
  capabilities: ['READ_INPUT', 'READ_CONTEXT'],
  executionMode: 'SYNC_ONLY',
  contractVersion: '1.0.0',
  inputSchema: {
    requiredFields: [],
    requiredAnyOf: ['files', 'affectedFiles'],
    optionalFields: ['goal', 'contextReferences', 'metadataReferences', 'authority', 'context'],
    description: 'Declared execution targets checked against the declared authority.',
  },

  validate(request: InternalValidationRequest): InternalValidationOutcome {
    const { declaredTargets, declaredReferences, authority } = resolveValidationTargets(request);

    const rejectedTargets = declaredTargets.filter(target => !authority.isAllowed(target));
    const metadata = Object.freeze({
      declaredTargetCount: declaredTargets.length,
      declaredReferenceCount: declaredReferences.length,
      authorizedPaths: authority.confirmedFiles,
    });

    if (rejectedTargets.length === 0) {
      return createValidationOutcome({
        validator: PLANNER_ALLOWED_TARGETS_VALIDATOR,
        status: 'ACCEPT',
        message: `All ${declaredTargets.length} declared execution target(s) are authorized`,
        metadata,
      });
    }

    // Wording is validator-centric: an internal validation run has no planner,
    // so "planner referenced" would misdescribe where the target came from.
    return createValidationOutcome({
      validator: PLANNER_ALLOWED_TARGETS_VALIDATOR,
      status: 'REJECT',
      reasonCode: 'PLANNER_UNGROUNDED_TARGET',
      rejectedTargets,
      issues: rejectedTargets.map(
        target => `Validation target is not authorized by declared authority: ${target}`,
      ),
      message: `PLANNER_UNGROUNDED_TARGET: Validation target is not authorized by declared authority: ${rejectedTargets.join(', ')}`,
      metadata,
    });
  },
};
