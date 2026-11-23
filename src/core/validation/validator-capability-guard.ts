import {
  InternalValidationOutcome,
  InternalValidationRequest,
  ValidatorContract,
  createValidationOutcome,
  describeValidator,
} from '../../domain/internal-validation';
import {
  ValidatorCapability,
  ValidatorCapabilityPolicy,
  capabilityPolicyFor,
  checkCapabilityDeclaration,
  policyAllows,
} from '../../domain/validator-capability';
import {
  CapabilityViolationError,
  ValidatorCapabilityContext,
  createValidatorCapabilityContext,
} from './validator-capability-context';

/**
 * Runtime enforcement of declared capabilities.
 *
 * Two layers. The capability context is the *official* route: a validator asks
 * for input, context, or its own metadata and is refused anything it did not
 * declare. Ambient interception is the *unofficial* route: for the duration of
 * a validator's execution the guard replaces the entry points of `fs`,
 * `child_process`, `http`, `https`, and global `fetch` with functions that
 * record the attempt and refuse to perform it.
 *
 * Interception covers the module surface a validator would realistically reach
 * through `require`. It is deliberately not a sandbox — see the limitations
 * noted on `interceptedSurface()`.
 */

interface InterceptTarget {
  readonly holder: Record<string, any>;
  readonly key: string;
  readonly capability: ValidatorCapability;
  readonly label: string;
}

interface CapabilityAttempt {
  readonly capability: ValidatorCapability;
  readonly detail: string;
}

function safeRequire(moduleName: string): Record<string, any> | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(moduleName);
  } catch {
    return undefined;
  }
}

/** Entry points a validator would use to escape its declared capabilities. */
function interceptTargets(): InterceptTarget[] {
  const targets: InterceptTarget[] = [];

  const fs = safeRequire('fs');
  if (fs) {
    const reads = ['readFileSync', 'readFile', 'existsSync', 'readdirSync', 'readdir', 'statSync', 'createReadStream'];
    const writes = [
      'writeFileSync', 'writeFile', 'appendFileSync', 'appendFile',
      'unlinkSync', 'unlink', 'rmSync', 'rmdirSync', 'mkdirSync', 'renameSync',
      'copyFileSync', 'createWriteStream',
    ];
    for (const key of reads) {
      if (typeof fs[key] === 'function') {
        targets.push({ holder: fs, key, capability: 'FILESYSTEM_READ', label: `fs.${key}` });
      }
    }
    for (const key of writes) {
      if (typeof fs[key] === 'function') {
        targets.push({ holder: fs, key, capability: 'FILESYSTEM_WRITE', label: `fs.${key}` });
      }
    }
    if (fs.promises && typeof fs.promises === 'object') {
      for (const key of ['readFile', 'readdir', 'stat']) {
        if (typeof fs.promises[key] === 'function') {
          targets.push({ holder: fs.promises, key, capability: 'FILESYSTEM_READ', label: `fs.promises.${key}` });
        }
      }
      for (const key of ['writeFile', 'appendFile', 'unlink', 'rm', 'mkdir', 'rename']) {
        if (typeof fs.promises[key] === 'function') {
          targets.push({ holder: fs.promises, key, capability: 'FILESYSTEM_WRITE', label: `fs.promises.${key}` });
        }
      }
    }
  }

  const childProcess = safeRequire('child_process');
  if (childProcess) {
    for (const key of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) {
      if (typeof childProcess[key] === 'function') {
        targets.push({ holder: childProcess, key, capability: 'PROCESS_EXECUTION', label: `child_process.${key}` });
      }
    }
  }

  for (const moduleName of ['http', 'https']) {
    const mod = safeRequire(moduleName);
    if (!mod) continue;
    for (const key of ['request', 'get']) {
      if (typeof mod[key] === 'function') {
        targets.push({ holder: mod, key, capability: 'NETWORK_ACCESS', label: `${moduleName}.${key}` });
      }
    }
  }

  const globals = globalThis as unknown as Record<string, any>;
  if (typeof globals.fetch === 'function') {
    targets.push({ holder: globals, key: 'fetch', capability: 'NETWORK_ACCESS', label: 'fetch' });
  }

  return targets;
}

/** Names of the ambient entry points the guard currently watches. */
export function interceptedSurface(): ReadonlyArray<string> {
  return Object.freeze(interceptTargets().map(target => target.label).sort());
}

/**
 * Schedulers a validator could use to move work past the boundary.
 *
 * While the boundary is installed these record the attempt and decline to
 * schedule, so the deferred callback never runs at all — it cannot execute
 * unguarded after the entry points are restored.
 */
function schedulerTargets(): InterceptTarget[] {
  const targets: InterceptTarget[] = [];
  const globals = globalThis as unknown as Record<string, any>;

  for (const key of ['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask']) {
    if (typeof globals[key] === 'function') {
      targets.push({ holder: globals, key, capability: 'PROCESS_EXECUTION', label: key });
    }
  }
  if (typeof process === 'object' && typeof (process as any).nextTick === 'function') {
    targets.push({
      holder: process as unknown as Record<string, any>,
      key: 'nextTick',
      capability: 'PROCESS_EXECUTION',
      label: 'process.nextTick',
    });
  }

  return targets;
}

/** Names of the schedulers the guard blocks for a SYNC_ONLY validator. */
export function blockedSchedulers(): ReadonlyArray<string> {
  return Object.freeze(schedulerTargets().map(target => target.label).sort());
}

function isThenable(value: unknown): boolean {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

export interface CapabilityBoundaryResult<T> {
  readonly value?: T;
  readonly error?: unknown;
  readonly attempts: ReadonlyArray<CapabilityAttempt>;
  /** Schedulers the validator called while the boundary was installed. */
  readonly scheduled: ReadonlyArray<string>;
}

/**
 * Runs `body` with every intercepted entry point replaced, then restores them.
 *
 * Restoration happens in a finally block so a throwing validator cannot leave
 * the process with a crippled `fs`. The body must be synchronous: interception
 * is process-wide while installed, and holding it across an await would apply
 * it to unrelated work.
 */
export function withCapabilityBoundary<T>(
  validatorName: string,
  policy: ValidatorCapabilityPolicy,
  body: () => T,
  options: { readonly blockSchedulers?: boolean } = {},
): CapabilityBoundaryResult<T> {
  const attempts: CapabilityAttempt[] = [];
  const scheduled: string[] = [];

  const targets = interceptTargets();
  const originals = targets.map(target => target.holder[target.key]);
  const schedulers = options.blockSchedulers === false ? [] : schedulerTargets();
  const schedulerOriginals = schedulers.map(target => target.holder[target.key]);

  targets.forEach(target => {
    if (policyAllows(policy, target.capability)) return;
    target.holder[target.key] = (...args: unknown[]) => {
      attempts.push({ capability: target.capability, detail: target.label });
      throw new CapabilityViolationError(
        validatorName,
        target.capability,
        policy.allowed,
        `${target.label}(${args.length} arg(s))`,
      );
    };
  });

  schedulers.forEach(target => {
    target.holder[target.key] = (..._args: unknown[]) => {
      scheduled.push(target.label);
      // A no-op handle: the callback is never queued, so it cannot run after
      // the boundary comes down.
      return { unref: () => undefined, ref: () => undefined } as unknown;
    };
  });

  try {
    const value = body();
    return { value, attempts: Object.freeze([...attempts]), scheduled: Object.freeze([...scheduled]) };
  } catch (error) {
    return { error, attempts: Object.freeze([...attempts]), scheduled: Object.freeze([...scheduled]) };
  } finally {
    // Restoration is unconditional: a validation failure, a thrown validator,
    // and a detected async escape all land here before anything is reported.
    targets.forEach((target, index) => {
      target.holder[target.key] = originals[index];
    });
    schedulers.forEach((target, index) => {
      target.holder[target.key] = schedulerOriginals[index];
    });
  }
}

function violationOutcome(
  validator: string,
  requested: ValidatorCapability,
  allowed: ReadonlyArray<ValidatorCapability>,
  detail: string,
): InternalValidationOutcome {
  return createValidationOutcome({
    validator,
    status: 'REJECT',
    reasonCode: 'VALIDATOR_CAPABILITY_VIOLATION',
    issues: [`validator attempted ${requested} via ${detail} without declaring it`],
    message: `VALIDATOR_CAPABILITY_VIOLATION: ${validator} attempted ${requested} via ${detail}`,
    metadata: {
      validator,
      requestedCapability: requested,
      allowedCapabilities: Object.freeze([...allowed]),
      attemptedVia: detail,
    },
  });
}

interface AsyncEscape {
  readonly kind: 'PROMISE_RETURNED' | 'WORK_SCHEDULED';
  readonly issue: string;
}

/**
 * Whether a SYNC_ONLY validator tried to keep working past its own return.
 *
 * Scheduling is reported ahead of a promise return because it is the more
 * specific finding: a validator that queued a callback names the scheduler it
 * used, while a promise only says the body did not finish.
 */
function describeAsyncEscape(result: CapabilityBoundaryResult<unknown>): AsyncEscape | undefined {
  if (result.scheduled.length > 0) {
    const unique = Array.from(new Set(result.scheduled));
    return {
      kind: 'WORK_SCHEDULED',
      issue: `validator declared SYNC_ONLY but scheduled asynchronous work via ${unique.join(', ')}`,
    };
  }
  if (isThenable(result.value)) {
    return {
      kind: 'PROMISE_RETURNED',
      issue: 'validator declared SYNC_ONLY but returned a promise or thenable',
    };
  }
  return undefined;
}

export interface CapabilityGuardResult {
  readonly outcome: InternalValidationOutcome;
  /** True when the validator body ran to completion without a violation. */
  readonly executed: boolean;
  readonly policy: ValidatorCapabilityPolicy;
}

/**
 * Validates the declared capability list, builds the restricted context, and
 * executes the validator inside the capability boundary.
 */
export function executeWithCapabilityGuard(
  validator: ValidatorContract,
  request: InternalValidationRequest,
): CapabilityGuardResult {
  const declaration = checkCapabilityDeclaration(validator.capabilities);
  const policy = declaration.valid
    ? capabilityPolicyFor(validator.capabilities as ReadonlyArray<ValidatorCapability>)
    : capabilityPolicyFor([]);

  if (!declaration.valid) {
    const requested = (declaration.forbiddenCapabilities[0] ??
      declaration.unknownCapabilities[0] ??
      'WRITE_NONE') as ValidatorCapability;
    return {
      executed: false,
      policy,
      outcome: createValidationOutcome({
        validator: validator.name,
        status: 'REJECT',
        reasonCode: 'VALIDATOR_CAPABILITY_VIOLATION',
        issues: declaration.violations,
        message: `VALIDATOR_CAPABILITY_VIOLATION: ${declaration.violations.join('; ')}`,
        metadata: {
          validator: validator.name,
          requestedCapability: requested,
          allowedCapabilities: Object.freeze([]),
          unknownCapabilities: declaration.unknownCapabilities,
          forbiddenCapabilities: declaration.forbiddenCapabilities,
        },
      }),
    };
  }

  const contextViolations: CapabilityAttempt[] = [];
  const capabilityContext: ValidatorCapabilityContext = createValidatorCapabilityContext({
    validator: validator.name,
    metadata: describeValidator(validator),
    policy,
    request,
    onViolation: (capability, detail) => contextViolations.push({ capability, detail }),
  });

  const syncOnly = validator.executionMode === 'SYNC_ONLY';
  const result = withCapabilityBoundary(
    validator.name,
    policy,
    () => validator.validate(request, capabilityContext),
    { blockSchedulers: syncOnly },
  );

  if (syncOnly) {
    const escape = describeAsyncEscape(result);
    if (escape) {
      // The returned value is discarded, but a rejected promise still needs an
      // owner or Node reports an unhandled rejection for work we refused.
      if (isThenable(result.value)) {
        void Promise.resolve(result.value as unknown as PromiseLike<unknown>).then(
          () => undefined,
          () => undefined,
        );
      }
      return {
        executed: false,
        policy,
        outcome: createValidationOutcome({
          validator: validator.name,
          status: 'REJECT',
          reasonCode: 'VALIDATOR_ASYNC_ESCAPE',
          issues: [escape.issue],
          message: `VALIDATOR_ASYNC_ESCAPE: ${escape.issue}`,
          metadata: {
            validator: validator.name,
            executionMode: validator.executionMode,
            escapeKind: escape.kind,
            scheduledCalls: Object.freeze([...result.scheduled]),
          },
        }),
      };
    }
  }

  const attempts = [...result.attempts, ...contextViolations];
  if (attempts.length > 0) {
    const first = attempts[0];
    return {
      executed: false,
      policy,
      outcome: violationOutcome(validator.name, first.capability, policy.allowed, first.detail),
    };
  }

  if (result.error !== undefined) {
    if (result.error instanceof CapabilityViolationError) {
      return {
        executed: false,
        policy,
        outcome: violationOutcome(
          validator.name,
          result.error.requestedCapability,
          policy.allowed,
          result.error.message,
        ),
      };
    }
    throw result.error;
  }

  return { executed: true, policy, outcome: result.value as InternalValidationOutcome };
}
