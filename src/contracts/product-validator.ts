import { ProductAnalysis, ProductValidationRequest } from '../domain/product-analysis';

export interface ProductValidator {
  analyze(request: ProductValidationRequest): Promise<ProductAnalysis>;
}
