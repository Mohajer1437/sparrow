import { HeuristicProductValidator } from '../../../src/core/vv/heuristic-product-validator';
import {
  formatProductAnalysis,
  shouldAbortForProductCheckpoint,
} from '../../../src/domain/product-analysis';

describe('HeuristicProductValidator', () => {
  const validator = new HeuristicProductValidator();

  it('does not block inferable file-scope ambiguity', async () => {
    const analysis = await validator.analyze({
      task: 'Add a settings toggle for dark mode on the existing settings page',
      qualityProfile: 'PRODUCTION',
      intakeAmbiguities: ['No specific file mentioned for modification task'],
    });
    expect(analysis.blockingQuestions).toEqual([]);
    expect(analysis.assumptions.some(a => /No specific file/i.test(a))).toBe(true);
    expect(analysis.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(analysis.ambiguities.some(item => item.classification === 'SAFE_ASSUMPTION')).toBe(true);
  });

  it('blocks material auth ambiguity in PRODUCTION', async () => {
    const analysis = await validator.analyze({
      task: 'Add login so users can access the dashboard',
      qualityProfile: 'PRODUCTION',
    });
    expect(analysis.blockingQuestions.length).toBeGreaterThan(0);
    expect(analysis.materialAmbiguities).toContain('auth-mechanism');
    expect(analysis.checkpointQuestions[0].question).not.toMatch(/what files should i change/i);
    expect(analysis.checkpointQuestions[0].options?.length).toBeGreaterThan(1);
  });

  it('does not block the same auth task in MVP', async () => {
    const analysis = await validator.analyze({
      task: 'Add login so users can access the dashboard',
      qualityProfile: 'MVP',
    });
    expect(analysis.blockingQuestions).toEqual([]);
  });

  it('does not block negated payment or auth constraints', async () => {
    const analysis = await validator.analyze({
      task: 'Add a footer on app/page.tsx with the exact visible text Sandbox verification marker. Do not add authentication, payment, new routes, or unrelated files.',
      qualityProfile: 'STANDARD',
    });
    expect(analysis.blockingQuestions).toEqual([]);
    expect(analysis.materialAmbiguities).toEqual([]);
  });

  it('extracts explicit goal, actors, outcomes, and constraints', async () => {
    const analysis = await validator.analyze({
      task: 'Allow teachers to create assignments for their classes. Do not add authentication. Keep existing Persian layout.',
      qualityProfile: 'STANDARD',
    });
    expect(analysis.intent.userGoal).toMatch(/teachers/i);
    expect(analysis.intent.actors).toContain('teacher');
    expect(analysis.intent.importantConstraints.some(item => /Do not add authentication/i.test(item))).toBe(true);
    expect(analysis.intent.importantConstraints.some(item => /Keep existing Persian layout/i.test(item))).toBe(true);
    expect(analysis.intent.expectedOutcomes.length).toBeGreaterThan(0);
    expect(analysis.blockingQuestions).toEqual([]);
  });

  it('generates Given/When/Then acceptance criteria from explicit UI observables', async () => {
    const analysis = await validator.analyze({
      task: 'On app/page.tsx add data-testid=sandbox-p21-status with exact visible text Product QA ready. Do not add authentication.',
      qualityProfile: 'PRODUCTION',
    });
    expect(analysis.acceptanceCriteria.some(item => /data-testid="sandbox-p21-status"/i.test(item))).toBe(true);
    expect(analysis.acceptanceCriteria.some(item => /exact visible text Product QA ready/i.test(item))).toBe(true);
    expect(analysis.acceptanceCriteria.some(item => /Given .* when .* then/i.test(item))).toBe(true);
    expect(analysis.acceptanceCriteria.some(item => /12 characters|two-factor|2FA|email verification/i.test(item))).toBe(false);
  });

  it('emits acceptance criteria for every named test id and exact text', async () => {
    const analysis = await validator.analyze({
      task: 'In app/page.tsx keep data-testid=sandbox-vv-footer with exact visible text Sandbox VnV repair marker and add data-testid=sandbox-p21-status with exact visible text Product QA ready. Do not add authentication.',
      qualityProfile: 'PRODUCTION',
    });
    expect(analysis.acceptanceCriteria.some(item => /sandbox-vv-footer/i.test(item))).toBe(true);
    expect(analysis.acceptanceCriteria.some(item => /sandbox-p21-status/i.test(item))).toBe(true);
    expect(analysis.acceptanceCriteria.some(item => /Sandbox VnV repair marker/i.test(item))).toBe(true);
    expect(analysis.acceptanceCriteria.some(item => /Product QA ready/i.test(item))).toBe(true);
    expect(analysis.intent.requestedCapabilities.some(item => /authentication/i.test(item))).toBe(false);
  });

  it('does not invent registration password or 2FA requirements', async () => {
    const analysis = await validator.analyze({
      task: 'Create a registration page.',
      qualityProfile: 'PRODUCTION',
    });
    const blob = JSON.stringify(analysis);
    expect(blob).not.toMatch(/12 characters/);
    expect(blob).not.toMatch(/two-factor|2FA/i);
    expect(blob).not.toMatch(/email verification/i);
  });

  it('classifies unspecified ownership as BLOCKING and collects a precise question', async () => {
    const analysis = await validator.analyze({
      task: 'On app/page.tsx add a teachers assignment editor so teachers can edit assignments.',
      qualityProfile: 'PRODUCTION',
    });
    expect(analysis.materialAmbiguities).toContain('ownership');
    expect(analysis.ambiguities.some(item => item.id === 'ownership' && item.classification === 'BLOCKING')).toBe(true);
    expect(analysis.blockingQuestions.length).toBeGreaterThan(0);
    expect(analysis.checkpointQuestions[0].question).toMatch(/owner/i);
    expect(analysis.checkpointQuestions[0].question).not.toMatch(/what do you want/i);
    expect(analysis.checkpointQuestions[0].options).toEqual([
      'Only the owner can edit',
      'Any teacher can edit any assignment',
    ]);
    expect(shouldAbortForProductCheckpoint(analysis, false)).toBe(true);
    expect(shouldAbortForProductCheckpoint(analysis, true)).toBe(false);
  });

  it('records a SAFE_ASSUMPTION with reason, confidence, and impact', async () => {
    const analysis = await validator.analyze({
      task: 'On app/page.tsx add data-testid=sandbox-p21-assumed with exact visible text Assumed ready. Do not add authentication.',
      qualityProfile: 'PRODUCTION',
      intakeAmbiguities: ['No specific file mentioned for modification task'],
    });
    expect(analysis.blockingQuestions).toEqual([]);
    const assumed = analysis.structuredAssumptions.find(item => /file-scope|App Router|data-testid/i.test(item.statement + item.reason));
    expect(assumed).toBeDefined();
    expect(assumed!.reason.length).toBeGreaterThan(5);
    expect(assumed!.confidence).toBe('HIGH');
    expect(assumed!.impact).toBe('Low');
  });

  it('records NON_BLOCKING ambiguity for unspecified success-feedback channel', async () => {
    const analysis = await validator.analyze({
      task: 'On app/page.tsx show success feedback after save. Do not add authentication.',
      qualityProfile: 'STANDARD',
    });
    expect(analysis.blockingQuestions).toEqual([]);
    expect(analysis.ambiguities.some(item => item.classification === 'NON_BLOCKING' && /success feedback/i.test(item.text))).toBe(true);
  });

  it('folds resolved ownership answers into the intent contract instead of blocking', async () => {
    const analysis = await validator.analyze({
      task: 'On app/page.tsx add a teachers assignment editor so teachers can edit assignments.',
      qualityProfile: 'PRODUCTION',
      resolvedAnswers: [{ question: 'ownership', answer: 'Only the owner can edit' }],
    });
    expect(analysis.blockingQuestions).toEqual([]);
    expect(analysis.acceptanceCriteria.some(item => /owner/i.test(item))).toBe(true);
    expect(analysis.structuredAssumptions.some(item => /Only the owner can edit/i.test(item.statement))).toBe(true);
  });

  it('collects every blocking question in one checkpoint', async () => {
    const analysis = await validator.analyze({
      task: 'Add login so users can access the dashboard and add checkout billing without naming a provider.',
      qualityProfile: 'PRODUCTION',
    });
    expect(analysis.checkpointQuestions.length).toBeGreaterThanOrEqual(2);
    expect(analysis.checkpointQuestions.every(item => item.question.length > 20)).toBe(true);
    expect(analysis.checkpointQuestions.some(item => /files should i change/i.test(item.question))).toBe(false);
  });

  it('assigns product risk categories and severity', async () => {
    const analysis = await validator.analyze({
      task: 'Delete account for the authenticated user after confirmation. Keep existing cookie session.',
      qualityProfile: 'PRODUCTION',
    });
    expect(analysis.structuredRisks.some(item => item.category === 'Destructive Behavior' && item.severity === 'HIGH')).toBe(true);
    expect(analysis.risks.some(item => /Destructive Behavior/i.test(item))).toBe(true);
  });

  it('derives verification requirements from intent rather than a global list', async () => {
    const ui = await validator.analyze({
      task: 'On app/page.tsx add data-testid=sandbox-p21-status with exact visible text Ready. Do not add authentication.',
      qualityProfile: 'STANDARD',
    });
    expect(ui.verificationRequirements).toContain('browser');
    expect(ui.verificationRequirements).not.toContain('authorization-boundary');

    const api = await validator.analyze({
      task: 'POST /api/save must succeed only for authenticated users. Unauthenticated POST /api/save must return 401 or 403.',
      qualityProfile: 'PRODUCTION',
    });
    expect(api.verificationRequirements).toContain('api');
    expect(api.verificationRequirements).toContain('authorization-boundary');
    expect(api.verificationRequirements).toContain('intent-contract');
  });

  it('changes behavior across MVP, STANDARD, and PRODUCTION', async () => {
    const task = 'On app/page.tsx add a teachers assignment editor so teachers can edit assignments.';
    const mvp = await validator.analyze({ task, qualityProfile: 'MVP' });
    const standard = await validator.analyze({ task, qualityProfile: 'STANDARD' });
    const production = await validator.analyze({ task, qualityProfile: 'PRODUCTION' });
    expect(mvp.blockingQuestions).toEqual([]);
    expect(standard.blockingQuestions.length).toBeGreaterThan(0);
    expect(production.blockingQuestions.length).toBeGreaterThan(0);
    expect(production.acceptanceCriteria.length).toBeGreaterThan(mvp.acceptanceCriteria.length);
    expect(production.structuredRisks.length).toBeGreaterThan(mvp.structuredRisks.length);
    expect(mvp.verificationRequirements).not.toContain('adversarial');
  });

  it('serializes the contract for Planner handoff without dropping criteria, constraints, or assumptions', async () => {
    const analysis = await validator.analyze({
      task: 'Allow teachers to create assignments for their classes. Do not add authentication. Keep existing Persian layout.',
      qualityProfile: 'PRODUCTION',
      intakeAmbiguities: ['No specific file mentioned for modification task'],
    });
    const formatted = formatProductAnalysis(analysis);
    expect(formatted).toMatch(/USER GOAL:/);
    expect(formatted).toMatch(/ACCEPTANCE CRITERIA:/);
    expect(formatted).toMatch(/EXPLICIT CONSTRAINTS:/);
    expect(formatted).toMatch(/Do not add authentication/i);
    expect(formatted).toMatch(/RESOLVED ASSUMPTIONS:/);
    expect(formatted).toMatch(/VERIFICATION REQUIREMENTS:/);
    expect(formatted).toMatch(/confidence: HIGH/);
  });
});
