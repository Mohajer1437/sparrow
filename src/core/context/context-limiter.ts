import { ContextLimits } from '../../domain/context-limits';
import { SelectedContext } from './context-selector';

export class ContextLimiter {
  constructor(private readonly limits: ContextLimits) {}

  limit(selected: SelectedContext): SelectedContext {
    return {
      rules: selected.rules.slice(0, this.limits.rules),
      knowledge: selected.knowledge.slice(0, this.limits.knowledge),
      memories: selected.memories.slice(0, this.limits.memory),
      files: selected.files.slice(0, this.limits.files)
    };
  }
}
