import { AiContextDiscovery } from './ai-context';
import { ProjectProfile } from './project-profile';
import {
  freezeVersionIntelligenceContext,
  VersionIntelligenceContext,
} from './version-intelligence';

/**
 * Milestone A7 / E24: Context Cache Foundation & Version Intelligence
 *
 * Cached snapshot of project intelligence and resolved version knowledge.
 */

export type CacheInvalidationReasonType = 'explicit-refresh' | 'project-change';

export interface CacheInvalidationReason {
  readonly type: CacheInvalidationReasonType;
  readonly detail?: string;
}

export interface CachedProjectContext {
  readonly workspaceRoot: string;
  readonly projectProfile: ProjectProfile;
  readonly aiContext: AiContextDiscovery;
  readonly versionIntelligence?: VersionIntelligenceContext;
  readonly capabilities: ReadonlyArray<string>;
  readonly fingerprint: string;
  readonly cachedAt: string;
}

export function freezeCachedProjectContext(entry: CachedProjectContext): CachedProjectContext {
  return Object.freeze({
    workspaceRoot: entry.workspaceRoot,
    projectProfile: entry.projectProfile,
    aiContext: entry.aiContext,
    versionIntelligence: entry.versionIntelligence
      ? freezeVersionIntelligenceContext(entry.versionIntelligence)
      : undefined,
    capabilities: Object.freeze([...entry.capabilities]),
    fingerprint: entry.fingerprint,
    cachedAt: entry.cachedAt,
  });
}
