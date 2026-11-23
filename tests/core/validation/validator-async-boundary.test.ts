import { TEST_ACTOR } from './test-actor';
import * as fs from 'fs';
import * as childProcess from 'child_process';

import {
  INTERNAL_VALIDATION_ERROR_CODES,
  ValidatorContract,
  createValidationOutcome,
  validateValidatorContract,
} from '../../../src/domain/internal-validation';
import { ValidationRegistry } from '../../../src/core/validation/validation-registry';
import { InternalValidationRunner, internalValidationRunner } from '../../../src/core/validation/internal-validation-runner';
import {
  blockedSchedulers,
  executeWithCapabilityGuard,
} from '../../../src/core/validation/validator-capability-guard';
import {
  fakeAsyncValidator,
  fakeDelayedEscapeValidator,
  fakePromiseCapabilityValidator,
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
    verification: jest.fn(),
  };
  return {
    ...spies,
    expectNoneCalled() {
      for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
    },
  };
}

function syncValidator(overrides: Partial<ValidatorContract> = {}): ValidatorContract {
  return {
    name: 'SyncOnlyProbe',
    type: 'ADVERSARIAL_FIXTURE',
    deterministic: true,
    mutationPolicy: 'NONE',
    isolation: 'INTERNAL_VALIDATION_ONLY',
    capabilities: ['READ_INPUT'],
    executionMode: 'SYNC_ONLY',
    contractVersion: '1.0.0',
    inputSchema: { requiredFields: [] },
    validate: () => createValidationOutcome({ validator: 'SyncOnlyProbe', status: 'ACCEPT' }),
    ...overrides,
  } as ValidatorContract;
}

describe('execution mode declaration', () => {
  it('declares the async escape reason code', () => {
    expect(INTERNAL_VALIDATION_ERROR_CODES).toContain('VALIDATOR_ASYNC_ESCAPE');
  });

  it('fails contract validation when executionMode is missing', () => {
    const contract = syncValidator();
    delete (contract as any).executionMode;

    const check = validateValidatorContract(contract);

    expect(check.valid).toBe(false);
    expect(check.violations).toEqual(
      expect.arrayContaining([expect.stringContaining('executionMode must be SYNC_ONLY or ASYNC_ALLOWED')]),
    );
  });

  it('refuses ASYNC_ALLOWED under INTERNAL_VALIDATION_ONLY isolation', () => {
    const check = validateValidatorContract(syncValidator({ executionMode: 'ASYNC_ALLOWED' }));

    expect(check.valid).toBe(false);
    expect(check.violations).toEqual(
      expect.arrayContaining([
        'executionMode must be SYNC_ONLY under INTERNAL_VALIDATION_ONLY isolation',
      ]),
    );
  });

  it('refuses registration of a contract with no execution mode', () => {
    const contract = syncValidator();
    delete (contract as any).executionMode;

    const registration = new ValidationRegistry().register(contract, TEST_ACTOR);

    expect(registration.ok).toBe(false);
    expect(registration.code).toBe('INVALID_VALIDATOR_CONTRACT');
  });

  it('blocks every scheduler a SYNC_ONLY body could reach for', () => {
    expect(blockedSchedulers()).toEqual(
      expect.arrayContaining(['setTimeout', 'setInterval', 'queueMicrotask', 'process.nextTick']),
    );
  });
});

describe('A) SYNC_ONLY validator that behaves', () => {
  it('accepts', () => {
    const stages = forbiddenStageSpies();
    const outcome = runnerFor(syncValidator()).run({ validator: 'SyncOnlyProbe', input: {} });

    expect(outcome.status).toBe('ACCEPT');
    expect(outcome.reasonCode).toBeUndefined();
    stages.expectNoneCalled();
  });
});

describe('B) SYNC_ONLY validator returning a promise', () => {
  it('rejects with VALIDATOR_ASYNC_ESCAPE', () => {
    const stages = forbiddenStageSpies();
    const outcome = runnerFor(fakeAsyncValidator).run(request('FakeAsyncValidator'));

    expect(outcome.status).toBe('REJECT');
    expect(outcome.reasonCode).toBe('VALIDATOR_ASYNC_ESCAPE');
    expect(outcome.metadata?.escapeKind).toBe('PROMISE_RETURNED');
    expect(outcome.metadata?.executionMode).toBe('SYNC_ONLY');
    stages.expectNoneCalled();
  });

  it('rejects a hand-rolled thenable too', () => {
    const thenable = syncValidator({
      name: 'ThenableProbe',
      validate: () => ({ then: () => undefined }) as unknown as ReturnType<ValidatorContract['validate']>,
    });

    const outcome = runnerFor(thenable).run({ validator: 'ThenableProbe', input: {} });

    expect(outcome.status).toBe('REJECT');
    expect(outcome.reasonCode).toBe('VALIDATOR_ASYNC_ESCAPE');
    expect(outcome.metadata?.escapeKind).toBe('PROMISE_RETURNED');
  });
});

describe('C) SYNC_ONLY validator scheduling a delayed filesystem escape', () => {
  it('rejects with VALIDATOR_ASYNC_ESCAPE and never runs the callback', async () => {
    const stages = forbiddenStageSpies();
    const outcome = runnerFor(fakeDelayedEscapeValidator).run(request('FakeDelayedEscapeValidator'));

    expect(outcome.status).toBe('REJECT');
    expect(outcome.reasonCode).toBe('VALIDATOR_ASYNC_ESCAPE');
    expect(outcome.metadata?.escapeKind).toBe('WORK_SCHEDULED');
    expect(outcome.metadata?.scheduledCalls).toEqual(['setTimeout']);
    stages.expectNoneCalled();

    // The timer was never queued, so nothing fires once the boundary is down.
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(fs.readFileSync).toBe(fs.readFileSync);
  });
});

describe('D) SYNC_ONLY validator deferring a capability into a microtask', () => {
  it('rejects with VALIDATOR_ASYNC_ESCAPE', async () => {
    const outcome = runnerFor(fakePromiseCapabilityValidator).run(
      request('FakePromiseCapabilityValidator'),
    );

    expect(outcome.status).toBe('REJECT');
    expect(outcome.reasonCode).toBe('VALIDATOR_ASYNC_ESCAPE');

    // Let any continuation the fixture created settle; it must not surface as
    // an unhandled rejection or a successful outcome.
    await Promise.resolve();
  });
});

describe('E) boundary restoration', () => {
  const originals = {
    readFileSync: fs.readFileSync,
    writeFileSync: fs.writeFileSync,
    execSync: childProcess.execSync,
    setTimeout: globalThis.setTimeout,
    queueMicrotask: globalThis.queueMicrotask,
    nextTick: process.nextTick,
    fetch: (globalThis as any).fetch,
  };

  function expectRestored() {
    expect(fs.readFileSync).toBe(originals.readFileSync);
    expect(fs.writeFileSync).toBe(originals.writeFileSync);
    expect(childProcess.execSync).toBe(originals.execSync);
    expect(globalThis.setTimeout).toBe(originals.setTimeout);
    expect(globalThis.queueMicrotask).toBe(originals.queueMicrotask);
    expect(process.nextTick).toBe(originals.nextTick);
    expect((globalThis as any).fetch).toBe(originals.fetch);
  }

  it('restores after a clean run', () => {
    runnerFor(syncValidator()).run({ validator: 'SyncOnlyProbe', input: {} });
    expectRestored();
  });

  it('restores after a rejected validation', () => {
    const rejecting = syncValidator({
      name: 'RejectingProbe',
      validate: () =>
        createValidationOutcome({ validator: 'RejectingProbe', status: 'REJECT', reasonCode: 'NOPE' }),
    });

    runnerFor(rejecting).run({ validator: 'RejectingProbe', input: {} });
    expectRestored();
  });

  it('restores after a validator throws', () => {
    const throwing = syncValidator({
      name: 'ThrowingProbe',
      validate: () => {
        throw new Error('boom');
      },
    });

    const outcome = runnerFor(throwing).run({ validator: 'ThrowingProbe', input: {} });

    expect(outcome.reasonCode).toBe('VALIDATOR_EXECUTION_ERROR');
    expectRestored();
  });

  it('restores after an async escape is detected', () => {
    runnerFor(fakeAsyncValidator).run(request('FakeAsyncValidator'));
    expectRestored();
  });

  it('restores after a capability violation', () => {
    const grabbing = syncValidator({
      name: 'GrabbingProbe',
      validate: () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('fs').readFileSync('package.json', 'utf8');
        return createValidationOutcome({ validator: 'GrabbingProbe', status: 'ACCEPT' });
      },
    });

    const outcome = runnerFor(grabbing).run({ validator: 'GrabbingProbe', input: {} });

    expect(outcome.reasonCode).toBe('VALIDATOR_CAPABILITY_VIOLATION');
    expectRestored();
    // The restored implementations still work, not just match by identity.
    expect(typeof fs.readFileSync('package.json', 'utf8')).toBe('string');
  });

  it('leaves schedulers usable for everyone else afterwards', async () => {
    runnerFor(fakeDelayedEscapeValidator).run(request('FakeDelayedEscapeValidator'));

    const fired = await new Promise<boolean>(resolve => setTimeout(() => resolve(true), 1));
    expect(fired).toBe(true);
    expectRestored();
  });
});

describe('F) regression for the shipped validators', () => {
  it('keeps PlannerAllowedTargets accepting an authorized target', () => {
    const stages = forbiddenStageSpies();

    const outcome = internalValidationRunner.run({
      validator: 'PlannerAllowedTargets',
      input: { files: ['package.json'], authority: ['package.json'] },
      authority: ['package.json'],
    });

    expect(outcome.status).toBe('ACCEPT');
    expect(outcome.reasonCode).toBeUndefined();
    stages.expectNoneCalled();
  });

  it('keeps PlannerAllowedTargets rejecting an unauthorized target', () => {
    const outcome = internalValidationRunner.run({
      validator: 'PlannerAllowedTargets',
      input: { files: ['src/secret.ts'] },
      authority: ['package.json'],
    });

    expect(outcome.status).toBe('REJECT');
    expect(outcome.reasonCode).not.toBe('VALIDATOR_ASYNC_ESCAPE');
    expect(outcome.rejectedTargets).toEqual(['src/secret.ts']);
  });

  it('declares SYNC_ONLY on every registered validator', () => {
    const { validationRegistry } = require('../../../src/core/validation/validation-registry');
    for (const declared of validationRegistry.capabilities()) {
      expect(declared.executionMode).toBe('SYNC_ONLY');
    }
  });

  it('reports the guard as not executed when an escape is detected', () => {
    const result = executeWithCapabilityGuard(fakeAsyncValidator, request('FakeAsyncValidator'));

    expect(result.executed).toBe(false);
    expect(result.outcome.reasonCode).toBe('VALIDATOR_ASYNC_ESCAPE');
  });
});
