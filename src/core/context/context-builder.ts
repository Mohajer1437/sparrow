import { ContextObject, ContextRequest } from '../../domain/context';
import { SelectedContext } from './context-selector';

export class ContextBuilder {
  build(request: ContextRequest, selected: SelectedContext, roleMemory?: string): ContextObject {
    return {
      taskIntent: request.task,
      rules: selected.rules,
      knowledge: selected.knowledge,
      memories: selected.memories,
      files: selected.files,
      roleMemory,
    };
  }
}
