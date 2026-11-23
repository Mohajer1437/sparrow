import * as path from 'path';
import { AiContextLoader } from '../../contracts/ai-context';
import {
  CacheInvalidationPolicy,
  ContextCache,
  ProjectContextLoadOptions,
  ProjectContextService,
  ProjectFingerprinter,
} from '../../contracts/context-cache';
import { ProjectDetector } from '../../contracts/project-detector';
import { CachedProjectContext, freezeCachedProjectContext } from '../../domain/project-context-cache';
import { GlobalVersionKnowledgeRegistry } from '../version/global-knowledge';
import { ProjectOverrideLoader } from '../version/project-override-loader';
import { VersionKnowledgeResolver } from '../version/version-knowledge-resolver';
import { FingerprintInvalidationPolicy } from './in-memory-context-cache';

export class DefaultProjectContextService implements ProjectContextService {
  private readonly invalidationPolicy: CacheInvalidationPolicy;
  private readonly overrideLoader: ProjectOverrideLoader;
  private readonly versionResolver: VersionKnowledgeResolver;

  constructor(
    private readonly detector: ProjectDetector,
    private readonly aiContextLoader: AiContextLoader,
    private readonly cache: ContextCache,
    private readonly fingerprinter: ProjectFingerprinter,
    invalidationPolicy?: CacheInvalidationPolicy,
    registry?: GlobalVersionKnowledgeRegistry,
    overrideLoader?: ProjectOverrideLoader,
  ) {
    this.invalidationPolicy = invalidationPolicy
      ?? new FingerprintInvalidationPolicy(root => this.fingerprinter.compute(root));
    this.overrideLoader = overrideLoader ?? new ProjectOverrideLoader();
    const knowledgeRegistry = registry ?? new GlobalVersionKnowledgeRegistry();
    this.versionResolver = new VersionKnowledgeResolver(knowledgeRegistry);
  }

  async load(workspaceRoot: string, options: ProjectContextLoadOptions = {}): Promise<CachedProjectContext> {
    const root = path.resolve(workspaceRoot);

    if (options.refresh) {
      this.cache.invalidate(root);
      this.cache.invalidateFiles(root);
    } else {
      const cached = this.cache.get(root);
      if (cached) {
        const stale = await this.invalidationPolicy.shouldInvalidate(root, cached);
        if (!stale) {
          return cached;
        }
        this.cache.invalidate(root);
      }
    }

    return this.buildAndStore(root);
  }

  async refresh(workspaceRoot: string): Promise<CachedProjectContext> {
    return this.load(workspaceRoot, { refresh: true });
  }

  private async buildAndStore(root: string): Promise<CachedProjectContext> {
    const projectProfile = await this.detector.detect(root);
    const aiContext = await this.aiContextLoader.discover(root);
    const fingerprint = await this.fingerprinter.compute(root);

    // Resolve version intelligence
    const projectOverrides = await this.overrideLoader.loadOverrides(root);
    const dependencies = projectProfile.dependencies ?? [];
    const versionIntelligence = this.versionResolver.resolve({
      dependencies,
      projectOverrides,
    });

    const snapshot = freezeCachedProjectContext({
      workspaceRoot: root,
      projectProfile,
      aiContext,
      versionIntelligence,
      capabilities: projectProfile.capabilities,
      fingerprint,
      cachedAt: new Date().toISOString(),
    });

    this.cache.set(root, snapshot);
    return snapshot;
  }
}
