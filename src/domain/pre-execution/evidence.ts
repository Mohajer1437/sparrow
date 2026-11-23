/**
 * G.0: Evidence Domain Types
 * 
 * Evidence is observable, verifiable information about the project.
 * No evidence → No assumption → No mutation.
 */

/** Type of evidence collected */
export type EvidenceType =
  | 'FILE_EXISTS'
  | 'FILE_CONTENT'
  | 'DIRECTORY_STRUCTURE'
  | 'CONFIG_VALUE'
  | 'DEPENDENCY_INSTALLED'
  | 'BUILD_OUTPUT'
  | 'TEST_OUTPUT'
  | 'RUNTIME_BEHAVIOR'
  | 'FRAMEWORK_DETECTED'
  | 'PACKAGE_MANAGER_DETECTED'
  | 'ERROR_MESSAGE'
  | 'SCHEMA_DEFINITION'
  | 'API_ENDPOINT'
  | 'CODE_PATTERN';

/** Status of evidence collection */
export type EvidenceStatus =
  | 'PENDING'        // Not yet collected
  | 'COLLECTING'     // In progress
  | 'CONFIRMED'      // Evidence found and verified
  | 'NOT_FOUND'      // Evidence not found (negative evidence)
  | 'ERROR'          // Error during collection
  | 'SKIPPED';       // Skipped due to policy

/** A single piece of evidence */
export interface Evidence {
  readonly id: string;
  readonly type: EvidenceType;
  readonly description: string;
  readonly status: EvidenceStatus;
  
  /** What was observed (raw data) */
  readonly observation?: string;
  
  /** Where the evidence was found (file path, config key, etc.) */
  readonly source?: string;
  
  /** When the evidence was collected */
  readonly collectedAt?: string;
  
  /** Error message if status is ERROR */
  readonly error?: string;
  
  /** Hypothesis this evidence supports or refutes */
  readonly supportsHypothesisId?: string;
}

/** A hypothesis that requires evidence */
export interface Hypothesis {
  readonly id: string;
  readonly statement: string;
  readonly requiredEvidenceTypes: ReadonlyArray<EvidenceType>;
  readonly evidence: ReadonlyArray<Evidence>;
  readonly status: 'UNTESTED' | 'SUPPORTED' | 'REFUTED' | 'INCONCLUSIVE';
}

/** Evidence collection request */
export interface EvidenceCollectionRequest {
  readonly hypothesisId?: string;
  readonly evidenceTypes: ReadonlyArray<EvidenceType>;
  readonly targets: ReadonlyArray<string>; // file paths, config keys, etc.
}

/** Evidence collection result */
export interface EvidenceCollectionResult {
  readonly evidence: ReadonlyArray<Evidence>;
  readonly hypothesesUpdated: ReadonlyArray<Hypothesis>;
  readonly stillMissing: ReadonlyArray<string>;
}
