import { ContextObject } from '../domain/context';
import { ContextOptimizationResult, OptimizationOptions } from '../domain/context-optimization';

export interface ContextOptimizer {
  optimize(context: ContextObject, options?: OptimizationOptions): Promise<ContextOptimizationResult>;
}
