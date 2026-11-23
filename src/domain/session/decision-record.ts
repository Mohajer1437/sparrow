export interface DecisionRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly question: string;
  readonly decision: string;
  readonly reasoning: string;
  readonly alternatives: ReadonlyArray<string>;
  readonly consequences: string;
  readonly stepId?: string;
}
