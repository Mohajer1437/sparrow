import {
  InternalValidationOutcome,
  InternalValidationRequest,
  ValidatorContract,
  createValidationOutcome,
  validateValidatorContract,
} from '../../domain/internal-validation';
import { validationRegistry } from './validation-registry';

export const VALIDATOR_RESOLVE_EXPOSURE_AUDIT_VALIDATOR = 'ValidatorResolveExposureAudit';

export const EXPOSURE_MUTATION_VECTORS = [
  'mutateContract',
  'mutateSchema',
  'mutateCapabilities',
  'reResolve',
  'executeAfterMutation',
] as const;

type ExposureVector = (typeof EXPOSURE_MUTATION_VECTORS)[number];

/** A frozen target throws in strict mode; the attempt itself is what matters. */
function attempt(mutate: () => void): void {
  try {
    mutate();
  } catch {
    // Rejecting the write is the passing behavior.
  }
}

function contractSnapshot(contract: ValidatorContract | undefined): string {
  if (!contract) return 'null';
  return JSON.stringify({
    name: contract.name,
    type: contract.type,
    deterministic: contract.deterministic,
    mutationPolicy: contract.mutationPolicy,
    isolation: contract.isolation,
    inputSchema: contract.inputSchema,
  });
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * Audits every route by which the registry hands a validator to a caller.
 *
 * resolve() and capabilitiesOf() both expose objects; this attacks each one and
 * then re-reads registry state, so a mutable reference leak shows up as drift
 * rather than as a silent success.
 */
export const validatorResolveExposureAuditValidator: ValidatorContract = {
  name: VALIDATOR_RESOLVE_EXPOSURE_AUDIT_VALIDATOR,
  type: 'INTERNAL_SYSTEM',
  deterministic: true,
  mutationPolicy: 'NONE',
  isolation: 'INTERNAL_VALIDATION_ONLY',
  capabilities: ['READ_INPUT', 'READ_VALIDATOR_METADATA'],
  executionMode: 'SYNC_ONLY',
  contractVersion: '1.0.0',
  inputSchema: {
    requiredFields: ['target'],
    optionalFields: ['mutationTests'],
    description: 'Attacks every registry exposure path for a registered validator.',
  },

  validate(request: InternalValidationRequest): InternalValidationOutcome {
    const input = (request.input ?? {}) as Record<string, unknown>;
    const target = typeof input.target === 'string' ? input.target.trim() : '';
    if (!target) {
      return createValidationOutcome({
        validator: VALIDATOR_RESOLVE_EXPOSURE_AUDIT_VALIDATOR,
        status: 'ERROR',
        reasonCode: 'INVALID_VALIDATION_REQUEST',
        issues: ['target must be a validator name'],
        message: 'INVALID_VALIDATION_REQUEST: target must be a validator name',
      });
    }

    const resolved = validationRegistry.resolve(target);
    if (!resolved) {
      return createValidationOutcome({
        validator: VALIDATOR_RESOLVE_EXPOSURE_AUDIT_VALIDATOR,
        status: 'ERROR',
        reasonCode: 'UNKNOWN_VALIDATOR',
        issues: [`audit target is not registered: ${target}`],
        message: `UNKNOWN_VALIDATOR: ${target}`,
      });
    }

    const requested = toStringList(input.mutationTests) as ExposureVector[];
    const vectors = requested.length > 0 ? requested : [...EXPOSURE_MUTATION_VECTORS];

    const baselineContract = contractSnapshot(resolved);
    const baselineCapabilities = JSON.stringify(validationRegistry.capabilitiesOf(target) ?? null);
    const baselineSchema = JSON.stringify(resolved.inputSchema);

    const issues: string[] = [];
    const applied: string[] = [];
    let executionStable = true;

    for (const vector of vectors) {
      switch (vector) {
        case 'mutateContract': {
          const view = validationRegistry.resolve(target) as any;
          attempt(() => { view.name = 'HijackedName'; });
          attempt(() => { view.type = 'HIJACKED'; });
          attempt(() => { view.deterministic = false; });
          attempt(() => { view.mutationPolicy = 'WRITE'; });
          attempt(() => { view.isolation = 'SHARED'; });
          break;
        }
        case 'mutateSchema': {
          const view = validationRegistry.resolve(target) as any;
          attempt(() => { view.inputSchema = { requiredFields: ['hijacked'] }; });
          attempt(() => { view.inputSchema.description = 'hijacked'; });
          attempt(() => { view.inputSchema.requiredAnyOf.push('hack'); });
          attempt(() => { view.inputSchema.requiredFields.push('hack'); });
          attempt(() => { view.inputSchema.anyOf = ['hijacked']; });
          attempt(() => { view.metadata = { hijacked: true }; });
          break;
        }
        case 'mutateCapabilities': {
          const exposed = validationRegistry.capabilitiesOf(target) as any;
          attempt(() => { exposed.name = 'HijackedName'; });
          attempt(() => { exposed.mutationPolicy = 'WRITE'; });
          attempt(() => { exposed.inputSchema.requiredAnyOf.push('hack'); });
          break;
        }
        case 'reResolve': {
          const again = validationRegistry.resolve(target);
          if (contractSnapshot(again) !== baselineContract) {
            issues.push('resolve() returned a drifted contract after mutation attempts');
          }
          break;
        }
        case 'executeAfterMutation': {
          const again = validationRegistry.resolve(target);
          if (!again || !validateValidatorContract(again).valid) {
            executionStable = false;
            issues.push('resolved validator no longer satisfies its contract');
            break;
          }
          try {
            // Executed with a payload the target is expected to handle; the
            // point is that it runs with uncorrupted metadata, not its verdict.
            const outcome = again.validate({ validator: target, input: {}, authority: [] });
            if (outcome.validator !== resolved.name) {
              executionStable = false;
              issues.push('validator executed under a mutated identity');
            }
          } catch (error: any) {
            executionStable = false;
            issues.push(`resolved validator threw after mutation attempts: ${error?.message}`);
          }
          break;
        }
        default:
          issues.push(`unknown mutation vector: ${vector}`);
          continue;
      }
      applied.push(vector);
    }

    const finalResolved = validationRegistry.resolve(target);
    const contractStable = contractSnapshot(finalResolved) === baselineContract;
    const schemaStable = JSON.stringify(finalResolved?.inputSchema ?? null) === baselineSchema;
    const capabilitiesStable =
      JSON.stringify(validationRegistry.capabilitiesOf(target) ?? null) === baselineCapabilities;

    if (!finalResolved) issues.push('target is no longer resolvable after mutation attempts');
    if (!contractStable) issues.push('resolved contract changed after mutation attempts');
    if (!schemaStable) issues.push('resolved input schema changed after mutation attempts');
    if (!capabilitiesStable) issues.push('exposed capabilities changed after mutation attempts');

    const metadata = Object.freeze({
      target,
      contractStable,
      schemaStable,
      capabilitiesStable,
      executionStable,
      mutationAttempts: applied.length,
      appliedVectors: Object.freeze([...applied]),
      resolvedContract: validationRegistry.capabilitiesOf(target) ?? null,
    });

    if (issues.length > 0) {
      return createValidationOutcome({
        validator: VALIDATOR_RESOLVE_EXPOSURE_AUDIT_VALIDATOR,
        status: 'REJECT',
        reasonCode: 'VALIDATOR_RESOLVE_EXPOSED',
        issues,
        message: `VALIDATOR_RESOLVE_EXPOSED: ${issues.join('; ')}`,
        metadata,
      });
    }

    return createValidationOutcome({
      validator: VALIDATOR_RESOLVE_EXPOSURE_AUDIT_VALIDATOR,
      status: 'ACCEPT',
      message: `${target} survived ${applied.length} exposure vector(s) with no mutable reference leak`,
      metadata,
    });
  },
};
