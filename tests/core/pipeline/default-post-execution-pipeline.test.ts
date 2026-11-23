import { DefaultPostExecutionPipeline } from '../../../src/core/pipeline/default-post-execution-pipeline';
import { KnowledgeFeedbackEngine } from '../../../src/contracts/knowledge-feedback-engine';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';
import { WorkflowResult } from '../../../src/contracts/workflow-orchestrator';

describe('DefaultPostExecutionPipeline', () => {
  let mockEngine: jest.Mocked<KnowledgeFeedbackEngine>;
  let mockRepo: jest.Mocked<RuntimeRepository>;
  let pipeline: DefaultPostExecutionPipeline;

  beforeEach(() => {
    mockEngine = {
      analyze: jest.fn().mockResolvedValue([])
    } as any;
    mockRepo = {
      appendFeedbackCandidates: jest.fn().mockResolvedValue(undefined)
    } as any;
    pipeline = new DefaultPostExecutionPipeline(mockEngine, mockRepo);
  });

  it('calls engine and repository', async () => {
    const result: WorkflowResult = {
      sessionId: 'sess-1',
      success: true,
      plan: null,
      impactReport: null,
      reviewReport: null,
      patchResult: null,
      reflection: null
    };

    mockEngine.analyze.mockResolvedValue([
      { id: '1', type: 'RULE', title: 'Test', content: 'Test', reason: 'Test', evidence: [], confidence: 'HIGH', confidenceReasons: [], status: 'pending_review', generatedAt: '', sourceSessionId: 'sess-1' }
    ]);

    await pipeline.execute(result);

    expect(mockEngine.analyze).toHaveBeenCalledWith(result);
    expect(mockRepo.appendFeedbackCandidates).toHaveBeenCalled();
  });

  it('is fail-safe when engine fails', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockEngine.analyze.mockRejectedValue(new Error('Engine failed'));

    const result: WorkflowResult = {
      sessionId: 'sess-2',
      success: true,
      plan: null,
      impactReport: null,
      reviewReport: null,
      patchResult: null,
      reflection: null
    };

    await expect(pipeline.execute(result)).resolves.not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalled();
    
    consoleWarnSpy.mockRestore();
  });
});
