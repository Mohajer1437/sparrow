import { DefaultPlanCritic } from '../../../src/core/pre-execution/plan-critic';

describe('DefaultPlanCritic', () => {
  let critic: DefaultPlanCritic;

  beforeEach(() => {
    critic = new DefaultPlanCritic();
  });

  it('should be instantiable', () => {
    expect(critic).toBeDefined();
  });

  it('should have critique method', () => {
    expect(typeof critic.critique).toBe('function');
  });
});
