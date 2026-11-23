import { parseInternalValidationCommand } from '../../../src/core/validation/internal-validation-parser';
import { internalValidationRunner } from '../../../src/core/validation/internal-validation-runner';
import { resolveValidator } from '../../../src/core/validation/validation-registry';
import { isInternalValidationDirective } from '../../../src/domain/execution-mode';

const COMMAND = 'INTERNAL_VALIDATION validator=PlannerAllowedTargetsValidator input={"files":["package.json","server/src/auth/tokens.ts"],"affectedFiles":["types/domain.ts"],"authority":["package.json"]}';

describe('Internal validation directive parser', () => {
  it('parses a valid validator and input payload', () => {
    const parsed = parseInternalValidationCommand(
      'INTERNAL_VALIDATION validator=PlannerAllowedTargetsValidator input={"files":["package.json"],"affectedFiles":["types/domain.ts"],"authority":["package.json"]}',
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.request?.validator).toBe('PlannerAllowedTargetsValidator');
    expect(parsed.request?.input).toEqual({
      files: ['package.json'],
      affectedFiles: ['types/domain.ts'],
      authority: ['package.json'],
    });
    expect(parsed.request?.authority).toEqual(['package.json']);
  });

  it('resolves the registered validator from the suffixed name', () => {
    expect(resolveValidator('PlannerAllowedTargetsValidator')?.name).toBe('PlannerAllowedTargets');
  });

  it('returns INVALID_VALIDATION_REQUEST when the validator is missing', () => {
    const parsed = parseInternalValidationCommand('INTERNAL_VALIDATION input={"files":["package.json"]}');
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('INVALID_VALIDATION_REQUEST');
    expect(parsed.error).toContain('missing validator');
  });

  it('returns INVALID_VALIDATION_REQUEST when the input is missing', () => {
    const parsed = parseInternalValidationCommand('INTERNAL_VALIDATION validator=PlannerAllowedTargetsValidator');
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('missing input');
  });

  it('returns INVALID_VALIDATION_REQUEST for malformed JSON input', () => {
    const unbalanced = parseInternalValidationCommand(
      'INTERNAL_VALIDATION validator=PlannerAllowedTargetsValidator input={"files":["package.json"]',
    );
    expect(unbalanced.ok).toBe(false);
    expect(unbalanced.error).toContain('malformed input');

    const notJson = parseInternalValidationCommand(
      'INTERNAL_VALIDATION validator=PlannerAllowedTargetsValidator input={files: package.json}',
    );
    expect(notJson.ok).toBe(false);
    expect(notJson.error).toContain('malformed input');
  });

  it('carries a malicious payload through to the validator unchanged', () => {
    expect(isInternalValidationDirective(COMMAND)).toBe(true);

    const parsed = parseInternalValidationCommand(COMMAND);
    expect(parsed.ok).toBe(true);
    expect(parsed.request?.input).toEqual({
      files: ['package.json', 'server/src/auth/tokens.ts'],
      affectedFiles: ['types/domain.ts'],
      authority: ['package.json'],
    });

    const outcome = internalValidationRunner.run(parsed.request!);
    expect(outcome.result).toBe('REJECT');
    expect(outcome.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
    expect(outcome.rejectedTargets).toEqual([
      'server/src/auth/tokens.ts',
      'types/domain.ts',
    ]);
  });

  it('does not mutate the parsed input object', () => {
    const parsed = parseInternalValidationCommand(COMMAND);
    const before = JSON.stringify(parsed.request?.input);

    internalValidationRunner.run(parsed.request!);

    expect(JSON.stringify(parsed.request?.input)).toBe(before);
    expect((parsed.request?.input as any).files).toEqual([
      'package.json',
      'server/src/auth/tokens.ts',
    ]);
  });

  it('lets a top-level authority assignment override the payload field', () => {
    const parsed = parseInternalValidationCommand(
      'INTERNAL_VALIDATION validator=PlannerAllowedTargets input={"files":["types/domain.ts"],"authority":["types/domain.ts"]} authority=["package.json"]',
    );

    expect(parsed.request?.authority).toEqual(['package.json']);
    expect(internalValidationRunner.run(parsed.request!).result).toBe('REJECT');
  });
});
