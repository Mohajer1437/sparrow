export type ComponentLayer = 'domain' | 'contract' | 'core' | 'cli';
export type ComponentLifecycle = 'active' | 'frozen' | 'deprecated';
export type DecisionStatus = 'proposed' | 'accepted' | 'deprecated' | 'superseded';

export interface ComponentDocumentation {
  readonly id: string;
  readonly name: string;
  readonly layer: ComponentLayer;
  readonly responsibility: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly dependents: ReadonlyArray<string>;
  readonly lifecycle: ComponentLifecycle;
  readonly milestone: string;
  readonly filePath: string;
  readonly testPaths: ReadonlyArray<string>;
}

export interface ArchitectureDecisionRecord {
  readonly id: string;
  readonly title: string;
  readonly status: DecisionStatus;
  readonly context: string;
  readonly decision: string;
  readonly consequences: ReadonlyArray<string>;
  readonly milestone: string;
  readonly date: string;
}

export interface ComponentMapping {
  readonly sourcePath: string;
  readonly architecturalRole: string;
  readonly milestone: string;
  readonly testPaths: ReadonlyArray<string>;
}

export interface DocumentationState {
  readonly components: ReadonlyArray<ComponentDocumentation>;
  readonly decisions: ReadonlyArray<ArchitectureDecisionRecord>;
  readonly mappings: ReadonlyArray<ComponentMapping>;
  readonly generatedAt: string;
  readonly version: string;
}
