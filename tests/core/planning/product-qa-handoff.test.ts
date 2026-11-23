import { DefaultTaskPlanner } from '../../../src/core/planning/default-task-planner';
import { HeuristicProductValidator } from '../../../src/core/vv/heuristic-product-validator';
import { toAcceptanceContract } from '../../../src/core/vv/acceptance-contract';
import { formatProductAnalysis } from '../../../src/domain/product-analysis';
import { formatAcceptanceContract } from '../../../src/domain/acceptance-contract';
import { PLANNER_SYSTEM_PROMPT } from '../../../src/core/planning/planner-prompt';

describe('Product QA planner handoff', () => {
  const VALID_PLAN_JSON = {
    id: 'plan-p21',
    objective: 'Add the requested home-page status marker',
    complexity: 'simple',
    reasoning: 'Honor the Product QA acceptance criteria on the named file.',
    steps: [{
      id: 'step-1',
      description: 'Modify app/page.tsx to add the status marker',
      type: 'modify',
      requiredTools: ['write_file'],
      expectedOutcome: 'Acceptance criteria remain true',
      expectedFiles: ['app/page.tsx'],
    }],
    affectedDomains: ['UI'],
    validationStrategy: {
      requiredTests: ['browser'],
      successCriteria: ['status marker visible'],
    },
    createdAt: '2026-08-25T00:00:00.000Z',
  };

  it('keeps intent, criteria, constraints, assumptions, and verification requirements in the planner prompt', async () => {
    const validator = new HeuristicProductValidator();
    const analysis = await validator.analyze({
      task: 'Allow teachers to create assignments for their classes on app/page.tsx. Do not add authentication. Keep existing Persian layout.',
      qualityProfile: 'PRODUCTION',
      intakeAmbiguities: ['No specific file mentioned for modification task'],
    });
    const formatted = formatProductAnalysis(analysis);
    const contract = toAcceptanceContract(analysis);
    expect(formatted).toMatch(/USER GOAL:/);
    expect(formatted).toMatch(/teachers/i);
    expect(formatted).toMatch(/ACCEPTANCE CRITERIA:/);
    expect(formatted).toMatch(/Do not add authentication/i);
    expect(formatted).toMatch(/Keep existing Persian layout/i);
    expect(formatted).toMatch(/RESOLVED ASSUMPTIONS:/);
    expect(formatted).toMatch(/VERIFICATION REQUIREMENTS:/);

    const generate = jest.fn().mockResolvedValue({ content: JSON.stringify(VALID_PLAN_JSON) });
    const planner = new DefaultTaskPlanner(
      { generate } as any,
      {
        load: jest.fn().mockResolvedValue({
          architecturalMap: null, codebaseMap: null, knowledgeBase: null,
          loadedAt: new Date().toISOString(), isEmpty: true,
        }),
        hasKnowledge: jest.fn().mockResolvedValue(false),
        getKnowledgeDir: jest.fn().mockReturnValue('knowledge'),
      } as any,
      { build: jest.fn().mockReturnValue('') } as any,
    );

    const result = await planner.plan({
      task: 'Allow teachers to create assignments for their classes on app/page.tsx. Do not add authentication. Keep existing Persian layout.',
      availableTools: ['write_file', 'read_file'],
      productAnalysis: formatted,
      verificationRequirements: analysis.verificationRequirements.join('\n'),
      acceptanceContract: contract,
    });

    expect(generate).toHaveBeenCalled();
    const user = generate.mock.calls[0][0].messages[1].content as string;
    expect(user).toContain(formatted);
    expect(user).toContain(formatAcceptanceContract(contract!));
    expect(user).toMatch(/ACCEPTANCE CONTRACT \(IMMUTABLE/);
    expect(user).toMatch(/Do not add authentication/i);
    expect(user).toMatch(/ACCEPTANCE CRITERIA:/);
    expect(result?.validationStrategy.successCriteria).toEqual(contract!.criteria);
    expect(result?.acceptanceContract?.criteria).toEqual(contract!.criteria);
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/PRODUCT QA CONTRACT/);
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/ACCEPTANCE CONTRACT is immutable/);
  });
});
