import { TEST_ACTOR } from './test-actor';
import {
  ValidatorContract,
  createValidationOutcome,
  validateValidatorContract,
} from '../../../src/domain/internal-validation';
import { ValidationRegistry } from '../../../src/core/validation/validation-registry';
import { InternalValidationRunner, internalValidationRunner } from '../../../src/core/validation/internal-validation-runner';
import {
  MUTATION_VECTORS,
  validatorRegistryImmutabilityValidator,
} from '../../../src/core/validation/validator-registry-immutability-validator';

const REGISTER_CONTRACT = {
  name: 'MutableTestValidator',
  type: 'EXECUTION_AUTHORITY',
  inputSchema: { requiredAnyOf: ['files'] },
  deterministic: true,
  mutationPolicy: 'NONE',
  isolation: 'INTERNAL_VALIDATION_ONLY',
};

function immutabilityRequest(overrides: Record<string, unknown> = {}) {
  return {
    validator: 'ValidatorRegistryImmutability',
    input: {
      registerContract: JSON.parse(JSON.stringify(REGISTER_CONTRACT)),
      mutationTests: [...MUTATION_VECTORS],
      ...overrides,
    },
  };
}

function mutableContract(): ValidatorContract {
  return {
    name: 'MutableTestValidator',
    type: 'EXECUTION_AUTHORITY',
    deterministic: true,
    mutationPolicy: 'NONE',
    isolation: 'INTERNAL_VALIDATION_ONLY',
    capabilities: ['READ_INPUT'],
    executionMode: 'SYNC_ONLY',
    contractVersion: '1.0.0',
    inputSchema: { requiredFields: [], requiredAnyOf: ['files'] },
    validate: () => createValidationOutcome({ validator: 'MutableTestValidator', status: 'ACCEPT' }),
  };
}

describe('A) Registry immutability, directly asserted', () => {
  it('detaches the registered contract from the object the caller supplied', () => {
    const registry = new ValidationRegistry();
    const contract = mutableContract();
    registry.register(contract, TEST_ACTOR);

    (contract as any).name = 'HijackedName';
    (contract as any).type = 'HIJACKED';
    (contract as any).deterministic = false;
    (contract as any).mutationPolicy = 'WRITE';
    (contract as any).isolation = 'SHARED';

    const registered = registry.resolve('MutableTestValidator');
    expect(registered?.name).toBe('MutableTestValidator');
    expect(registered?.type).toBe('EXECUTION_AUTHORITY');
    expect(registered?.deterministic).toBe(true);
    expect(registered?.mutationPolicy).toBe('NONE');
    expect(registered?.isolation).toBe('INTERNAL_VALIDATION_ONLY');
  });

  it('does not hand out a mutable reference through capabilities()', () => {
    const registry = new ValidationRegistry();
    registry.register(mutableContract(), TEST_ACTOR);

    const exposed = registry.capabilitiesOf('MutableTestValidator') as any;
    expect(() => { exposed.name = 'HijackedName'; }).toThrow();
    expect(() => { exposed.mutationPolicy = 'WRITE'; }).toThrow();

    const again = registry.capabilitiesOf('MutableTestValidator');
    expect(again?.name).toBe('MutableTestValidator');
    expect(again?.mutationPolicy).toBe('NONE');
  });

  it('freezes the nested input schema and its arrays, not just the top level', () => {
    const registry = new ValidationRegistry();
    registry.register(mutableContract(), TEST_ACTOR);

    const exposed = registry.capabilitiesOf('MutableTestValidator') as any;
    expect(() => { exposed.inputSchema.description = 'hijacked'; }).toThrow();
    expect(() => { exposed.inputSchema.requiredAnyOf.push('hijacked'); }).toThrow();
    expect(() => { exposed.inputSchema.requiredFields.push('hijacked'); }).toThrow();

    const again = registry.capabilitiesOf('MutableTestValidator');
    expect(again?.inputSchema.requiredAnyOf).toEqual(['files']);
    expect(again?.inputSchema.requiredFields).toEqual([]);
    expect(again?.inputSchema.description).toBeUndefined();
  });

  it('mutating one capabilities result does not affect the next one', () => {
    const registry = new ValidationRegistry();
    registry.register(mutableContract(), TEST_ACTOR);

    const first = JSON.stringify(registry.capabilitiesOf('MutableTestValidator'));
    try { (registry.capabilitiesOf('MutableTestValidator') as any).deterministic = false; } catch { /* frozen */ }
    const second = JSON.stringify(registry.capabilitiesOf('MutableTestValidator'));

    expect(second).toBe(first);
  });

  it('keeps the validator resolvable and its contract valid after every attack', () => {
    const registry = new ValidationRegistry();
    const contract = mutableContract();
    registry.register(contract, TEST_ACTOR);

    (contract as any).mutationPolicy = 'WRITE';
    try { (registry.capabilitiesOf('MutableTestValidator') as any).isolation = 'SHARED'; } catch { /* frozen */ }

    const registered = registry.resolve('MutableTestValidator');
    expect(registered).toBeDefined();
    expect(validateValidatorContract(registered).valid).toBe(true);
  });
});

describe('ValidatorRegistryImmutability validator', () => {
  it('declares the required internal-system contract', () => {
    expect(validatorRegistryImmutabilityValidator.name).toBe('ValidatorRegistryImmutability');
    expect(validatorRegistryImmutabilityValidator.type).toBe('INTERNAL_SYSTEM');
    expect(validatorRegistryImmutabilityValidator.deterministic).toBe(true);
    expect(validatorRegistryImmutabilityValidator.mutationPolicy).toBe('NONE');
    expect(validatorRegistryImmutabilityValidator.isolation).toBe('INTERNAL_VALIDATION_ONLY');
    expect(validateValidatorContract(validatorRegistryImmutabilityValidator).valid).toBe(true);
  });

  it('accepts with the required structured metadata', () => {
    const outcome = internalValidationRunner.run(immutabilityRequest());

    expect(outcome.status).toBe('ACCEPT');
    expect(outcome.metadata).toMatchObject({
      capabilitiesStable: true,
      originalContractStable: true,
      nestedSchemaStable: true,
      mutationAttempts: 6,
    });
    expect((outcome.metadata as any).originalContract.name).toBe('MutableTestValidator');
    expect((outcome.metadata as any).resolvedContract.name).toBe('MutableTestValidator');
    expect((outcome.metadata as any).resolvedContract.inputSchema.requiredAnyOf).toEqual(['files']);
  });

  it('is deterministic across repeated runs', () => {
    const a = internalValidationRunner.run(immutabilityRequest());
    const b = internalValidationRunner.run(immutabilityRequest());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('does not mutate the supplied input', () => {
    const request = immutabilityRequest();
    const before = JSON.stringify(request.input);

    internalValidationRunner.run(request);

    expect(JSON.stringify(request.input)).toBe(before);
  });

  it('rejects when registry state would actually be mutable', () => {
    // A stand-in registry that hands back live internal state.
    const leaky = {
      register: () => ({ ok: true }),
      resolve: () => mutableContract(),
      capabilitiesOf: () => ({ name: 'drifting-' + Math.random() } as any),
    };
    const spy = jest
      .spyOn(require('../../../src/core/validation/validation-registry'), 'ValidationRegistry')
      .mockImplementation(() => leaky as any);

    const outcome = validatorRegistryImmutabilityValidator.validate(immutabilityRequest());

    expect(outcome.status).toBe('REJECT');
    expect(outcome.reasonCode).toBe('VALIDATOR_REGISTRY_MUTABLE');
    spy.mockRestore();
  });
});

describe('C) Negative paths remain unchanged', () => {
  it('an unknown validator name still returns UNKNOWN_VALIDATOR', () => {
    const outcome = internalValidationRunner.run({
      validator: 'ValidatorRegistryImmutabilityXYZ',
      input: { registerContract: REGISTER_CONTRACT },
    });

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('UNKNOWN_VALIDATOR');
  });

  it('a malformed validator contract still returns INVALID_VALIDATOR_CONTRACT', () => {
    const broken = { ...validatorRegistryImmutabilityValidator, mutationPolicy: 'WRITE' } as any;
    const outcome = new InternalValidationRunner(() => broken, {
      allowUnverifiedSource: true,
    }).run(immutabilityRequest());

    expect(outcome.status).toBe('ERROR');
    expect(outcome.reasonCode).toBe('INVALID_VALIDATOR_CONTRACT');
  });

  it('malformed input still returns INVALID_VALIDATION_REQUEST', () => {
    const missingField = internalValidationRunner.run({
      validator: 'ValidatorRegistryImmutability',
      input: { mutationTests: ['mutateIsolation'] },
    });
    expect(missingField.status).toBe('ERROR');
    expect(missingField.reasonCode).toBe('INVALID_VALIDATION_REQUEST');

    const wrongType = internalValidationRunner.run({
      validator: 'ValidatorRegistryImmutability',
      input: { registerContract: 'not-an-object' },
    });
    expect(wrongType.status).toBe('ERROR');
    expect(wrongType.reasonCode).toBe('INVALID_VALIDATION_REQUEST');
  });
});
