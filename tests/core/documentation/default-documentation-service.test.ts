import { DefaultDocumentationService } from '../../../src/core/documentation/default-documentation-service';
import { DocumentationRepository } from '../../../src/contracts/documentation-repository';
import { ComponentDocumentation, ArchitectureDecisionRecord, ComponentMapping } from '../../../src/domain/architecture-documentation';

describe('DefaultDocumentationService', () => {
  let mockRepo: jest.Mocked<DocumentationRepository>;
  let service: DefaultDocumentationService;

  beforeEach(() => {
    mockRepo = {
      load: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(false),
    };
    service = new DefaultDocumentationService(mockRepo);
  });

  const testComponent: ComponentDocumentation = Object.freeze({
    id: 'c1', name: 'TaskExecutor', layer: 'core' as const,
    responsibility: 'Executes tasks via LLM provider',
    dependencies: Object.freeze(['Provider', 'ToolExecutor']),
    dependents: Object.freeze(['WorkflowOrchestrator']),
    lifecycle: 'active' as const, milestone: 'R3',
    filePath: 'src/core/execution/task-executor.ts',
    testPaths: Object.freeze(['tests/core/execution/task-executor.test.ts']),
  });

  const testDecision: ArchitectureDecisionRecord = Object.freeze({
    id: 'adr-1', title: 'Use Clean Architecture',
    status: 'accepted' as const,
    context: 'Need maintainable structure',
    decision: 'Adopt Clean Architecture layers',
    consequences: Object.freeze(['Clear separation of concerns']),
    milestone: 'R1', date: '2026-01-01',
  });

  const testMapping: ComponentMapping = Object.freeze({
    sourcePath: 'src/core/execution/task-executor.ts',
    architecturalRole: 'Task Execution',
    milestone: 'R3',
    testPaths: Object.freeze(['tests/core/execution/task-executor.test.ts']),
  });

  it('registers and collects components', async () => {
    service.registerComponent(testComponent);
    const components = await service.collectComponents();
    expect(components).toHaveLength(1);
    expect(components[0].name).toBe('TaskExecutor');
  });

  it('registers and retrieves decisions', async () => {
    service.registerDecision(testDecision);
    const decisions = await service.getDecisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0].title).toBe('Use Clean Architecture');
  });

  it('generates documentation state and saves to repository', async () => {
    service.registerComponent(testComponent);
    service.registerDecision(testDecision);
    service.registerMapping(testMapping);

    const state = await service.generateDocumentation();

    expect(state.components).toHaveLength(1);
    expect(state.decisions).toHaveLength(1);
    expect(state.mappings).toHaveLength(1);
    expect(state.version).toBe('1.0.0');
    expect(mockRepo.save).toHaveBeenCalledWith(state);
  });

  it('retrieves state from repository', async () => {
    const savedState = Object.freeze({
      components: Object.freeze([testComponent]),
      decisions: Object.freeze([]),
      mappings: Object.freeze([]),
      generatedAt: '2026-01-01',
      version: '1.0.0',
    });
    mockRepo.load.mockResolvedValue(savedState);

    const state = await service.getState();
    expect(state).not.toBeNull();
    expect(state!.components).toHaveLength(1);
  });

  it('returns null when no state exists', async () => {
    mockRepo.load.mockResolvedValue(null);
    expect(await service.getState()).toBeNull();
  });

  it('produces immutable documentation state', async () => {
    service.registerComponent(testComponent);
    const state = await service.generateDocumentation();
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.components)).toBe(true);
    expect(Object.isFrozen(state.decisions)).toBe(true);
  });

  it('handles multiple components and decisions', async () => {
    service.registerComponent(testComponent);
    service.registerComponent({ ...testComponent, id: 'c2', name: 'WorkflowOrchestrator' });
    service.registerDecision(testDecision);
    service.registerDecision({ ...testDecision, id: 'adr-2', title: 'Use Deterministic Planning' });

    const state = await service.generateDocumentation();
    expect(state.components).toHaveLength(2);
    expect(state.decisions).toHaveLength(2);
  });
});
