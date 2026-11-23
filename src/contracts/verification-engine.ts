import { VerificationStrategy } from '../domain/verification-strategy';
export interface VerificationCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly message?: string;
  readonly duration?: number;
}

export interface VerificationResult {
  readonly success: boolean;
  readonly checks: ReadonlyArray<VerificationCheck>;
  readonly errors: ReadonlyArray<string>;
  readonly timestamp: string;
}

/**
 * R2.6: VerificationEngine Contract
 * Verifies that applied patches are correct
 */
export interface VerificationEngine {
  verify(workspacePath: string, strategy?: VerificationStrategy): Promise<VerificationResult>;
}
