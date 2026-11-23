import { ContextRequest, ContextObject } from '../domain/context';

// Re-export for backward compatibility with other contracts (e.g., prompt.ts)
export { ContextObject, ContextRequest };

export interface ContextEngine {
  buildContext(request: ContextRequest): Promise<ContextObject>;
}
