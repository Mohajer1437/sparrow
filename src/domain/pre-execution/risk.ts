/**
 * G.0: Risk Domain Types
 * 
 * Risk model for execution decisions.
 * LOW → MEDIUM → HIGH → CRITICAL
 * HIGH/CRITICAL require explicit confirmation.
 */

/** Risk level classification */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Risk assessment result */
export interface RiskAssessment {
  readonly level: RiskLevel;
  
  /** Human-readable explanation of risk */
  readonly explanation: string;
  
  /** Factors contributing to this risk level */
  readonly factors: ReadonlyArray<string>;
  
  /** Whether this risk is reversible */
  readonly reversible: boolean;
  
  /** Estimated number of files affected */
  readonly estimatedFilesAffected: number;
  
  /** Whether this requires explicit user confirmation */
  readonly requiresConfirmation: boolean;
  
  /** Whether a safe experiment is recommended */
  readonly safeExperimentRecommended: boolean;
}

/** Risk policy for execution gate */
export interface RiskPolicy {
  /** Maximum risk level allowed without confirmation */
  readonly maxRiskWithoutConfirmation: RiskLevel;
  
  /** Risk levels that require safe experiment */
  readonly safeExperimentRequired: ReadonlyArray<RiskLevel>;
  
  /** Risk levels that are blocked entirely */
  readonly blockedRiskLevels: ReadonlyArray<RiskLevel>;
  
  /** Whether to allow HIGH risk with confirmation */
  readonly allowHighRiskWithConfirmation: boolean;
  
  /** Whether to allow CRITICAL risk at all */
  readonly allowCriticalRisk: boolean;
}

/** Default risk policy */
export const DEFAULT_RISK_POLICY: RiskPolicy = Object.freeze({
  maxRiskWithoutConfirmation: 'MEDIUM' as RiskLevel,
  safeExperimentRequired: Object.freeze(['HIGH', 'CRITICAL']) as ReadonlyArray<RiskLevel>,
  blockedRiskLevels: Object.freeze(['CRITICAL']) as ReadonlyArray<RiskLevel>,
  allowHighRiskWithConfirmation: true,
  allowCriticalRisk: false,
});
