import { ContextStrategyBuilder, ContextStrategyInput } from '../../contracts/context-strategy';
import {
  CONTEXT_SOURCE_PRIORITY,
  ContextSourceDescriptor,
  ContextSourceType,
  validateContextSource,
} from '../../domain/context-source';
import { ContextStrategy, freezeContextStrategy } from '../../domain/context-strategy';
import { aggregateSkillContextRequirements } from './skill-context-requirements';

/**
 * Deterministic context strategy. No LLM. No repository file inspection.
 */
export class PlannerContextStrategyBuilder implements ContextStrategyBuilder {
  build(input: ContextStrategyInput): ContextStrategy {
    const requirements = aggregateSkillContextRequirements(input.resolvedSkills.skills);
    const repairMode = isRepairMode(input);
    const reasoning: string[] = [...requirements.reasons];
    const sources: ContextSourceDescriptor[] = [];

    sources.push(buildUserTask(input.userTask, reasoning));
    sources.push(buildProductQa(input, reasoning));
    sources.push(buildFailureContract(input, repairMode, reasoning));
    sources.push(buildProjectMetadata(input, requirements.projectMetadataRequired, reasoning));
    sources.push(buildAiContext(input, requirements, reasoning));
    sources.push(buildSourceFiles(requirements.sourceFilesSelected, reasoning));
    sources.push(buildCodebaseMap(input, requirements.codebaseMapOptional, reasoning));

    if (repairMode) {
      reasoning.push('Repair mode: Failure Contract is a required context source (priority 3)');
      if (input.failureContract && input.failureContract.incidentalCount > 0) {
        reasoning.push(
          `Incidental failures (${input.failureContract.incidentalCount}) are recorded but are not additional context requirements`,
        );
      }
    } else {
      reasoning.push('Normal mode: Failure Contract is not a context requirement');
    }

    const frozenSources = sources
      .map(source => validateContextSource(source))
      .sort((a, b) => a.priority - b.priority);

    const typesWith = (predicate: (source: ContextSourceDescriptor) => boolean): ContextSourceType[] =>
      frozenSources.filter(predicate).map(source => source.type);

    return freezeContextStrategy({
      repairMode,
      sources: frozenSources,
      selectedSources: typesWith(source => source.status === 'SELECTED'),
      requiredSources: typesWith(source => source.required),
      optionalSources: typesWith(source => !source.required),
      excludedSources: typesWith(source => source.status === 'EXCLUDED'),
      deferredSources: typesWith(source => source.status === 'DEFERRED'),
      missingRequired: typesWith(source => source.status === 'MISSING_REQUIRED'),
      missingOptional: typesWith(source => source.status === 'MISSING_OPTIONAL'),
      reasoning,
      primaryFailureId: repairMode ? input.failureContract?.primaryFailureId : undefined,
      incidentalFailureCount: repairMode ? (input.failureContract?.incidentalCount ?? 0) : 0,
    });
  }
}

function isRepairMode(input: ContextStrategyInput): boolean {
  const contract = input.failureContract;
  return Boolean(contract && typeof contract.id === 'string' && contract.id.trim().length > 0);
}

function source(
  type: ContextSourceType,
  fields: Omit<ContextSourceDescriptor, 'type' | 'priority'>,
): ContextSourceDescriptor {
  return {
    type,
    priority: CONTEXT_SOURCE_PRIORITY[type],
    ...fields,
  };
}

function buildUserTask(userTask: string, reasoning: string[]): ContextSourceDescriptor {
  const available = typeof userTask === 'string' && userTask.trim().length > 0;
  if (available) {
    reasoning.push('USER_TASK selected: explicit user objective');
    return source('USER_TASK', {
      required: true,
      available: true,
      status: 'SELECTED',
      selectionReason: 'User task is the primary planning objective',
    });
  }
  reasoning.push('USER_TASK missing: empty objective');
  return source('USER_TASK', {
    required: true,
    available: false,
    status: 'MISSING_REQUIRED',
    missingReason: 'User task is empty',
  });
}

function buildProductQa(input: ContextStrategyInput, reasoning: string[]): ContextSourceDescriptor {
  const qa = input.productQa;
  const available = Boolean(qa && (qa.objective.trim().length > 0 || qa.acceptanceCriteria.length > 0));
  if (available && qa) {
    reasoning.push('PRODUCT_QA selected: acceptance criteria are available');
    return source('PRODUCT_QA', {
      required: true,
      available: true,
      status: 'SELECTED',
      selectionReason: 'Product QA acceptance criteria constrain planning',
    });
  }
  reasoning.push('PRODUCT_QA optional and unavailable');
  return source('PRODUCT_QA', {
    required: false,
    available: false,
    status: 'MISSING_OPTIONAL',
    missingReason: 'Product QA acceptance criteria were not provided',
  });
}

function buildFailureContract(
  input: ContextStrategyInput,
  repairMode: boolean,
  reasoning: string[],
): ContextSourceDescriptor {
  if (!repairMode) {
    reasoning.push('FAILURE_CONTRACT excluded: not in repair mode');
    return source('FAILURE_CONTRACT', {
      required: false,
      available: false,
      status: 'EXCLUDED',
      exclusionReason: 'Normal mode: failure contract is not a context requirement',
    });
  }

  const contract = input.failureContract;
  if (!contract) {
    reasoning.push('FAILURE_CONTRACT missing in repair mode');
    return source('FAILURE_CONTRACT', {
      required: true,
      available: false,
      status: 'MISSING_REQUIRED',
      missingReason: 'Repair mode requires a failure contract but none was provided',
    });
  }

  const detail = contract.primaryFailureId
    ? `primary failure ${contract.primaryFailureId}`
    : contract.summary;
  reasoning.push(`FAILURE_CONTRACT selected: ${detail}`);
  return source('FAILURE_CONTRACT', {
    required: true,
    available: true,
    status: 'SELECTED',
    selectionReason: `Repair mode requires the failure contract (${detail})`,
  });
}

function buildProjectMetadata(
  input: ContextStrategyInput,
  requiredBySkills: boolean,
  reasoning: string[],
): ContextSourceDescriptor {
  const required = true;
  const available = input.projectProfile.projectType !== 'unknown';
  if (available) {
    reasoning.push(
      `PROJECT_METADATA selected: ${input.projectProfile.projectType} (${input.projectProfile.detectedFrameworks.join(', ') || 'no framework'})`,
    );
    return source('PROJECT_METADATA', {
      required,
      available: true,
      status: 'SELECTED',
      selectionReason: requiredBySkills
        ? 'Required to identify project capabilities for resolved skills'
        : 'Required to identify project capabilities',
    });
  }
  reasoning.push('PROJECT_METADATA missing: project type is unknown');
  return source('PROJECT_METADATA', {
    required,
    available: false,
    status: 'MISSING_REQUIRED',
    missingReason: 'Project metadata is unknown; capabilities could not be detected',
  });
}

function buildAiContext(
  input: ContextStrategyInput,
  requirements: ReturnType<typeof aggregateSkillContextRequirements>,
  reasoning: string[],
): ContextSourceDescriptor {
  if (!requirements.aiContextOptional) {
    reasoning.push('AI_CONTEXT excluded: no resolved skill requested it');
    return source('AI_CONTEXT', {
      required: false,
      available: input.aiContext.exists,
      status: 'EXCLUDED',
      exclusionReason: 'No resolved skill requested AI_CONTEXT',
    });
  }

  const existing = input.aiContext.files.filter(file => file.exists);
  const relevant = existing.filter(file => requirements.aiContextFileHints.includes(file.name));

  if (!input.aiContext.exists) {
    reasoning.push('AI_CONTEXT optional and missing: .ai directory not present');
    return source('AI_CONTEXT', {
      required: false,
      available: false,
      status: 'MISSING_OPTIONAL',
      missingReason: '.ai directory is not present',
    });
  }

  if (relevant.length > 0) {
    const names = relevant.map(file => file.name).join(', ');
    reasoning.push(`AI_CONTEXT selected: relevant files ${names}`);
    return source('AI_CONTEXT', {
      required: false,
      available: true,
      status: 'SELECTED',
      selectionReason: `Relevant .ai metadata exists for the selected execution domain (${names})`,
    });
  }

  reasoning.push('AI_CONTEXT available but not selected: no relevant domain files');
  return source('AI_CONTEXT', {
    required: false,
    available: true,
    status: 'AVAILABLE_BUT_NOT_SELECTED',
    selectionReason: 'No relevant .ai metadata exists for the selected execution domain',
  });
}

function buildSourceFiles(selected: boolean, reasoning: string[]): ContextSourceDescriptor {
  if (!selected) {
    reasoning.push('SOURCE_FILES excluded: no resolved skills');
    return source('SOURCE_FILES', {
      required: false,
      available: false,
      status: 'EXCLUDED',
      exclusionReason: 'No resolved skills require source files',
    });
  }
  reasoning.push('SOURCE_FILES selected: targeted gathering is permitted for resolved skills');
  return source('SOURCE_FILES', {
    required: false,
    available: true,
    status: 'SELECTED',
    selectionReason: 'Resolved skills permit targeted source-file gathering',
  });
}

function buildCodebaseMap(
  input: ContextStrategyInput,
  optional: boolean,
  reasoning: string[],
): ContextSourceDescriptor {
  if (!optional && !input.codebaseMapAvailable) {
    reasoning.push('CODEBASE_MAP excluded: backend/graph context is not required');
    return source('CODEBASE_MAP', {
      required: false,
      available: false,
      status: 'EXCLUDED',
      exclusionReason: 'Backend/graph context is not required for the resolved skills',
    });
  }
  if (input.codebaseMapAvailable) {
    reasoning.push('CODEBASE_MAP selected: structural graph is available for bounded query');
    return source('CODEBASE_MAP', {
      required: false,
      available: true,
      status: 'SELECTED',
      selectionReason: 'Structural graph available — gather bounded subgraph via KnowledgeQuery (not full dump)',
    });
  }
  reasoning.push('CODEBASE_MAP deferred: structural graph not present on disk yet');
  return source('CODEBASE_MAP', {
    required: false,
    available: false,
    status: 'DEFERRED',
    deferralReason: 'Structural graph not available; run index-structural first',
  });
}
