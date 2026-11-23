import { DefaultSafeExperiment } from '../../../src/core/pre-execution/safe-experiment';
import { LocalWorkspace } from '../../../src/core/workspace/local-workspace';
import path from 'path';

describe('DefaultSafeExperiment', () => {
  let experiment: DefaultSafeExperiment;
  let workspace: LocalWorkspace;

  beforeEach(() => {
    workspace = new LocalWorkspace(path.resolve(__dirname, '../../..'));
    experiment = new DefaultSafeExperiment(workspace);
  });

  it('should be instantiable', () => {
    expect(experiment).toBeDefined();
  });

  it('should have run method', () => {
    expect(typeof experiment.run).toBe('function');
  });
});
