import { HeuristicProductValidator } from '../../../src/core/vv/heuristic-product-validator';
import {
  bindAcceptanceContract,
  evaluateAcceptanceContract,
  missingRequiredObservables,
  removedPreservedObservables,
  snapshotFromContents,
  toAcceptanceContract,
} from '../../../src/core/vv/acceptance-contract';
import { ExecutionPlan } from '../../../src/domain/execution-plan';

function plan(): ExecutionPlan {
  return Object.freeze({
    id: 'plan-1',
    objective: 'Add markers',
    complexity: 'simple',
    reasoning: 'test',
    steps: Object.freeze([
      Object.freeze({
        id: 'step-1',
        description: 'Modify app/page.tsx',
        type: 'modify' as const,
        requiredTools: Object.freeze(['apply_patch']),
        expectedOutcome: 'markers present',
        expectedFiles: Object.freeze(['app/page.tsx']),
      }),
    ]),
    affectedDomains: Object.freeze([]),
    validationStrategy: Object.freeze({
      requiredTests: Object.freeze([]),
      successCriteria: Object.freeze(['llm guessed this']),
    }),
    createdAt: new Date().toISOString(),
  });
}

describe('Acceptance Contract preservation', () => {
  const validator = new HeuristicProductValidator();

  it('derives required test ids and texts from Product QA without dropping any', async () => {
    const analysis = await validator.analyze({
      task: 'In app/page.tsx keep data-testid=sandbox-vv-footer with exact visible text Sandbox VnV repair marker and add data-testid=sandbox-p21-assumed with exact visible text Assumed ready. Do not add authentication.',
      qualityProfile: 'PRODUCTION',
    });
    const contract = toAcceptanceContract(analysis, 'In app/page.tsx keep data-testid=sandbox-vv-footer with exact visible text Sandbox VnV repair marker and add data-testid=sandbox-p21-assumed with exact visible text Assumed ready.');
    expect(contract?.requiredTestIds).toEqual(expect.arrayContaining(['sandbox-vv-footer', 'sandbox-p21-assumed']));
    expect(contract?.requiredExactTexts).toEqual(expect.arrayContaining(['Sandbox VnV repair marker', 'Assumed ready']));
    expect(contract?.criteria.length).toBeGreaterThan(1);
    expect(contract?.constraints.some(item => /Do not add authentication/i.test(item))).toBe(true);
  });

  it('keeps every keep-and-add observable when the prompt lists them with commas', async () => {
    const task = 'In app/page.tsx keep data-testid=sandbox-vv-footer with exact visible text Sandbox VnV repair marker, keep data-testid=sandbox-p21-status with exact visible text Product QA ready, and add data-testid=sandbox-p21-assumed with exact visible text Assumed ready. Do not add authentication.';
    const analysis = await validator.analyze({ task, qualityProfile: 'PRODUCTION' });
    const contract = toAcceptanceContract(analysis, task);
    expect(contract?.requiredTestIds).toEqual(expect.arrayContaining([
      'sandbox-vv-footer',
      'sandbox-p21-status',
      'sandbox-p21-assumed',
    ]));
    expect(contract?.requiredExactTexts).toEqual(expect.arrayContaining([
      'Sandbox VnV repair marker',
      'Product QA ready',
      'Assumed ready',
    ]));
    expect(contract?.requiredExactTexts.some(item => /keep data-testid/i.test(item))).toBe(false);
  });

  it('binds Product QA criteria onto the plan as immutable successCriteria', async () => {
    const analysis = await validator.analyze({
      task: 'On app/page.tsx add data-testid=sandbox-p21-assumed with exact visible text Assumed ready.',
      qualityProfile: 'STANDARD',
    });
    const contract = toAcceptanceContract(analysis)!;
    const bound = bindAcceptanceContract(plan(), contract);
    expect(bound.validationStrategy.successCriteria).toEqual(contract.criteria);
    expect(bound.acceptanceContract).toBe(contract);
    expect(bound.steps[0].description).toMatch(/REQUIRED ACCEPTANCE/);
    expect(bound.steps[0].description).toMatch(/sandbox-p21-assumed/);
  });

  it('fails locally when required marker B is missing', () => {
    const contract = {
      criteria: ['A', 'B'],
      assumptions: [],
      constraints: [],
      requiredTestIds: ['marker-a', 'marker-b'],
      requiredExactTexts: ['Alpha', 'Bravo'],
      preserve: { testIds: [], exactTexts: [] },
    };
    const missing = missingRequiredObservables(
      { 'app/page.tsx': '<div data-testid="marker-a">Alpha</div>' },
      contract,
    );
    expect(missing.testIds).toEqual(['marker-b']);
    expect(missing.exactTexts).toEqual(['Bravo']);
    const checks = evaluateAcceptanceContract({
      contents: { 'app/page.tsx': '<div data-testid="marker-a">Alpha</div>' },
      contract,
    });
    expect(checks.some(item => !item.passed && /marker-b/.test(item.evidence))).toBe(true);
    expect(checks.some(item => !item.passed && /source: app\/page.tsx/.test(item.evidence))).toBe(true);
  });

  it('repair must add B without deleting previously satisfied A', () => {
    const firstImpl = '<footer data-testid="marker-a">Alpha</footer>';
    const contract = {
      criteria: ['A and B'],
      assumptions: [],
      constraints: [],
      requiredTestIds: ['marker-a', 'marker-b'],
      requiredExactTexts: ['Alpha', 'Bravo'],
      preserve: { testIds: [], exactTexts: [] },
    };
    const preserve = snapshotFromContents({ 'app/page.tsx': firstImpl }, contract);
    expect(preserve.testIds).toContain('marker-a');
    expect(preserve.exactTexts).toContain('Alpha');

    const deletedA = '<div data-testid="marker-b">Bravo</div>';
    const removed = removedPreservedObservables({ 'app/page.tsx': deletedA }, preserve);
    expect(removed.testIds).toContain('marker-a');
    expect(removed.exactTexts).toContain('Alpha');
    const badRepair = evaluateAcceptanceContract({
      contents: { 'app/page.tsx': deletedA },
      contract,
      preserve,
    });
    expect(badRepair.some(item => !item.passed && /removed previously satisfied data-testid="marker-a"/.test(item.evidence))).toBe(true);

    const keptAAddedB = '<footer data-testid="marker-a">Alpha</footer><div data-testid="marker-b">Bravo</div>';
    const goodRepair = evaluateAcceptanceContract({
      contents: { 'app/page.tsx': keptAAddedB },
      contract,
      preserve,
    });
    expect(goodRepair.every(item => item.passed)).toBe(true);
  });
});
