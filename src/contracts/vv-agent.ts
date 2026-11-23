import { ProductAnalysis, ProductValidationRequest } from '../domain/product-analysis';
import { VerificationReport, VerificationRequest } from '../domain/verification-report';

export interface VerificationValidationAgent {
  analyzeIntent(request: ProductValidationRequest): Promise<ProductAnalysis>;
  verify(request: VerificationRequest): Promise<VerificationReport>;
}
