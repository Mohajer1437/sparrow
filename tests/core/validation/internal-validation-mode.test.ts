import {
  EXECUTION_MODES,
  allowsGitMutation,
  evaluateToolAgainstMode,
  isExecutionMode,
  isInternalValidationDirective,
  resolveAuthoritativeExecutionMode,
} from '../../../src/domain/execution-mode';
import { InternalValidationRequest } from '../../../src/domain/internal-validation';
import { internalValidationRunner } from '../../../src/core/validation/internal-validation-runner';
import {
  registeredValidatorNames,
  resolveValidator,
} from '../../../src/core/validation/validation-registry';
import { resolveValidationTargets } from '../../../src/core/validation/validation-target-resolver';

const ATTACK_REQUEST: InternalValidationRequest = {
  validator: 'PlannerAllowedTargets',
  input: {
    goal: 'authority boundary attack',
    files: ['package.json', 'server/src/auth/tokens.ts'],
    affectedFiles: ['types/domain.ts'],
    contextReferences: ['.ai/backend.md'],
  },
  authority: ['package.json'],
  context: ['server/src/auth/tokens.ts', 'types/domain.ts'],
};

describe('Execution mode: INTERNAL_VALIDATION', () => {
  it('registers the new mode while keeping existing modes intact', () => {
    expect(EXECUTION_MODES).toEqual(['STANDARD', 'READ_ONLY', 'INTERNAL_VALIDATION']);
    expect(isExecutionMode('INTERNAL_VALIDATION')).toBe(true);
    expect(isExecutionMode('STANDARD')).toBe(true);
    expect(isExecutionMode('READ_ONLY')).toBe(true);
  });

  it('detects internal validation intent deterministically', () => {
    const positives = [
      'INTERNAL UNIT VALIDATION RUN',
      'Do not run full pipeline',
      'Call only: PlannerAllowedTargets',
      'Directly call validation boundary',
      'Do NOT invoke Planner',
      'Do NOT invoke LLM',
    ];
    for (const text of positives) {
      expect(isInternalValidationDirective(text)).toBe(true);
      expect(resolveAuthoritativeExecutionMode({ task: text }).mode).toBe('INTERNAL_VALIDATION');
    }

    expect(isInternalValidationDirective('Add a login page')).toBe(false);
    expect(isInternalValidationDirective(undefined)).toBe(false);
  });

  it('is deterministic across repeated detection', () => {
    const task = 'INTERNAL UNIT VALIDATION RUN. Do not run full pipeline.';
    const results = Array.from({ length: 5 }, () => resolveAuthoritativeExecutionMode({ task }).mode);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe('INTERNAL_VALIDATION');
  });

  it('Case C: STANDARD and READ_ONLY behavior is unchanged', () => {
    expect(resolveAuthoritativeExecutionMode({}).mode).toBe('STANDARD');
    expect(resolveAuthoritativeExecutionMode({ executionMode: 'STANDARD' }).mode).toBe('STANDARD');
    expect(resolveAuthoritativeExecutionMode({ executionMode: 'READ_ONLY' }).mode).toBe('READ_ONLY');
    expect(resolveAuthoritativeExecutionMode({ task: 'Do not modify any file' }).mode).toBe('READ_ONLY');

    expect(evaluateToolAgainstMode('STANDARD', 'write_file').allowed).toBe(true);
    expect(evaluateToolAgainstMode('READ_ONLY', 'write_file').allowed).toBe(false);
    expect(evaluateToolAgainstMode('READ_ONLY', 'read_file').allowed).toBe(true);
    expect(allowsGitMutation('STANDARD')).toBe(true);
    expect(allowsGitMutation('READ_ONLY')).toBe(false);
  });

  it('internal validation cannot mutate project state', () => {
    expect(evaluateToolAgainstMode('INTERNAL_VALIDATION', 'write_file').allowed).toBe(false);
    expect(allowsGitMutation('INTERNAL_VALIDATION')).toBe(false);
  });
});

describe('Validation registry', () => {
  it('resolves validators by name, case-insensitively', () => {
    expect(registeredValidatorNames()).toContain('PlannerAllowedTargets');
    expect(resolveValidator('PlannerAllowedTargets')?.name).toBe('PlannerAllowedTargets');
    expect(resolveValidator('plannerallowedtargets')?.name).toBe('PlannerAllowedTargets');
    expect(resolveValidator('NoSuchValidator')).toBeUndefined();
  });

  it('reports an unknown validator instead of falling back to the pipeline', () => {
    const outcome = internalValidationRunner.run({ validator: 'NoSuchValidator', input: {} });
    expect(outcome.result).toBe('ERROR');
    expect(outcome.reasonCode).toBe('UNKNOWN_VALIDATOR');
  });
});

describe('ValidationTargetResolver', () => {
  it('keeps declared execution targets separate from declared references', () => {
    const resolved = resolveValidationTargets(ATTACK_REQUEST);

    expect(resolved.declaredTargets).toEqual([
      'package.json',
      'server/src/auth/tokens.ts',
      'types/domain.ts',
    ]);
    expect(resolved.declaredReferences).toEqual(['.ai/backend.md']);
    expect(resolved.authority.isAllowed('package.json')).toBe(true);
    expect(resolved.authority.isAllowed('server/src/auth/tokens.ts')).toBe(false);
  });
});

describe('Case B: PlannerAllowedTargetsValidator rejection', () => {
  it('rejects unauthorized execution targets with exact rejected targets', () => {
    const outcome = internalValidationRunner.run(ATTACK_REQUEST);

    expect(outcome.result).toBe('REJECT');
    expect(outcome.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
    expect(outcome.rejectedTargets).toEqual([
      'server/src/auth/tokens.ts',
      'types/domain.ts',
    ]);
    expect(outcome.rejectedTargets).not.toContain('package.json');
    expect(outcome.rejectedTargets).not.toContain('.ai/backend.md');
  });

  it('reports validator-centric wording rather than planner wording', () => {
    const outcome = internalValidationRunner.run(ATTACK_REQUEST);

    expect(outcome.message).toContain('Validation target is not authorized by declared authority');
    expect(outcome.message).toContain('server/src/auth/tokens.ts');
    expect(outcome.message).toContain('types/domain.ts');
    expect(outcome.message).not.toContain('Planner referenced files');
    expect(outcome.message).not.toContain('workspace evidence');

    for (const issue of outcome.issues) {
      expect(issue).toContain('Validation target is not authorized by declared authority');
      expect(issue).not.toContain('Ungrounded target');
    }

    // Behavior is unchanged: only the wording moved.
    expect(outcome.result).toBe('REJECT');
    expect(outcome.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
  });

  it('does not repair, normalize, or silently drop unauthorized targets', () => {
    const outcome = internalValidationRunner.run(ATTACK_REQUEST);

    // The unauthorized targets are reported, not reclassified as context.
    for (const target of ['server/src/auth/tokens.ts', 'types/domain.ts']) {
      expect(outcome.rejectedTargets).toContain(target);
    }
    expect(outcome.issues).toHaveLength(2);

    // The request itself is untouched.
    expect((ATTACK_REQUEST.input as any).files).toEqual([
      'package.json',
      'server/src/auth/tokens.ts',
    ]);
    expect((ATTACK_REQUEST.input as any).affectedFiles).toEqual(['types/domain.ts']);
  });

  it('accepts a request whose execution targets are all authorized', () => {
    const outcome = internalValidationRunner.run({
      validator: 'PlannerAllowedTargets',
      input: {
        goal: 'authorized run',
        files: ['package.json'],
        affectedFiles: ['app/page.tsx'],
        contextReferences: ['.ai/backend.md', 'server/src/auth/tokens.ts'],
      },
      authority: ['package.json', 'app/page.tsx'],
      context: ['server/src/auth/tokens.ts'],
    });

    expect(outcome.result).toBe('ACCEPT');
    expect(outcome.rejectedTargets).toEqual([]);
    expect(outcome.reasonCode).toBeUndefined();
  });

  it('context visibility alone never authorizes an execution target', () => {
    const outcome = internalValidationRunner.run({
      validator: 'PlannerAllowedTargets',
      input: { files: ['server/src/auth/tokens.ts'] },
      authority: ['package.json'],
      context: ['server/src/auth/tokens.ts'],
    });

    expect(outcome.result).toBe('REJECT');
    expect(outcome.rejectedTargets).toEqual(['server/src/auth/tokens.ts']);
  });
});
