import { TEST_ACTOR } from './test-actor';
import * as fs from 'fs';
import * as childProcess from 'child_process';

import {
  INTERNAL_VALIDATION_ERROR_CODES,
  ValidatorContract,
  createValidationOutcome,
} from '../../../src/domain/internal-validation';
import {
  CAPABILITIES_FORBIDDEN_IN_INTERNAL_VALIDATION,
  DEFAULT_CAPABILITY_POLICY,
  VALIDATOR_CAPABILITIES,
  capabilityPolicyFor,
  checkCapabilityDeclaration,
  policyAllows,
} from '../../../src/domain/validator-capability';
import { ValidationRegistry } from '../../../src/core/validation/validation-registry';
import { InternalValidationRunner, internalValidationRunner } from '../../../src/core/validation/internal-validation-runner';
import {
  executeWithCapabilityGuard,
  interceptedSurface,
} from '../../../src/core/validation/validator-capability-guard';
import { createValidatorCapabilityContext } from '../../../src/core/validation/validator-capability-context';
import {
  capabilityRespectingValidator,
  fakeFilesystemValidator,
  fakeNetworkValidator,
  fakeProcessValidator,
  fakeWriteValidator,
} from '../../../src/core/validation/adversarial-validators';

function runnerFor(...validators: ValidatorContract[]): InternalValidationRunner {
  const registry = new ValidationRegistry();
  for (const validator of validators) {
    expect(registry.register(validator, TEST_ACTOR).ok).toBe(true);
  }
  return new InternalValidationRunner(registry);
}

const request = (validator: string) => ({ validator, input: { files: ['package.json'] } });

/** Fails the test if any pipeline stage is reached during internal validation. */
function forbiddenStageSpies() {
  const spies = {
    planner: jest.fn(),
    provider: jest.fn(),
    executor: jest.fn(),
    reviewer: jest.fn(),
  };
  return {
    ...spies,
    expectNoneCalled() {
      for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
    },
  };
}

describe('capability model', () => {
  it('denies by default with nothing granted', () => {
    expect(DEFAULT_CAPABILITY_POLICY.denyByDefault).toBe(true);
    expect(DEFAULT_CAPABILITY_POLICY.allowed).toEqual([]);
    expect(policyAllows(DEFAULT_CAPABILITY_POLICY, 'READ_INPUT')).toBe(false);
  });

  it('grants exactly what a contract declared and nothing adjacent', () => {
    const policy = capabilityPolicyFor(['READ_INPUT']);
    expect(policyAllows(policy, 'READ_INPUT')).toBe(true);
    expect(policyAllows(policy, 'READ_CONTEXT')).toBe(false);
    expect(policyAllows(policy, 'FILESYSTEM_READ')).toBe(false);
  });

  it('names the full capability vocabulary', () => {
    expect(VALIDATOR_CAPABILITIES).toEqual([
      'READ_INPUT',
      'READ_CONTEXT',
      'READ_VALIDATOR_METADATA',
      'WRITE_NONE',
      'FILESYSTEM_READ',
      'FILESYSTEM_WRITE',
      'PROCESS_EXECUTION',
      'NETWORK_ACCESS',
      'MODEL_ACCESS',
    ]);
  });

  it('declares the capability violation reason codes', () => {
    expect(INTERNAL_VALIDATION_ERROR_CODES).toEqual(
      expect.arrayContaining(['VALIDATOR_CAPABILITY_VIOLATION', 'INVALID_VALIDATOR_CAPABILITY']),
    );
  });

  it('watches the filesystem, process and network entry points', () => {
    const surface = interceptedSurface();
    expect(surface).toEqual(
      expect.arrayContaining([
        'fs.readFileSync',
        'fs.writeFileSync',
        'child_process.execSync',
        'https.request',
      ]),
    );
  });
});

describe('capability context', () => {
  const metadata = {
    name: 'ContextProbe',
    type: 'ADVERSARIAL_FIXTURE',
    deterministic: true,
    mutationPolicy: 'NONE' as const,
    isolation: 'INTERNAL_VALIDATION_ONLY' as const,
    inputSchema: { requiredFields: [] },
    capabilities: ['READ_INPUT' as const],
    executionMode: 'SYNC_ONLY' as const,
    contractVersion: '1.0.0',
  };

  function contextFor(allowed: Parameters<typeof capabilityPolicyFor>[0]) {
    const violations: string[] = [];
    const context = createValidatorCapabilityContext({
      validator: 'ContextProbe',
      metadata,
      policy: capabilityPolicyFor(allowed),
      request: { validator: 'ContextProbe', input: { files: ['a.ts'] }, context: ['docs/x.md'] },
      onViolation: capability => violations.push(capability),
    });
    return { context, violations };
  }

  it('serves a granted read and refuses an ungranted one', () => {
    const { context, violations } = contextFor(['READ_INPUT']);

    expect(context.readInput<any>().files).toEqual(['a.ts']);
    expect(() => context.readContext()).toThrow(/VALIDATOR_CAPABILITY_VIOLATION/);
    expect(violations).toEqual(['READ_CONTEXT']);
  });

  it('hands out frozen copies so a read cannot become a write', () => {
    const { context } = contextFor(['READ_INPUT']);
    const input = context.readInput<any>();

    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.files)).toBe(true);
  });

  it('exposes no filesystem, process, provider or executor handle', () => {
    const { context } = contextFor(['READ_INPUT', 'READ_CONTEXT', 'READ_VALIDATOR_METADATA']);

    expect(Object.keys(context).sort()).toEqual([
      'granted',
      'has',
      'readContext',
      'readInput',
      'readMetadata',
    ]);
    for (const forbidden of ['fs', 'childProcess', 'child_process', 'fetch', 'provider', 'executor', 'planner']) {
      expect((context as any)[forbidden]).toBeUndefined();
    }
  });

  it('reports what it granted', () => {
    const { context } = contextFor(['READ_INPUT']);
    expect(context.granted()).toEqual(['READ_INPUT']);
    expect(context.has('READ_INPUT')).toBe(true);
    expect(context.has('NETWORK_ACCESS')).toBe(false);
  });
});

describe('Case A: filesystem read without the capability', () => {
  it('rejects with VALIDATOR_CAPABILITY_VIOLATION', () => {
    const stages = forbiddenStageSpies();
    const outcome = runnerFor(fakeFilesystemValidator).run(request('FakeFilesystemValidator'));

    expect(outcome.status).toBe('REJECT');
    expect(outcome.reasonCode).toBe('VALIDATOR_CAPABILITY_VIOLATION');
    expect(outcome.metadata?.requestedCapability).toBe('FILESYSTEM_READ');
    expect(outcome.metadata?.allowedCapabilities).toEqual(['READ_INPUT']);
    expect(outcome.metadata?.validator).toBe('FakeFilesystemValidator');
    stages.expectNoneCalled();
  });

  it('restores the intercepted entry points afterwards', () => {
    const before = fs.readFileSync;
    runnerFor(fakeFilesystemValidator).run(request('FakeFilesystemValidator'));

    expect(fs.readFileSync).toBe(before);
    expect(typeof fs.readFileSync('package.json', 'utf8')).toBe('string');
  });
});

describe('Case B: filesystem write without the capability', () => {
  it('rejects and never performs the write', () => {
    const original = fs.writeFileSync;
    const outcome = runnerFor(fakeWriteValidator).run(request('FakeWriteValidator'));

    expect(outcome.status).toBe('REJECT');
    expect(outcome.reasonCode).toBe('VALIDATOR_CAPABILITY_VIOLATION');
    expect(outcome.metadata?.requestedCapability).toBe('FILESYSTEM_WRITE');
    // The write the fixture attempted never reached the disk, and the real
    // implementation is back in place afterwards.
    expect(fs.existsSync('capability-breach.tmp')).toBe(false);
    expect(fs.writeFileSync).toBe(original);
  });
});

describe('Case C: process execution without the capability', () => {
  it('rejects and never spawns', () => {
    const original = childProcess.execSync;
    const outcome = runnerFor(fakeProcessValidator).run(request('FakeProcessValidator'));

    expect(outcome.status).toBe('REJECT');
    expect(outcome.reasonCode).toBe('VALIDATOR_CAPABILITY_VIOLATION');
    expect(outcome.metadata?.requestedCapability).toBe('PROCESS_EXECUTION');
    expect(childProcess.execSync).toBe(original);
  });
});

describe('Case D: network access without the capability', () => {
  it('rejects the call', () => {
    const outcome = runnerFor(fakeNetworkValidator).run(request('FakeNetworkValidator'));

    expect(outcome.status).toBe('REJECT');
    expect(outcome.reasonCode).toBe('VALIDATOR_CAPABILITY_VIOLATION');
    expect(outcome.metadata?.requestedCapability).toBe('NETWORK_ACCESS');
  });
});

describe('Case E: a validator that stays inside its capabilities', () => {
  it('accepts and reads only through the capability context', () => {
    const stages = forbiddenStageSpies();
    const outcome = runnerFor(capabilityRespectingValidator).run(request('CapabilityRespectingValidator'));

    expect(outcome.status).toBe('ACCEPT');
    expect(outcome.reasonCode).toBeUndefined();
    expect(outcome.metadata?.fileCount).toBe(1);
    expect(outcome.metadata?.usedCapabilityContext).toBe(true);
    stages.expectNoneCalled();
  });

  it('runs the body once per capability-guarded execution', () => {
    const validate = jest.fn(() =>
      createValidationOutcome({ validator: 'CountedValidator', status: 'ACCEPT' }),
    );
    const counted: ValidatorContract = {
      name: 'CountedValidator',
      type: 'ADVERSARIAL_FIXTURE',
      deterministic: true,
      mutationPolicy: 'NONE',
      isolation: 'INTERNAL_VALIDATION_ONLY',
      capabilities: ['READ_INPUT'],
      executionMode: 'SYNC_ONLY',
      contractVersion: '1.0.0',
      inputSchema: { requiredFields: [] },
      validate,
    };

    const result = executeWithCapabilityGuard(counted, { validator: 'CountedValidator', input: {} });

    expect(result.executed).toBe(true);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(result.policy.allowed).toEqual(['READ_INPUT']);
  });
});

describe('registry capability enforcement', () => {
  function contractWithout(capabilities: unknown): ValidatorContract {
    return {
      name: 'CapabilityDeclarationProbe',
      type: 'ADVERSARIAL_FIXTURE',
      deterministic: true,
      mutationPolicy: 'NONE',
      isolation: 'INTERNAL_VALIDATION_ONLY',
      capabilities,
      executionMode: 'SYNC_ONLY',
      contractVersion: '1.0.0',
      inputSchema: { requiredFields: [] },
      validate: () =>
        createValidationOutcome({ validator: 'CapabilityDeclarationProbe', status: 'ACCEPT' }),
    } as unknown as ValidatorContract;
  }

  it('refuses a contract that declares no capabilities at all', () => {
    const registration = new ValidationRegistry().register(contractWithout(undefined), TEST_ACTOR);

    expect(registration.ok).toBe(false);
    expect(registration.code).toBe('INVALID_VALIDATOR_CONTRACT');
    expect(registration.message).toContain('capabilities must be declared as an array');
  });

  it('refuses an unknown capability name', () => {
    const registration = new ValidationRegistry().register(contractWithout(['SUPER_POWER']), TEST_ACTOR);

    expect(registration.ok).toBe(false);
    expect(registration.code).toBe('INVALID_VALIDATOR_CAPABILITY');
    expect(registration.message).toContain('unknown capability: SUPER_POWER');
  });

  it('refuses a capability INTERNAL_VALIDATION never grants', () => {
    const registration = new ValidationRegistry().register(
      contractWithout(['READ_INPUT', 'FILESYSTEM_WRITE']),
      TEST_ACTOR,
    );

    expect(registration.ok).toBe(false);
    expect(registration.code).toBe('INVALID_VALIDATOR_CAPABILITY');
    expect(registration.message).toContain('FILESYSTEM_WRITE');
  });

  it('names every capability forbidden under INTERNAL_VALIDATION', () => {
    expect(CAPABILITIES_FORBIDDEN_IN_INTERNAL_VALIDATION).toEqual([
      'FILESYSTEM_READ',
      'FILESYSTEM_WRITE',
      'PROCESS_EXECUTION',
      'NETWORK_ACCESS',
      'MODEL_ACCESS',
    ]);
    expect(checkCapabilityDeclaration(['READ_INPUT', 'READ_CONTEXT']).valid).toBe(true);
  });
});

describe('capability regression for the production validators', () => {
  it('keeps PlannerAllowedTargets on read-only capabilities', () => {
    const outcome = internalValidationRunner.run({
      validator: 'PlannerAllowedTargets',
      input: { files: ['package.json'], authority: ['package.json'] },
      authority: ['package.json'],
    });

    expect(outcome.status).toBe('ACCEPT');
  });

  it('declares exactly READ_INPUT and READ_CONTEXT for PlannerAllowedTargets', () => {
    const { validationRegistry } = require('../../../src/core/validation/validation-registry');
    const declared = validationRegistry.capabilitiesOf('PlannerAllowedTargets')!;

    expect(declared.capabilities).toEqual(['READ_INPUT', 'READ_CONTEXT']);
    for (const forbidden of CAPABILITIES_FORBIDDEN_IN_INTERNAL_VALIDATION) {
      expect(declared.capabilities).not.toContain(forbidden);
    }
  });
});
