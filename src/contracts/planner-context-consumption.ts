import { PlannerContext } from '../domain/planner-context';

/**
 * Milestone B3: boundary between structured PlannerContext and the LLM planner.
 * Serialization is deterministic. The planner does not gather or search the repository.
 */
export interface PlannerContextSerializer {
  serialize(context: PlannerContext | undefined): string;
}

export interface PlannerContextRecordDigest {
  readonly source: string;
  readonly reference: string;
  readonly status: string;
  readonly reason: string;
  readonly priority: number;
  readonly truncated: boolean;
  readonly sizeBytes: number;
  readonly contentIncluded: boolean;
  readonly failureRole?: string;
}

export interface PlannerContextConsumptionDigest {
  readonly consumed: boolean;
  readonly workspaceRoot?: string;
  readonly repairMode?: boolean;
  readonly skills: ReadonlyArray<string>;
  readonly requestedDomains: ReadonlyArray<string>;
  readonly explicitSkillIds: ReadonlyArray<string>;
  readonly selectedSources: ReadonlyArray<string>;
  readonly excludedSources: ReadonlyArray<string>;
  readonly records: ReadonlyArray<PlannerContextRecordDigest>;
  readonly missingRequired: ReadonlyArray<string>;
  readonly missingOptional: ReadonlyArray<string>;
  readonly truncatedReferences: ReadonlyArray<string>;
  readonly limitReached: boolean;
  readonly serializedLength: number;
}
