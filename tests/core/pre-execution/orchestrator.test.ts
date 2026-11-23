import { DefaultPreExecutionOrchestrator } from '../../../src/core/pre-execution/orchestrator';
import { DefaultTaskIntake } from '../../../src/core/pre-execution/task-intake';
import { DefaultPreflightAnalyzer } from '../../../src/core/pre-execution/preflight-analyzer';
import { DefaultEvidenceBuilder } from '../../../src/core/pre-execution/evidence-builder';
import { DefaultClarificationEngine } from '../../../src/core/pre-execution/clarification-engine';
import { DefaultDecisionAdvisor } from '../../../src/core/pre-execution/decision-advisor';
import { DefaultContractPlanner } from '../../../src/core/pre-execution/contract-planner';
import { DefaultPlanCritic } from '../../../src/core/pre-execution/plan-critic';
import { DefaultContractBuilder } from '../../../src/core/pre-execution/contract-builder';
import { DefaultExecutionGate } from '../../../src/core/pre-execution/execution-gate';
import { LocalWorkspace } from '../../../src/core/workspace/local-workspace';
import path from 'path';

describe('DefaultPreExecutionOrchestrator', () => {
  let orchestrator: DefaultPreExecutionOrchestrator;
  let workspace: LocalWorkspace;

  let workspacePath: string;

  beforeEach(() => {
    workspacePath = path.resolve(__dirname, '../../..');
    workspace = new LocalWorkspace(workspacePath);
    orchestrator = new DefaultPreExecutionOrchestrator(
      new DefaultTaskIntake(),
      new DefaultPreflightAnalyzer(workspace, workspacePath),
      new DefaultEvidenceBuilder(workspace, workspacePath),
      new DefaultClarificationEngine(),
      new DefaultDecisionAdvisor(),
      new DefaultContractPlanner(),
      new DefaultPlanCritic(),
      new DefaultContractBuilder(),
      new DefaultExecutionGate(),
    );
  });

  it('should be instantiable with all G components', () => {
    expect(orchestrator).toBeDefined();
  });

  it('should start in INTAKE state', () => {
    expect(orchestrator.getState()).toBe('INTAKE');
  });

  it('should not be ready initially', () => {
    expect(orchestrator.isReady()).toBe(false);
  });

  it('should have run method', () => {
    expect(typeof orchestrator.run).toBe('function');
  });

  it('should have answerQuestion method', () => {
    expect(typeof orchestrator.answerQuestion).toBe('function');
  });
});
