import { DefaultTaskDecomposer } from '../../../src/core/planning/default-task-decomposer';
import { ExecutionPlan, PlanStep } from '../../../src/domain/execution-plan';
import { MicroTaskGraph } from '../../../src/domain/micro-task';

function makePlan(steps: Partial<PlanStep>[], objective = 'Test objective'): ExecutionPlan {
  return Object.freeze({
    id: 'plan-test-1',
    objective,
    complexity: 'simple' as const,
    reasoning: 'Test reasoning',
    steps: Object.freeze(steps.map((s, i) => Object.freeze({
      id: s.id || `step-${i + 1}`,
      description: s.description || `Step ${i + 1}`,
      type: s.type || ('modify' as const),
      requiredTools: Object.freeze(s.requiredTools ? [...s.requiredTools] : []),
      expectedOutcome: s.expectedOutcome || `Completed step ${i + 1}`,
      objective: s.objective,
      dependencies: Object.freeze(s.dependencies ? [...s.dependencies] : []),
      expectedFiles: Object.freeze(s.expectedFiles ? [...s.expectedFiles] : []),
      validationCriteria: Object.freeze(s.validationCriteria ? [...s.validationCriteria] : []),
    }))),
    affectedDomains: Object.freeze([]),
    validationStrategy: Object.freeze({
      requiredTests: Object.freeze([]),
      successCriteria: Object.freeze(['All steps completed']),
    }),
    createdAt: new Date().toISOString(),
    status: 'VALIDATED' as const,
  });
}

describe('DefaultTaskDecomposer', () => {
  let decomposer: DefaultTaskDecomposer;

  beforeEach(() => {
    decomposer = new DefaultTaskDecomposer();
  });

  describe('large task decomposition', () => {
    it('should split a multi-file step into multiple micro tasks', () => {
      const plan = makePlan([
        {
          description: 'Add payment module',
          expectedFiles: ['payment.entity.ts', 'payment.service.ts', 'payment.controller.ts'],
        },
      ]);
      const graph = decomposer.decompose(plan);
      expect(graph.totalTasks).toBeGreaterThan(1);
      expect(graph.tasks.length).toBe(3);
      expect(graph.tasks[0].targetFiles).toContain('payment.entity.ts');
      expect(graph.tasks[1].targetFiles).toContain('payment.service.ts');
      expect(graph.tasks[2].targetFiles).toContain('payment.controller.ts');
    });

    it('should split multi-action description into separate tasks', () => {
      const plan = makePlan([
        {
          description: 'Create user entity. Add user repository. Create user service. Add controller endpoint.',
          expectedFiles: [],
        },
      ]);
      const graph = decomposer.decompose(plan);
      expect(graph.totalTasks).toBeGreaterThan(1);
    });
  });

  describe('simple task preservation', () => {
    it('should not split a simple create-file task', () => {
      const plan = makePlan([
        { description: 'Create a file called config.json', expectedFiles: ['config.json'] },
      ]);
      const graph = decomposer.decompose(plan);
      expect(graph.totalTasks).toBe(1);
      expect(graph.tasks[0].title).toContain('config.json');
    });

    it('should not split a verify task', () => {
      const plan = makePlan([
        { description: 'Verify the file was created correctly', expectedFiles: [] },
      ]);
      const graph = decomposer.decompose(plan);
      expect(graph.totalTasks).toBe(1);
    });
  });

  describe('dependency preservation', () => {
    it('should create sequential dependencies for multi-file split', () => {
      const plan = makePlan([
        {
          description: 'Create entity, repository, and service',
          expectedFiles: ['entity.ts', 'repository.ts', 'service.ts'],
        },
      ]);
      const graph = decomposer.decompose(plan);
      expect(graph.tasks.length).toBe(3);
      expect(graph.tasks[0].dependencies.length).toBe(0);
      expect(graph.tasks[1].dependencies).toContain(graph.tasks[0].id);
      expect(graph.tasks[2].dependencies).toContain(graph.tasks[1].id);
    });
  });

  describe('circular dependency detection', () => {
    it('should detect circular dependencies in validateGraph', () => {
      const graph: MicroTaskGraph = Object.freeze({
        planId: 'plan-1',
        tasks: Object.freeze([
          Object.freeze({
            id: 'mt-0', title: 'A', description: 'A', targetFiles: Object.freeze([]),
            dependencies: Object.freeze(['mt-1']), expectedOutput: '', verificationSteps: Object.freeze([]),
            rollbackStrategy: '', complexity: 'trivial' as const, riskLevel: 'low' as const,
            reasoningRequired: 'none' as const, difficultyScore: 1,
            requiredContext: Object.freeze({ files: Object.freeze([]), symbols: Object.freeze([]), previousTaskOutputs: Object.freeze([]) }),
          }),
          Object.freeze({
            id: 'mt-1', title: 'B', description: 'B', targetFiles: Object.freeze([]),
            dependencies: Object.freeze(['mt-0']), expectedOutput: '', verificationSteps: Object.freeze([]),
            rollbackStrategy: '', complexity: 'trivial' as const, riskLevel: 'low' as const,
            reasoningRequired: 'none' as const, difficultyScore: 1,
            requiredContext: Object.freeze({ files: Object.freeze([]), symbols: Object.freeze([]), previousTaskOutputs: Object.freeze([]) }),
          }),
        ]),
        totalTasks: 2, highRiskTasks: 0, averageDifficulty: 1,
        createdAt: new Date().toISOString(),
      });
      const result = decomposer.validateGraph(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Circular'))).toBe(true);
    });

    it('should accept valid DAG', () => {
      const plan = makePlan([
        { description: 'Create entity', expectedFiles: ['entity.ts'] },
        { description: 'Create service', expectedFiles: ['service.ts'] },
      ]);
      const graph = decomposer.decompose(plan);
      const result = decomposer.validateGraph(graph);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });

  describe('risk detection', () => {
    it('should mark authentication tasks as high risk', () => {
      const plan = makePlan([
        { description: 'Modify authentication flow with password hashing' },
      ]);
      const graph = decomposer.decompose(plan);
      expect(graph.tasks[0].riskLevel).toBe('high');
      expect(graph.highRiskTasks).toBe(1);
    });

    it('should mark database migration as high risk', () => {
      const plan = makePlan([
        { description: 'Create database migration for users table' },
      ]);
      const graph = decomposer.decompose(plan);
      expect(graph.tasks[0].riskLevel).toBe('high');
    });

    it('should mark delete operations as high risk', () => {
      const plan = makePlan([
        { description: 'Delete old legacy code and remove deprecated functions' },
      ]);
      const graph = decomposer.decompose(plan);
      expect(graph.tasks[0].riskLevel).toBe('high');
    });

    it('should mark simple create as low risk', () => {
      const plan = makePlan([
        { description: 'Create a new utility helper' },
      ]);
      const graph = decomposer.decompose(plan);
      expect(graph.tasks[0].riskLevel).toBe('low');
    });
  });

  describe('difficulty scoring', () => {
    it('should assign low difficulty to simple tasks', () => {
      const plan = makePlan([
        { description: 'Create a new readme document' },
      ]);
      const graph = decomposer.decompose(plan);
      expect(graph.tasks[0].difficultyScore).toBeLessThanOrEqual(4);
    });

    it('should assign high difficulty to complex tasks', () => {
      const plan = makePlan([
        { description: 'Implement authentication system with security encryption and database migration' },
      ]);
      const graph = decomposer.decompose(plan);
      expect(graph.tasks[0].difficultyScore).toBeGreaterThanOrEqual(7);
    });

    it('should keep difficulty within 1-10 range', () => {
      const plan = makePlan([
        { description: 'Implement and build a complete system with security, authentication, database migration, and public api breaking changes' },
      ]);
      const graph = decomposer.decompose(plan);
      for (const task of graph.tasks) {
        expect(task.difficultyScore).toBeGreaterThanOrEqual(1);
        expect(task.difficultyScore).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('reasoning level', () => {
    it('should assign "none" to trivial tasks', () => {
      const plan = makePlan([
        { description: 'Create a new readme document' },
      ]);
      const graph = decomposer.decompose(plan);
      expect(graph.tasks[0].reasoningRequired).toBe('none');
    });

    it('should assign "architecture" to complex tasks', () => {
      const plan = makePlan([
        { description: 'Implement authentication system with security and database migration and refactor architecture' },
      ]);
      const graph = decomposer.decompose(plan);
      expect(graph.tasks[0].reasoningRequired).toBe('architecture');
    });
  });

  describe('graph metadata', () => {
    it('should calculate correct metadata', () => {
      const plan = makePlan([
        { description: 'Create entity', expectedFiles: ['entity.ts'] },
        { description: 'Modify authentication flow', expectedFiles: ['auth.ts'] },
      ]);
      const graph = decomposer.decompose(plan);
      expect(graph.planId).toBe('plan-test-1');
      expect(graph.totalTasks).toBe(graph.tasks.length);
      expect(graph.highRiskTasks).toBeGreaterThanOrEqual(1);
      expect(graph.averageDifficulty).toBeGreaterThan(0);
      expect(graph.createdAt).toBeTruthy();
    });
  });

  describe('graph validation — unknown dependency', () => {
    it('should reject tasks with unknown dependencies', () => {
      const graph: MicroTaskGraph = Object.freeze({
        planId: 'plan-1',
        tasks: Object.freeze([
          Object.freeze({
            id: 'mt-0', title: 'A', description: 'A', targetFiles: Object.freeze([]),
            dependencies: Object.freeze(['mt-99']), expectedOutput: '', verificationSteps: Object.freeze([]),
            rollbackStrategy: '', complexity: 'trivial' as const, riskLevel: 'low' as const,
            reasoningRequired: 'none' as const, difficultyScore: 1,
            requiredContext: Object.freeze({ files: Object.freeze([]), symbols: Object.freeze([]), previousTaskOutputs: Object.freeze([]) }),
          }),
        ]),
        totalTasks: 1, highRiskTasks: 0, averageDifficulty: 1,
        createdAt: new Date().toISOString(),
      });
      const result = decomposer.validateGraph(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('unknown task'))).toBe(true);
    });
  });
});
