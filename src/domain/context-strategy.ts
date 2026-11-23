import { ContextSourceDescriptor, ContextSourceType } from './context-source';

export interface ContextStrategy {
  readonly repairMode: boolean;
  readonly sources: ReadonlyArray<ContextSourceDescriptor>;
  readonly selectedSources: ReadonlyArray<ContextSourceType>;
  readonly requiredSources: ReadonlyArray<ContextSourceType>;
  readonly optionalSources: ReadonlyArray<ContextSourceType>;
  readonly excludedSources: ReadonlyArray<ContextSourceType>;
  readonly deferredSources: ReadonlyArray<ContextSourceType>;
  readonly missingRequired: ReadonlyArray<ContextSourceType>;
  readonly missingOptional: ReadonlyArray<ContextSourceType>;
  readonly reasoning: ReadonlyArray<string>;
  readonly primaryFailureId?: string;
  readonly incidentalFailureCount: number;
}

export function freezeContextStrategy(strategy: ContextStrategy): ContextStrategy {
  return Object.freeze({
    repairMode: strategy.repairMode,
    sources: Object.freeze(strategy.sources.map(source => Object.freeze({ ...source }))),
    selectedSources: Object.freeze([...strategy.selectedSources]),
    requiredSources: Object.freeze([...strategy.requiredSources]),
    optionalSources: Object.freeze([...strategy.optionalSources]),
    excludedSources: Object.freeze([...strategy.excludedSources]),
    deferredSources: Object.freeze([...strategy.deferredSources]),
    missingRequired: Object.freeze([...strategy.missingRequired]),
    missingOptional: Object.freeze([...strategy.missingOptional]),
    reasoning: Object.freeze([...strategy.reasoning]),
    primaryFailureId: strategy.primaryFailureId,
    incidentalFailureCount: strategy.incidentalFailureCount,
  });
}

export function formatContextStrategy(strategy: ContextStrategy): string {
  const lines: string[] = [
    `CONTEXT STRATEGY repairMode=${strategy.repairMode}`,
    `Selected: ${strategy.selectedSources.join(', ') || '(none)'}`,
    `Required: ${strategy.requiredSources.join(', ') || '(none)'}`,
    `Optional: ${strategy.optionalSources.join(', ') || '(none)'}`,
    `Excluded: ${strategy.excludedSources.join(', ') || '(none)'}`,
    `Deferred: ${strategy.deferredSources.join(', ') || '(none)'}`,
    `Missing required: ${strategy.missingRequired.join(', ') || '(none)'}`,
    `Missing optional: ${strategy.missingOptional.join(', ') || '(none)'}`,
  ];
  if (strategy.primaryFailureId) {
    lines.push(`Primary failure: ${strategy.primaryFailureId}`);
  }
  lines.push(`Incidental failures: ${strategy.incidentalFailureCount}`);
  if (strategy.reasoning.length > 0) {
    lines.push('Reasoning:');
    for (const reason of strategy.reasoning) {
      lines.push(`- ${reason}`);
    }
  }
  return lines.join('\n');
}
