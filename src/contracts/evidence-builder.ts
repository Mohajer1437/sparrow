/**
 * G.2: EvidenceBuilder Contract
 */

import {
  Evidence,
  EvidenceType,
  EvidenceCollectionRequest,
  EvidenceCollectionResult,
  Hypothesis,
} from '../domain/pre-execution/evidence';
import { PlannerAllowedTargets } from '../domain/planner-allowed-targets';

export interface EvidenceBuilder {
  collect(request: EvidenceCollectionRequest): Promise<EvidenceCollectionResult>;
  verify(evidence: Evidence): Promise<boolean>;
  hasSufficientEvidence(hypothesis: Hypothesis): Promise<boolean>;
  generateAllowedTargets?(evidence?: ReadonlyArray<Evidence>, plannerContext?: any): PlannerAllowedTargets;
}
