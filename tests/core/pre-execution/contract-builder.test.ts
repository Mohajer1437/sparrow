import { DefaultContractBuilder } from '../../../src/core/pre-execution/contract-builder';

function makeIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intent-1',
    rawPrompt: 'Add a footer to app/page.tsx',
    type: 'FEATURE',
    mode: 'MEDIUM',
    objective: 'Add a footer to app/page.tsx',
    initialScope: ['app/page.tsx'],
    constraints: [],
    successCriteria: ['Footer is visible'],
    ...overrides,
  };
}

function makeInspection(overrides: Record<string, unknown> = {}) {
  return {
    framework: 'nextjs',
    runtime: 'node',
    packageManager: 'npm',
    hasTypeScript: true,
    hasTests: false,
    hasESLint: false,
    structure: ['app'],
    ...overrides,
  };
}

function makeRisk() {
  return {
    level: 'LOW',
    estimatedFilesAffected: 1,
    explanation: 'Small UI change',
    reversible: true,
  };
}

function makePlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    objective: 'Add a footer to app/page.tsx',
    reasoning: 'Edit the home page',
    steps: [
      {
        id: 'step-1',
        description: 'Update app/page.tsx',
        type: 'modify',
        requiredTools: [],
        expectedOutcome: 'Footer added',
        expectedFiles: ['app/page.tsx'],
      },
    ],
    ...overrides,
  };
}

describe('DefaultContractBuilder', () => {
  let builder: DefaultContractBuilder;

  beforeEach(() => {
    builder = new DefaultContractBuilder();
  });

  it('should be instantiable', () => {
    expect(builder).toBeDefined();
  });

  it('should have build method', () => {
    expect(typeof builder.build).toBe('function');
  });

  it('marks a structurally complete contract validated when PlanCritic is absent', async () => {
    const evidence: any[] = [{
      status: 'CONFIRMED',
      description: 'app/page.tsx exists',
    }];

    const result = await builder.build(
      makeIntent() as any,
      makeInspection() as any,
      makeRisk() as any,
      evidence,
      undefined,
      makePlan() as any,
    );
    expect(result.validated).toBe(true);
    expect(result.contract.validated).toBe(true);
    expect(result.validationErrors).toEqual([]);
  });

  it('validates after real validation when file evidence is unconfirmed but preflight facts exist', async () => {
    const evidence: any[] = [
      { id: 'e1', type: 'FILE_EXISTS', status: 'NOT_FOUND', description: 'File exists: Next.js', source: 'Next.js' },
      { id: 'e2', type: 'FILE_CONTENT', status: 'ERROR', description: 'File content: Next.js', source: 'Next.js' },
    ];

    const result = await builder.build(
      makeIntent({
        rawPrompt: 'Inspect this Next.js project and make a small safe change',
        objective: 'Inspect this Next.js project and make a small safe change',
        initialScope: ['Next.js'],
      }) as any,
      makeInspection() as any,
      makeRisk() as any,
      evidence,
      undefined,
      makePlan() as any,
    );

    expect(result.contract.knownFacts.length).toBeGreaterThan(0);
    expect(result.contract.knownFacts.some(fact => /Framework detected: nextjs/.test(fact))).toBe(true);
    expect(result.contract.filesInScope).toContain('app/page.tsx');
    expect(result.contract.filesInScope).not.toContain('Next.js');
    expect(result.validated).toBe(true);
    expect(result.contract.validated).toBe(true);
    expect(result.validationErrors).toEqual([]);
  });

  it('extracts files from plan prose when intake scope is empty', async () => {
    const result = await builder.build(
      makeIntent({
        rawPrompt: 'Inspect this Next.js project and explain login',
        objective: 'Inspect this Next.js project and explain login',
        initialScope: [],
      }) as any,
      makeInspection() as any,
      makeRisk() as any,
      [],
      undefined,
      {
        id: 'plan-1',
        objective: 'Explain login',
        reasoning: 'Start from app/login/page.tsx',
        steps: [{
          id: 'step-1',
          description: 'Read the login page',
          expectedOutcome: 'app/login/page.tsx understood',
          expectedFiles: [],
        }],
      } as any,
    );

    expect(result.contract.filesInScope).toContain('app/login/page.tsx');
    expect(result.validated).toBe(true);
  });

  it('does not treat contract existence as validation when the objective is empty', async () => {
    const result = await builder.build(
      makeIntent({ objective: '   ' }) as any,
      makeInspection() as any,
      makeRisk() as any,
      [{ status: 'CONFIRMED', description: 'app/page.tsx exists' }] as any,
      undefined,
      makePlan() as any,
    );

    expect(result.contract).toBeDefined();
    expect(result.validated).toBe(false);
    expect(result.contract.validated).toBe(false);
    expect(result.validationErrors).toContain('Contract objective is missing or empty');
  });

  it('does not validate when no plausible files are in scope', async () => {
    const result = await builder.build(
      makeIntent({
        initialScope: ['Next.js'],
        objective: 'Inspect this Next.js project',
      }) as any,
      makeInspection({ framework: 'unknown', packageManager: 'unknown', structure: [] }) as any,
      makeRisk() as any,
      [],
      undefined,
      {
        id: 'plan-1',
        objective: 'Inspect the project',
        reasoning: 'No specific files',
        steps: [{ id: 'step-1', description: 'Look around', expectedFiles: [] }],
      } as any,
    );

    expect(result.validated).toBe(false);
    expect(result.contract.validated).toBe(false);
    expect(result.validationErrors).toContain('Contract has no files in scope');
  });

  it('does not stamp validated=true when structural validation fails', async () => {
    const result = await builder.build(
      makeIntent({ objective: '' }) as any,
      makeInspection() as any,
      makeRisk() as any,
      [],
      undefined,
      makePlan() as any,
    );

    expect(result.contract).toBeTruthy();
    expect(result.validated).toBe(false);
    expect(result.contract.validated).toBe(false);
  });
});
