/**
 * Milestone A6: .ai Context Foundation
 *
 * Discovery and metadata for project-specific AI context files.
 * Full context loading / interpretation is deferred.
 */

export const AI_CONTEXT_FILE_NAMES = [
  'project',
  'frontend',
  'backend',
  'dependencies',
  'maps',
] as const;

export type AiContextFileName = (typeof AI_CONTEXT_FILE_NAMES)[number];

export interface AiContextFileMetadata {
  readonly name: AiContextFileName;
  readonly relativePath: string;
  readonly exists: boolean;
  readonly isDirectory?: boolean;
  readonly sizeBytes?: number;
  readonly modifiedAt?: string;
}

/**
 * Nested or extra `.ai` files discovered without loading content.
 * Used by targeted gathering to select relevant documents.
 */
export interface AiContextDiscoveredFile {
  readonly relativePath: string;
  readonly exists: boolean;
  readonly isDirectory?: boolean;
  readonly sizeBytes?: number;
  readonly modifiedAt?: string;
}

export interface AiContextDiscovery {
  readonly workspaceRoot: string;
  readonly rootPath: string;
  readonly exists: boolean;
  readonly files: ReadonlyArray<AiContextFileMetadata>;
  readonly discoveredFiles?: ReadonlyArray<AiContextDiscoveredFile>;
}

export function freezeAiContextDiscovery(discovery: AiContextDiscovery): AiContextDiscovery {
  return Object.freeze({
    workspaceRoot: discovery.workspaceRoot,
    rootPath: discovery.rootPath,
    exists: discovery.exists,
    files: Object.freeze(discovery.files.map(file => Object.freeze({ ...file }))),
    discoveredFiles: discovery.discoveredFiles
      ? Object.freeze(discovery.discoveredFiles.map(file => Object.freeze({ ...file })))
      : Object.freeze([]),
  });
}
