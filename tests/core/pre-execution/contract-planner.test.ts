import { DefaultContractPlanner } from '../../../src/core/pre-execution/contract-planner';

describe('DefaultContractPlanner', () => {
  let planner: DefaultContractPlanner;

  beforeEach(() => {
    planner = new DefaultContractPlanner();
  });

  it('should be instantiable', () => {
    expect(planner).toBeDefined();
  });

  it('should have plan method', () => {
    expect(typeof planner.plan).toBe('function');
  });
});
