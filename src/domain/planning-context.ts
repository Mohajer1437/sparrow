export interface PlanningContext {
  readonly objective: string;
  readonly availableTools: ReadonlyArray<string>;
  readonly maxSteps: number;
  readonly constraints?: ReadonlyArray<string>;
  readonly memoryContext?: string;
  readonly acceptanceContract?: import('./acceptance-contract').AcceptanceContract;
}

export interface PlanningConfig {
  readonly maxSteps: number;
  readonly preferredStepSize: number;
  readonly strategy: 'sequential' | 'parallel';
}
