import {
  InternalValidationOutcome,
  InternalValidationRequest,
  ValidatorContract,
  createValidationOutcome,
} from '../../domain/internal-validation';
import { executeWithCapabilityGuard } from './validator-capability-guard';

/**
 * Runtime enforcement of the guarantees a validator contract declares.
 *
 * Registration checks what a contract *claims*. This guard checks what the
 * validator *does*: that a validator declaring determinism answers the same way
 * twice, that one declaring mutationPolicy NONE leaves its request and its own
 * metadata alone, and that one declaring INTERNAL_VALIDATION_ONLY isolation
 * carries no pipeline dependency it could reach for.
 *
 * A violation ends the run. The guard never repairs a validator's answer and
 * never lets a suspect outcome through.
 */

/**
 * Names a validator must not be able to reach under INTERNAL_VALIDATION_ONLY.
 * `context` is absent on purpose: the request carries read-only context paths,
 * which are reasoning material and not an execution dependency.
 */
export const FORBIDDEN_EXECUTION_DEPENDENCIES: ReadonlyArray<string> = Object.freeze([
  'planner',
  'taskPlanner',
  'provider',
  'providerRegistry',
  'llm',
  'model',
  'executor',
  'taskExecutor',
  'patchExecutor',
  'commandExecutor',
  'reviewer',
  'verification',
  'verifier',
  'git',
  'gitManager',
  'fs',
  'filesystem',
  'fileSystem',
  'fileWriter',
  'workspace',
  'taskContext',
  'orchestrator',
  'toolRegistry',
]);

export interface ContractGuardDependencies {
  /** Named pipeline dependencies the caller believes are in scope. */
  readonly injected?: Readonly<Record<string, unknown>>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/** Structural clone that keeps the guard independent of the caller's objects. */
function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(entry => clone(entry)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = clone(entry);
  }
  return out as T;
}

function snapshot(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Every path at which `after` diverges from `before`, in dotted form. */
function diffPaths(before: unknown, after: unknown, path: string, found: string[]): void {
  if (before === after) return;

  const bothArrays = Array.isArray(before) && Array.isArray(after);
  if (bothArrays) {
    const longest = Math.max(before.length, after.length);
    if (before.length !== after.length) found.push(`${path}.length`);
    for (let index = 0; index < longest; index += 1) {
      diffPaths(before[index], after[index], `${path}[${index}]`, found);
    }
    return;
  }

  if (isPlainRecord(before) && isPlainRecord(after) && !Array.isArray(before) && !Array.isArray(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      diffPaths(before[key], after[key], path ? `${path}.${key}` : key, found);
    }
    return;
  }

  if (snapshot(before) !== snapshot(after)) found.push(path);
}

function contractMetadata(contract: ValidatorContract): Record<string, unknown> {
  return {
    name: contract.name,
    type: contract.type,
    deterministic: contract.deterministic,
    mutationPolicy: contract.mutationPolicy,
    isolation: contract.isolation,
    inputSchema: {
      requiredFields: [...contract.inputSchema.requiredFields],
      requiredAnyOf: contract.inputSchema.requiredAnyOf ? [...contract.inputSchema.requiredAnyOf] : undefined,
      optionalFields: contract.inputSchema.optionalFields ? [...contract.inputSchema.optionalFields] : undefined,
      description: contract.inputSchema.description,
    },
    // Not part of the declared contract, but a validator that carries ad-hoc
    // state is exactly what mutationPolicy NONE forbids.
    metadata: (contract as unknown as Record<string, unknown>).metadata,
  };
}

/** Names on the validator or request that the isolation contract forbids. */
function findForbiddenDependencies(
  validator: ValidatorContract,
  request: InternalValidationRequest,
  dependencies?: ContractGuardDependencies,
): string[] {
  const found: string[] = [];
  const carrier = validator as unknown as Record<string, unknown>;

  for (const name of FORBIDDEN_EXECUTION_DEPENDENCIES) {
    if (carrier[name] !== undefined) found.push(`validator.${name}`);
  }

  const payload = request as unknown as Record<string, unknown>;
  for (const name of FORBIDDEN_EXECUTION_DEPENDENCIES) {
    if (payload[name] !== undefined) found.push(`request.${name}`);
  }

  for (const [name, value] of Object.entries(dependencies?.injected ?? {})) {
    if (value !== undefined) found.push(`injected.${name}`);
  }

  return found;
}

/** Fields that decide whether two runs of a deterministic validator agree. */
function normalizeOutcome(outcome: InternalValidationOutcome): Record<string, unknown> {
  return {
    status: outcome.status,
    reasonCode: outcome.reasonCode ?? null,
    message: outcome.message ?? null,
    rejectedTargets: [...outcome.rejectedTargets],
    issues: [...outcome.issues],
    details: outcome.details ?? null,
    metadata: outcome.metadata ?? null,
  };
}

export interface ContractGuardResult {
  readonly outcome: InternalValidationOutcome;
  /** How many times the validator body actually ran. */
  readonly executions: number;
}

/**
 * Runs a validator under its own declared contract and reports both the outcome
 * and how many times the body ran, so callers can assert on the guard itself.
 */
export function runWithContractGuard(
  validator: ValidatorContract,
  request: InternalValidationRequest,
  dependencies?: ContractGuardDependencies,
): ContractGuardResult {
  // C) Isolation, checked before the body runs so a validator holding a
  // pipeline dependency never gets the chance to use it.
  if (validator.isolation === 'INTERNAL_VALIDATION_ONLY') {
    const forbidden = findForbiddenDependencies(validator, request, dependencies);
    if (forbidden.length > 0) {
      return {
        executions: 0,
        outcome: createValidationOutcome({
          validator: validator.name,
          status: 'REJECT',
          reasonCode: 'VALIDATOR_ISOLATION_VIOLATION',
          issues: forbidden.map(name => `forbidden execution dependency in scope: ${name}`),
          message: `VALIDATOR_ISOLATION_VIOLATION: ${forbidden.join(', ')}`,
          metadata: { validator: validator.name, forbiddenDependencies: Object.freeze([...forbidden]) },
        }),
      };
    }
  }

  const enforceMutationPolicy = validator.mutationPolicy === 'NONE';
  const contractBefore = contractMetadata(validator);

  // The validator never sees the caller's request. It gets a private clone, so
  // an attempted mutation is observable here and harmless to everyone else.
  const firstRequest = clone(request) as InternalValidationRequest;
  const requestBefore = clone(request);

  let first: InternalValidationOutcome;
  let executions = 0;
  try {
    executions += 1;
    const guarded = executeWithCapabilityGuard(validator, firstRequest);
    if (!guarded.executed) {
      return { executions, outcome: guarded.outcome };
    }
    first = guarded.outcome;
  } catch (error: any) {
    return {
      executions,
      outcome: createValidationOutcome({
        validator: validator.name,
        status: 'ERROR',
        reasonCode: 'VALIDATOR_EXECUTION_ERROR',
        issues: [`validator threw during execution: ${error?.message ?? String(error)}`],
        message: `VALIDATOR_EXECUTION_ERROR: ${error?.message ?? String(error)}`,
      }),
    };
  }

  // B) Mutation policy, checked before a second run so a mutating validator is
  // named for what it did rather than for the drift it causes downstream.
  if (enforceMutationPolicy) {
    const mutatedPaths: string[] = [];
    diffPaths(requestBefore, firstRequest, 'request', mutatedPaths);
    diffPaths(contractBefore, contractMetadata(validator), 'contract', mutatedPaths);

    if (mutatedPaths.length > 0) {
      return {
        executions,
        outcome: createValidationOutcome({
          validator: validator.name,
          status: 'REJECT',
          reasonCode: 'VALIDATOR_MUTATION_VIOLATION',
          issues: mutatedPaths.map(path => `validator mutated ${path} despite mutationPolicy NONE`),
          message: `VALIDATOR_MUTATION_VIOLATION: ${mutatedPaths.join(', ')}`,
          metadata: { validator: validator.name, mutatedPaths: Object.freeze([...mutatedPaths]) },
        }),
      };
    }
  }

  if (!validator.deterministic) {
    return { executions, outcome: first };
  }

  // A) Determinism, from a second run over an identical private clone.
  let second: InternalValidationOutcome;
  try {
    executions += 1;
    const guarded = executeWithCapabilityGuard(validator, clone(request) as InternalValidationRequest);
    if (!guarded.executed) {
      return { executions, outcome: guarded.outcome };
    }
    second = guarded.outcome;
  } catch (error: any) {
    return {
      executions,
      outcome: createValidationOutcome({
        validator: validator.name,
        status: 'ERROR',
        reasonCode: 'VALIDATOR_EXECUTION_ERROR',
        issues: [`validator threw on its second execution: ${error?.message ?? String(error)}`],
        message: `VALIDATOR_EXECUTION_ERROR: ${error?.message ?? String(error)}`,
      }),
    };
  }

  const firstNormalized = normalizeOutcome(first);
  const secondNormalized = normalizeOutcome(second);
  if (snapshot(firstNormalized) !== snapshot(secondNormalized)) {
    const divergentPaths: string[] = [];
    diffPaths(firstNormalized, secondNormalized, '', divergentPaths);
    return {
      executions,
      outcome: createValidationOutcome({
        validator: validator.name,
        status: 'REJECT',
        reasonCode: 'VALIDATOR_NON_DETERMINISTIC',
        issues: [`validator declared deterministic but diverged at: ${divergentPaths.join(', ')}`],
        message: `VALIDATOR_NON_DETERMINISTIC: ${validator.name} produced different results for identical input`,
        metadata: {
          validator: validator.name,
          firstResult: Object.freeze(firstNormalized),
          secondResult: Object.freeze(secondNormalized),
          divergentPaths: Object.freeze(divergentPaths),
        },
      }),
    };
  }

  return { executions, outcome: first };
}

/** Contract-guarded execution of a validator. */
export function validateWithContractGuard(
  validator: ValidatorContract,
  request: InternalValidationRequest,
  dependencies?: ContractGuardDependencies,
): InternalValidationOutcome {
  return runWithContractGuard(validator, request, dependencies).outcome;
}
