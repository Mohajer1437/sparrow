import { TEST_ACTOR } from './test-actor';
import {
  InternalValidationRequest,
  ValidatorContract,
  createValidationOutcome,
  validateValidatorContract,
} from '../../../src/domain/internal-validation';
import { ValidationRegistry } from '../../../src/core/validation/validation-registry';
import { internalValidationRunner } from '../../../src/core/validation/internal-validation-runner';
import { EXPOSURE_MUTATION_VECTORS } from '../../../src/core/validation/validator-resolve-exposure-audit-validator';

/**
 * Contract from the audit spec. Built fresh per test so one attack cannot leak
 * into the next through a shared object.
 */
function resolveMutationTestContract(): ValidatorContract {
  const contract: ValidatorContract = {
    name: 'ResolveMutationTest',
    type: 'EXECUTION_AUTHORITY',
    deterministic: true,
    mutationPolicy: 'NONE',
    isolation: 'INTERNAL_VALIDATION_ONLY',
    capabilities: ['READ_INPUT'],
    executionMode: 'SYNC_ONLY',
    contractVersion: '1.0.0',
    inputSchema: { requiredFields: [], requiredAnyOf: ['files'] },
    validate(request: InternalValidationRequest) {
      // Reads its own metadata at call time, so a mutable `this` would show up.
      const self = this as ValidatorContract;
      return createValidationOutcome({
        validator: self.name,
        status: 'ACCEPT',
        message: 'ok',
        metadata: {
          seenMutationPolicy: self.mutationPolicy,
          seenDeterministic: self.deterministic,
          seenRequiredAnyOf: [...(self.inputSchema.requiredAnyOf ?? [])],
          seenInput: request.input,
        },
      });
    },
  };
  return contract;
}

function registryWith(contract: ValidatorContract): ValidationRegistry {
  const registry = new ValidationRegistry();
  expect(registry.register(contract, TEST_ACTOR).ok).toBe(true);
  return registry;
}

/** A frozen target throws in strict mode; either outcome is acceptable. */
function attempt(mutate: () => void): void {
  try {
    mutate();
  } catch {
    // Rejecting the write is the passing behavior.
  }
}

describe('ValidatorRegistry resolve exposure', () => {
  it('keeps the registered contract unchanged after a resolve mutation attack', () => {
    const registry = registryWith(resolveMutationTestContract());

    const resolved = registry.resolve('ResolveMutationTest') as any;
    attempt(() => { resolved.mutationPolicy = 'WRITE'; });
    attempt(() => { resolved.deterministic = false; });
    attempt(() => { resolved.inputSchema.requiredAnyOf.push('hack'); });
    attempt(() => { resolved.name = 'HijackedName'; });
    attempt(() => { resolved.type = 'HIJACKED'; });
    attempt(() => { resolved.isolation = 'SHARED'; });

    const again = registry.resolve('ResolveMutationTest');
    expect(again).toBeDefined();
    expect(again!.name).toBe('ResolveMutationTest');
    expect(again!.type).toBe('EXECUTION_AUTHORITY');
    expect(again!.mutationPolicy).toBe('NONE');
    expect(again!.deterministic).toBe(true);
    expect(again!.isolation).toBe('INTERNAL_VALIDATION_ONLY');
    expect(again!.inputSchema.requiredAnyOf).toEqual(['files']);
  });

  it('executes a resolved validator with its original capabilities after mutation', () => {
    const source = resolveMutationTestContract();
    const registry = registryWith(source);

    const resolved = registry.resolve('ResolveMutationTest') as any;
    attempt(() => { resolved.mutationPolicy = 'WRITE'; });
    attempt(() => { resolved.deterministic = false; });
    attempt(() => { resolved.inputSchema.requiredAnyOf.push('hack'); });

    // The object the caller originally handed to register() is still mutable;
    // edits to it must not reach the bound execution either.
    (source as any).mutationPolicy = 'WRITE';
    (source as any).deterministic = false;
    (source.inputSchema.requiredAnyOf as string[]).push('hack');

    const executable = registry.resolve('ResolveMutationTest')!;
    expect(validateValidatorContract(executable).valid).toBe(true);

    const outcome = executable.validate({ validator: 'ResolveMutationTest', input: { files: ['a.ts'] } });
    expect(outcome.status).toBe('ACCEPT');
    expect(outcome.validator).toBe('ResolveMutationTest');
    expect(outcome.metadata?.seenMutationPolicy).toBe('NONE');
    expect(outcome.metadata?.seenDeterministic).toBe(true);
    expect(outcome.metadata?.seenRequiredAnyOf).toEqual(['files']);
  });

  it('does not let a mutated capabilities result affect a later one', () => {
    const registry = registryWith(resolveMutationTestContract());

    const first = registry.capabilitiesOf('ResolveMutationTest') as any;
    attempt(() => { first.name = 'HijackedName'; });
    attempt(() => { first.mutationPolicy = 'WRITE'; });
    attempt(() => { first.inputSchema.requiredAnyOf.push('hack'); });

    const second = registry.capabilitiesOf('ResolveMutationTest')!;
    expect(second.name).toBe('ResolveMutationTest');
    expect(second.mutationPolicy).toBe('NONE');
    expect(second.inputSchema.requiredAnyOf).toEqual(['files']);

    const listed = registry.capabilities().find(entry => entry.name === 'ResolveMutationTest')!;
    expect(listed.inputSchema.requiredAnyOf).toEqual(['files']);
  });

  it('rejects nested and unknown-property mutation on a resolved contract', () => {
    const registry = registryWith(resolveMutationTestContract());
    const resolved = registry.resolve('ResolveMutationTest') as any;

    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.inputSchema)).toBe(true);
    expect(Object.isFrozen(resolved.inputSchema.requiredAnyOf)).toBe(true);
    expect(Object.isFrozen(resolved.inputSchema.requiredFields)).toBe(true);

    attempt(() => { resolved.inputSchema.requiredAnyOf.push('hack'); });
    attempt(() => { resolved.inputSchema.anyOf = ['hijacked']; });
    attempt(() => { resolved.metadata = { hijacked: true }; });
    attempt(() => { resolved.inputSchema = { requiredFields: ['hijacked'] }; });

    const again = registry.resolve('ResolveMutationTest')!;
    expect(again.inputSchema.requiredAnyOf).toEqual(['files']);
    expect(again.inputSchema.requiredFields).toEqual([]);
    expect((again as any).anyOf).toBeUndefined();
    expect((again as any).metadata).toBeUndefined();
  });
});

describe('ValidatorResolveExposureAudit validator', () => {
  it('accepts with stability metadata for every exposure vector', () => {
    const outcome = internalValidationRunner.run({
      validator: 'ValidatorResolveExposureAudit',
      input: { target: 'PlannerAllowedTargets', mutationTests: [...EXPOSURE_MUTATION_VECTORS] },
    });

    expect(outcome.status).toBe('ACCEPT');
    expect(outcome.issues).toEqual([]);
    expect(outcome.metadata?.contractStable).toBe(true);
    expect(outcome.metadata?.schemaStable).toBe(true);
    expect(outcome.metadata?.capabilitiesStable).toBe(true);
    expect(outcome.metadata?.executionStable).toBe(true);
    expect(outcome.metadata?.mutationAttempts).toBe(EXPOSURE_MUTATION_VECTORS.length);
  });

  it('leaves the audited validator intact for later runs', () => {
    internalValidationRunner.run({
      validator: 'ValidatorResolveExposureAudit',
      input: { target: 'PlannerAllowedTargets' },
    });

    const outcome = internalValidationRunner.run({
      validator: 'PlannerAllowedTargets',
      input: { files: ['src/a.ts'] },
      authority: ['src/a.ts'],
    });
    expect(outcome.status).toBe('ACCEPT');
  });

  it('reports UNKNOWN_VALIDATOR when the audit target is not registered', () => {
    const outcome = internalValidationRunner.run({
      validator: 'ValidatorResolveExposureAudit',
      input: { target: 'ResolveMutationValidatorXYZ' },
    });

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('UNKNOWN_VALIDATOR');
  });

  it('reports UNKNOWN_VALIDATOR for an unregistered audit validator name', () => {
    const outcome = internalValidationRunner.run({
      validator: 'ValidatorResolveExposureAuditXYZ',
      input: {},
    });

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('UNKNOWN_VALIDATOR');
  });
});
