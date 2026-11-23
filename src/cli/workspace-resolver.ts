import * as fs from 'fs/promises';
import * as path from 'path';
import { GlobalConfiguration } from '../core/configuration/global-configuration';

/**
 * Resolves the root directory for the current CLI execution.
 *
 * Resolution priority:
 *   0. AGENT_WORKSPACE_ROOT env var (if set) - used by tests
 *   1. If cwd is a valid workspace (has .ai directory), use cwd
 *   2. If a workspace was explicitly selected via `agent use`, use that path
 *   3. Otherwise, fall back to process.cwd()
 */
export async function resolveWorkspaceRoot(): Promise<string> {
  const envOverride = process.env.AGENT_WORKSPACE_ROOT;
  if (envOverride && envOverride.trim().length > 0) {
    return path.resolve(envOverride);
  }

  const cwd = process.cwd();

  try {
    const aiPath = path.join(cwd, '.ai');
    const stats = await fs.stat(aiPath);
    if (stats.isDirectory()) {
      return path.resolve(cwd);
    }
  } catch {
    // cwd is not a workspace, continue to next priority
  }

  const globalConfig = new GlobalConfiguration();
  const selected = await globalConfig.getCurrentWorkspace();
  if (selected) {
    return path.resolve(selected);
  }

  return path.resolve(cwd);
}
