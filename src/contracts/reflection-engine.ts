import { WorkspaceSession } from '../domain/workspace-session';
import { Reflection } from '../domain/reflection';

export interface ReflectionEngine {
  generate(session: WorkspaceSession): Reflection;
}
