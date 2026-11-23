import {
  InternalValidationOutcome,
  InternalValidationRequest,
  ValidatorCapabilities,
  ValidatorContract,
  ValidatorInputSchema,
  createValidationOutcome,
} from '../../domain/internal-validation';
import { SYSTEM_BOOTSTRAP_ACTOR } from '../../domain/validator-governance';
import { ValidationRegistry } from './validation-registry';

export const VALIDATOR_REGISTRY_IMMUTABILITY_VALIDATOR = 'ValidatorRegistryImmutability';

export const MUTATION_VECTORS = [
  'mutateOriginalContract',
  'mutateCapabilitiesResult',
  'mutateInputSchema',
  'mutateNestedArrays',
  'mutateIsolation',
  'mutateMutationPolicy',
] as const;

type MutationVector = (typeof MUTATION_VECTORS)[number];

/** A frozen target throws in strict mode; the attempt itself is what matters. */
function attempt(mutate: () => void): void {
  try {
    mutate();
  } catch {
    // Rejecting the write is the passing behavior.
  }
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * Rebuilds the declared contract from the request payload without holding any
 * reference into it, so the caller's input cannot be reached or altered.
 */
function buildContractFromPayload(payload: Record<string, unknown>): ValidatorContract {
  const schemaRaw = (payload.inputSchema ?? {}) as Record<string, unknown>;
  const inputSchema: ValidatorInputSchema = {
    requiredFields: [...toStringList(schemaRaw.requiredFields)],
    requiredAnyOf: [...toStringList(schemaRaw.requiredAnyOf)],
    optionalFields: [...toStringList(schemaRaw.optionalFields)],
    description: typeof schemaRaw.description === 'string' ? schemaRaw.description : undefined,
  };

  return {
    name: String(payload.name ?? ''),
    type: String(payload.type ?? ''),
    deterministic: payload.deterministic === true,
    mutationPolicy: (payload.mutationPolicy ?? 'NONE') as ValidatorContract['mutationPolicy'],
    isolation: (payload.isolation ?? 'INTERNAL_VALIDATION_ONLY') as ValidatorContract['isolation'],
    capabilities: declaredCapabilities(payload.capabilities),
    executionMode: payload.executionMode === 'ASYNC_ALLOWED' ? 'ASYNC_ALLOWED' : 'SYNC_ONLY',
    contractVersion: typeof payload.contractVersion === 'string' ? payload.contractVersion : '1.0.0',
    inputSchema,
    validate: () => createValidationOutcome({ validator: String(payload.name ?? ''), status: 'ACCEPT' }),
  };
}

/** A payload may name its own capabilities; otherwise the minimum read grant. */
function declaredCapabilities(value: unknown): ValidatorContract['capabilities'] {
  const declared = toStringList(value);
  return (declared.length > 0 ? declared : ['READ_INPUT']) as ValidatorContract['capabilities'];
}

function snapshot(capabilities: ValidatorCapabilities | undefined): string {
  return JSON.stringify(capabilities ?? null);
}

/**
 * Proves that a registered ValidatorContract cannot be altered after the fact.
 *
 * It builds a throwaway registry, registers a contract described by the
 * request, then attacks the contract through every route a caller could hold:
 * the object originally handed to register, the object returned by
 * capabilities(), the nested input schema, and the arrays inside it. Registry
 * state is compared before and after by value, so shallow freezing that leaves
 * nested arrays writable is caught.
 */
export const validatorRegistryImmutabilityValidator: ValidatorContract = {
  name: VALIDATOR_REGISTRY_IMMUTABILITY_VALIDATOR,
  type: 'INTERNAL_SYSTEM',
  deterministic: true,
  mutationPolicy: 'NONE',
  isolation: 'INTERNAL_VALIDATION_ONLY',
  capabilities: ['READ_INPUT', 'READ_VALIDATOR_METADATA'],
  executionMode: 'SYNC_ONLY',
  contractVersion: '1.0.0',
  inputSchema: {
    requiredFields: ['registerContract'],
    optionalFields: ['mutationTests'],
    description: 'Registers a throwaway contract and proves the registry copy cannot be mutated.',
  },

  validate(request: InternalValidationRequest): InternalValidationOutcome {
    const input = (request.input ?? {}) as Record<string, unknown>;
    const declared = input.registerContract;
    if (declared === null || typeof declared !== 'object') {
      return createValidationOutcome({
        validator: VALIDATOR_REGISTRY_IMMUTABILITY_VALIDATOR,
        status: 'ERROR',
        reasonCode: 'INVALID_VALIDATION_REQUEST',
        issues: ['registerContract must be an object'],
        message: 'INVALID_VALIDATION_REQUEST: registerContract must be an object',
      });
    }

    const requested = toStringList(input.mutationTests) as MutationVector[];
    const vectors = requested.length > 0 ? requested : [...MUTATION_VECTORS];

    const registry = new ValidationRegistry();
    const originalContract = buildContractFromPayload(declared as Record<string, unknown>);
    const originalSnapshot = snapshot({
      name: originalContract.name,
      type: originalContract.type,
      deterministic: originalContract.deterministic,
      mutationPolicy: originalContract.mutationPolicy,
      isolation: originalContract.isolation,
      inputSchema: originalContract.inputSchema,
      capabilities: originalContract.capabilities,
      executionMode: originalContract.executionMode,
      contractVersion: originalContract.contractVersion,
    });

    const registration = registry.register(originalContract, SYSTEM_BOOTSTRAP_ACTOR);
    if (!registration.ok) {
      return createValidationOutcome({
        validator: VALIDATOR_REGISTRY_IMMUTABILITY_VALIDATOR,
        status: 'ERROR',
        reasonCode: registration.code ?? 'INVALID_VALIDATOR_CONTRACT',
        issues: [registration.message ?? 'registration refused'],
        message: registration.message ?? 'registration refused',
      });
    }

    // Held separately: the mutation vectors rename the caller's object, and
    // lookups must keep targeting the name that was actually registered.
    const registeredName = originalContract.name;
    const registeredSnapshot = snapshot(registry.capabilitiesOf(registeredName));
    const issues: string[] = [];
    const applied: string[] = [];

    for (const vector of vectors) {
      switch (vector) {
        case 'mutateOriginalContract':
          attempt(() => { (originalContract as any).name = 'HijackedName'; });
          attempt(() => { (originalContract as any).type = 'HIJACKED'; });
          attempt(() => { (originalContract as any).deterministic = false; });
          break;
        case 'mutateCapabilitiesResult': {
          const exposed = registry.capabilitiesOf(registeredName) as any;
          attempt(() => { exposed.name = 'HijackedName'; });
          attempt(() => { exposed.deterministic = false; });
          attempt(() => { exposed.inputSchema = { requiredFields: ['hijacked'] }; });
          break;
        }
        case 'mutateInputSchema': {
          attempt(() => { (originalContract.inputSchema as any).description = 'hijacked'; });
          const exposed = registry.capabilitiesOf(registeredName) as any;
          attempt(() => { exposed.inputSchema.requiredFields = ['hijacked']; });
          break;
        }
        case 'mutateNestedArrays': {
          const exposed = registry.capabilitiesOf(registeredName) as any;
          attempt(() => { exposed.inputSchema.requiredAnyOf.push('hijacked'); });
          attempt(() => { exposed.inputSchema.requiredFields.push('hijacked'); });
          attempt(() => { (originalContract.inputSchema.requiredAnyOf as any).push('hijacked'); });
          break;
        }
        case 'mutateIsolation':
          attempt(() => { (originalContract as any).isolation = 'SHARED'; });
          attempt(() => { (registry.capabilitiesOf(registeredName) as any).isolation = 'SHARED'; });
          break;
        case 'mutateMutationPolicy':
          attempt(() => { (originalContract as any).mutationPolicy = 'WRITE'; });
          attempt(() => { (registry.capabilitiesOf(registeredName) as any).mutationPolicy = 'WRITE'; });
          break;
        default:
          issues.push(`unknown mutation vector: ${vector}`);
          continue;
      }
      applied.push(vector);
    }

    const resolved = registry.resolve(registeredName);
    const afterSnapshot = snapshot(registry.capabilitiesOf(registeredName));
    const capabilitiesStable = afterSnapshot === registeredSnapshot;
    const originalContractStable = registeredSnapshot === originalSnapshot;

    const afterCapabilities = registry.capabilitiesOf(registeredName);
    const nestedSchemaStable = JSON.stringify(afterCapabilities?.inputSchema ?? null)
      === JSON.stringify(JSON.parse(originalSnapshot)?.inputSchema ?? null);

    if (!resolved) issues.push('validator is no longer resolvable after mutation attempts');
    if (!capabilitiesStable) issues.push('exposed capabilities changed after mutation attempts');
    if (!originalContractStable) issues.push('registered contract diverged from the declared contract');
    if (!nestedSchemaStable) issues.push('nested input schema changed after mutation attempts');
    if (resolved && resolved.mutationPolicy !== 'NONE') issues.push('mutationPolicy changed');
    if (resolved && resolved.deterministic !== true) issues.push('deterministic changed');
    if (resolved && resolved.isolation !== 'INTERNAL_VALIDATION_ONLY') issues.push('isolation changed');

    const metadata = Object.freeze({
      originalContract: JSON.parse(originalSnapshot),
      resolvedContract: afterCapabilities ?? null,
      capabilitiesStable,
      originalContractStable,
      nestedSchemaStable,
      mutationAttempts: applied.length,
      appliedVectors: Object.freeze([...applied]),
    });

    if (issues.length > 0) {
      return createValidationOutcome({
        validator: VALIDATOR_REGISTRY_IMMUTABILITY_VALIDATOR,
        status: 'REJECT',
        reasonCode: 'VALIDATOR_REGISTRY_MUTABLE',
        issues,
        message: `VALIDATOR_REGISTRY_MUTABLE: ${issues.join('; ')}`,
        metadata,
      });
    }

    return createValidationOutcome({
      validator: VALIDATOR_REGISTRY_IMMUTABILITY_VALIDATOR,
      status: 'ACCEPT',
      message: `Registry contract survived ${applied.length} mutation vector(s) unchanged`,
      metadata,
    });
  },
};
