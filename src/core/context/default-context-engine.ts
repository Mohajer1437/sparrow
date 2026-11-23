import { ContextEngine } from '../../contracts/context';
import { ContextRequest, ContextObject } from '../../domain/context';
import { ContextSelector } from './context-selector';
import { ContextLimiter } from './context-limiter';
import { ContextBuilder } from './context-builder';
import { ContextFreezer } from './context-freezer';
import { MemoryPolicy } from '../../contracts/policies/memory-policy';
import { ContextOptimizer } from '../../contracts/context-optimizer';
import { OptimizationOptions } from '../../domain/context-optimization';

export class DefaultContextEngine implements ContextEngine {
  constructor(
    private readonly selector: ContextSelector,
    private readonly memoryPolicy: MemoryPolicy,
    private readonly limiter: ContextLimiter,
    private readonly builder: ContextBuilder,
    private readonly freezer: ContextFreezer,
    private readonly optimizer?: ContextOptimizer
  ) {}

  async buildContext(request: ContextRequest): Promise<ContextObject> {
    const selected = await this.selector.select(request);
    
    const filteredMemories = this.memoryPolicy.filter(selected.memories);
    const selectedWithFilteredMemories = {
      ...selected,
      memories: filteredMemories
    };
    
    const limited = this.limiter.limit(selectedWithFilteredMemories);
    const built = this.builder.build(request, limited);
    const frozen = this.freezer.freeze(built);
    
    if (this.optimizer) {
      const options: OptimizationOptions = {
        maxContextChars: 8000,
      };
      const result = await this.optimizer.optimize(frozen, options);
      return result.optimizedContext;
    }
    
    return frozen;
  }
}
