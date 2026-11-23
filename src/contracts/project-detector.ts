import { ProjectDetectionExtension, ProjectProfile } from '../domain/project-profile';

/**
 * Deterministic project capability detection.
 * Must not call an LLM. Complete repository analysis is out of scope.
 */
export interface ProjectDetector {
  detect(workspaceRoot: string): Promise<ProjectProfile>;
}

export interface ProjectDetectorOptions {
  readonly extensions?: ReadonlyArray<ProjectDetectionExtension>;
}
