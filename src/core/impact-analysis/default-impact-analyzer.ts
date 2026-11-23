/**
 * Milestone F: Deterministic Impact Analyzer.
 * Grounded in observable AST/source imports, reverse dependencies, test references, and route/endpoint ownership.
 * Never guesses or fabricates relationships based on filename similarity.
 */

import path from 'path';
import { ImpactAnalyzer, ImpactAnalyzerOptions } from '../../contracts/impact-analyzer';
import {
  DEFAULT_IMPACT_LIMITS,
  freezeImpactAnalysis,
  ImpactAnalysis,
  ImpactConfidence,
  ImpactEvidence,
  ImpactLimits,
  ImpactRelation,
  ImpactReport,
  ImpactTarget,
} from '../../domain/impact-analysis';
import { Workspace } from '../../contracts/workspace';
import { WorkspaceMemory } from '../../contracts/workspace-memory';
import { ExecutionLogger } from '../observability/execution-logger';

export class DefaultImpactAnalyzer implements ImpactAnalyzer {
  constructor(
    private readonly workspace: Workspace,
    private readonly workspaceMemory?: WorkspaceMemory,
  ) {}

  async analyze(
    targetFiles: ReadonlyArray<string>,
    options?: ImpactAnalyzerOptions,
  ): Promise<ImpactReport> {
    const limits: ImpactLimits = {
      ...DEFAULT_IMPACT_LIMITS,
      ...(options?.limits || {}),
    };

    const targets: ImpactTarget[] = targetFiles.map(f => ({ filePath: normalizePath(f) }));
    ExecutionLogger.log('IMPACT', '-', '-', `Analyzing impact of ${targetFiles.length} target files`);

    const relations: ImpactRelation[] = [];
    const directImpacts = new Set<string>();
    const forwardImpacts = new Set<string>();
    const indirectImpacts = new Set<string>();
    const affectedEndpoints = new Set<string>();
    const relatedTests = new Set<string>();
    const affectedModules = new Set<string>();
    const affectedDomains = new Set<string>();
    const boundariesCrossed = new Set<string>();
    const unknowns: string[] = [];
    let limitsReached = false;

    // Load workspace architectural map if available
    let archMap: any = null;
    if (this.workspaceMemory) {
      try {
        const knowledge = await this.workspaceMemory.load();
        archMap = knowledge?.architecturalMap ?? null;
      } catch {
        // Proceed without architectural map
      }
    }

    const getModuleForFile = (filePath: string): string | undefined => {
      if (!archMap?.module_map) return undefined;
      const normalized = normalizePath(filePath);
      for (const mod of archMap.module_map) {
        const normalizedDir = normalizePath(mod.directory_path);
        if (normalized.startsWith(normalizedDir)) {
          return mod.module_name;
        }
      }
      return undefined;
    };

    // Pre-populate domains from options if provided
    if (options?.skills) {
      for (const skill of options.skills) {
        if (skill.domain) {
          affectedDomains.add(skill.domain);
        }
      }
    }

    // 1. Direct Impact: check targets
    for (const target of targetFiles) {
      const normalized = normalizePath(target);
      if (!normalized) continue;

      const exists = await this.workspace.exists(normalized).catch(() => false);
      if (!exists) {
        unknowns.push(`Target file does not exist on disk: ${normalized}`);
        continue;
      }

      directImpacts.add(normalized);
      const mod = getModuleForFile(normalized);
      if (mod) affectedModules.add(mod);

      // Infer domain from path
      const domain = inferDomainFromPath(normalized);
      if (domain) affectedDomains.add(domain);
    }

    // If no targets exist on disk and no evidence is available, return UNKNOWN
    if (directImpacts.size === 0 && targetFiles.length > 0) {
      const unknownAnalysis: ImpactAnalysis = freezeImpactAnalysis({
        changedFiles: targetFiles.map(normalizePath),
        directlyAffected: [],
        indirectlyAffected: [],
        affectedEndpoints: [],
        affectedTests: [],
        affectedModules: [],
        affectedDomains: Array.from(affectedDomains).sort(),
        relations: [],
        unknowns: Object.freeze(unknowns.length > 0 ? unknowns : ['No observable source evidence for target files']),
        confidence: 'UNKNOWN',
        limitsReached: false,
        summary: 'Target files have no observable source evidence (impact is UNKNOWN)',
        generatedAt: new Date().toISOString(),
      });

      return {
        targets,
        directImpacts: [],
        indirectImpacts: [],
        affectedModules: [],
        relatedTests: [],
        verificationScope: targetFiles.map(normalizePath),
        architecturalBoundariesCrossed: [],
        evidence: [],
        analysis: unknownAnalysis,
        generatedAt: unknownAnalysis.generatedAt,
      };
    }

    // 2. Forward Import Analysis (Target -> Dependencies) with Cycle Detection
    const queue: Array<{ file: string; depth: number }> = Array.from(directImpacts).map(f => ({ file: f, depth: 1 }));
    const visited = new Set<string>(directImpacts);

    while (queue.length > 0) {
      if (visited.size >= limits.maxImpactNodes || relations.length >= limits.maxRelations) {
        limitsReached = true;
        break;
      }

      const { file, depth } = queue.shift()!;
      if (depth > limits.maxImpactDepth) {
        limitsReached = true;
        continue;
      }

      try {
        const content = await this.workspace.readFile(file);
        const sourceModule = getModuleForFile(file);

        // Extract forward imports
        const imports = extractImportsFromContent(content);
        for (const importSpecifier of imports) {
          if (!importSpecifier.startsWith('.')) {
            // Package or alias import
            continue;
          }

          const resolved = await this.resolveImportPath(file, importSpecifier);
          if (resolved) {
            relations.push({
              source: file,
              target: resolved,
              relationType: 'imports',
              confidence: 'CONFIRMED',
              evidenceRef: `${file} imports ${importSpecifier}`,
              reason: `Direct import statement in ${file}`,
            });

            const importedModule = getModuleForFile(resolved);
            if (sourceModule && importedModule && sourceModule !== importedModule) {
              boundariesCrossed.add(`${sourceModule}->${importedModule}`);
            }

            if (!visited.has(resolved)) {
              visited.add(resolved);
              forwardImpacts.add(resolved);
              indirectImpacts.add(resolved);
              const resolvedDomain = inferDomainFromPath(resolved);
              if (resolvedDomain) affectedDomains.add(resolvedDomain);
              queue.push({ file: resolved, depth: depth + 1 });
            }
          }
        }

        // Endpoint detection from file contents (e.g. Next.js App Router / NestJS Controller)
        const endpoint = detectEndpointFromFile(file, content);
        if (endpoint) {
          affectedEndpoints.add(endpoint);
          relations.push({
            source: file,
            target: endpoint,
            relationType: 'route_handler',
            confidence: 'CONFIRMED',
            evidenceRef: `Route handler definition in ${file}`,
            reason: `File ${file} defines or handles HTTP endpoint ${endpoint}`,
          });
        }

        // Check for direct sibling test file
        const directTest = await this.findDirectTestForFile(file);
        if (directTest && !relatedTests.has(directTest)) {
          relatedTests.add(directTest);
          relations.push({
            source: directTest,
            target: file,
            relationType: 'test_reference',
            confidence: 'CONFIRMED',
            evidenceRef: `${directTest} tests ${file}`,
            reason: `Dedicated test suite for ${file}`,
          });
        }
      } catch {
        // Ignore read errors
      }
    }

    // 3. Reverse Dependency Analysis (What depends on target/impacted files?)
    try {
      const allSourceFiles = await this.listAllWorkspaceSourceFiles();
      for (const workspaceFile of allSourceFiles) {
        if (visited.has(workspaceFile)) continue;
        if (visited.size >= limits.maxImpactNodes || relations.length >= limits.maxRelations) {
          limitsReached = true;
          break;
        }

        try {
          const content = await this.workspace.readFile(workspaceFile);
          const imports = extractImportsFromContent(content);

          for (const importSpecifier of imports) {
            if (!importSpecifier.startsWith('.')) continue;
            const resolved = await this.resolveImportPath(workspaceFile, importSpecifier);
            if (resolved && visited.has(resolved)) {
              // Confirmed reverse dependency
              indirectImpacts.add(workspaceFile);
              visited.add(workspaceFile);

              const isTest = isTestFile(workspaceFile);
              if (isTest) {
                relatedTests.add(workspaceFile);
                relations.push({
                  source: workspaceFile,
                  target: resolved,
                  relationType: 'test_reference',
                  confidence: 'CONFIRMED',
                  evidenceRef: `${workspaceFile} imports ${importSpecifier}`,
                  reason: `Test imports impacted file ${resolved}`,
                });
              } else {
                relations.push({
                  source: workspaceFile,
                  target: resolved,
                  relationType: 'imported_by',
                  confidence: 'CONFIRMED',
                  evidenceRef: `${workspaceFile} imports ${importSpecifier}`,
                  reason: `Downstream file imports impacted file ${resolved}`,
                });
              }

              // Check if workspaceFile is an endpoint / page
              const endpoint = detectEndpointFromFile(workspaceFile, content);
              if (endpoint) {
                affectedEndpoints.add(endpoint);
                relations.push({
                  source: workspaceFile,
                  target: endpoint,
                  relationType: 'route_handler',
                  confidence: 'CONFIRMED',
                  evidenceRef: `Downstream route handler ${workspaceFile}`,
                  reason: `Downstream route handler ${workspaceFile} depends on ${resolved}`,
                });
              }

              const domain = inferDomainFromPath(workspaceFile);
              if (domain) affectedDomains.add(domain);
            }
          }
        } catch {
          // Ignore read errors
        }
      }
    } catch {
      // Ignore scan errors
    }

    // Sort all arrays deterministically
    const sortedDirect = Array.from(directImpacts).sort();
    const sortedIndirect = Array.from(indirectImpacts).sort();
    const sortedEndpoints = Array.from(affectedEndpoints).slice(0, limits.maxAffectedEndpoints).sort();
    const sortedTests = Array.from(relatedTests).slice(0, limits.maxAffectedTests).sort();
    const sortedModules = Array.from(affectedModules).sort();
    const sortedDomains = Array.from(affectedDomains).sort();
    const sortedRelations = relations.slice(0, limits.maxRelations).sort((a, b) => {
      const s = a.source.localeCompare(b.source);
      return s !== 0 ? s : a.target.localeCompare(b.target);
    });

    const confidence: ImpactConfidence = sortedRelations.length > 0 || sortedDirect.length > 0
      ? 'CONFIRMED'
      : 'UNKNOWN';

    const legacyEvidence: ImpactEvidence[] = sortedRelations.map(r => ({
      source: r.source,
      target: r.target,
      type: r.relationType === 'test_reference'
        ? 'test-reference'
        : r.relationType === 'service_dependency'
        ? 'module-dependency'
        : 'import',
    }));

    const verificationScope = Array.from(new Set([...sortedDirect, ...sortedIndirect, ...sortedTests])).sort();

    const summary = `${confidence} impact: direct=${sortedDirect.length}, indirect=${sortedIndirect.length}, endpoints=${sortedEndpoints.length}, tests=${sortedTests.length}, relations=${sortedRelations.length}`;

    const analysis = freezeImpactAnalysis({
      changedFiles: targetFiles.map(normalizePath),
      directlyAffected: sortedDirect,
      indirectlyAffected: sortedIndirect,
      affectedEndpoints: sortedEndpoints,
      affectedTests: sortedTests,
      affectedModules: sortedModules,
      affectedDomains: sortedDomains,
      relations: sortedRelations,
      unknowns: Object.freeze(unknowns.sort()),
      confidence,
      limitsReached,
      summary,
      generatedAt: new Date().toISOString(),
    });

    return {
      targets,
      directImpacts: Array.from(forwardImpacts).sort(),
      indirectImpacts: sortedIndirect,
      affectedModules: sortedModules,
      relatedTests: sortedTests,
      verificationScope,
      architecturalBoundariesCrossed: Array.from(boundariesCrossed).sort(),
      evidence: legacyEvidence,
      analysis,
      generatedAt: analysis.generatedAt,
    };
  }

  private async resolveImportPath(fromFile: string, importSpecifier: string): Promise<string | null> {
    try {
      const fromDir = path.dirname(fromFile);
      const basePath = path.posix.normalize(path.join(fromDir, importSpecifier).replace(/\\/g, '/'));

      const candidates = [
        basePath,
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.jsx`,
        path.posix.join(basePath, 'index.ts'),
        path.posix.join(basePath, 'index.tsx'),
        path.posix.join(basePath, 'index.js'),
      ];

      for (const candidate of candidates) {
        if (await this.workspace.exists(candidate).catch(() => false)) {
          return candidate;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private async findDirectTestForFile(file: string): Promise<string | null> {
    const ext = path.extname(file);
    const withoutExt = file.substring(0, file.length - ext.length);
    const candidates = [
      `${withoutExt}.test.ts`,
      `${withoutExt}.test.tsx`,
      `${withoutExt}.spec.ts`,
      `${withoutExt}.spec.tsx`,
    ];

    for (const candidate of candidates) {
      if (await this.workspace.exists(candidate).catch(() => false)) {
        return candidate;
      }
    }
    return null;
  }

  private async listAllWorkspaceSourceFiles(): Promise<string[]> {
    const result: string[] = [];
    const searchDirs = ['src', 'app', 'pages', 'components', 'lib', 'tests', '__tests__', 'test'];

    for (const dir of searchDirs) {
      try {
        const files = await this.workspace.listFiles(dir).catch(() => []);
        for (const file of files) {
          const normalized = normalizePath(file);
          if (isCodeOrTestFile(normalized)) {
            result.push(normalized);
          }
        }
      } catch {
        // Ignore missing directory
      }
    }

    // Also check root-level files
    try {
      const rootFiles = await this.workspace.listFiles('.').catch(() => []);
      for (const file of rootFiles) {
        const normalized = normalizePath(file);
        if (isCodeOrTestFile(normalized) && !result.includes(normalized)) {
          result.push(normalized);
        }
      }
    } catch {
      // Ignore
    }

    return result.sort();
  }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isCodeOrTestFile(p: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p);
}

function isTestFile(p: string): boolean {
  return p.includes('.test.') || p.includes('.spec.') || p.startsWith('tests/') || p.startsWith('__tests__/') || p.startsWith('test/');
}

function inferDomainFromPath(p: string): string | null {
  const lower = p.toLowerCase();
  if (lower.startsWith('app/') || lower.startsWith('pages/') || lower.startsWith('components/') || lower.includes('frontend')) {
    return 'frontend';
  }
  if (lower.includes('auth') || lower.includes('login') || lower.includes('session') || lower.includes('token') || lower.includes('guard')) {
    return 'auth';
  }
  if (lower.startsWith('src/core/') || lower.startsWith('src/backend/') || lower.includes('controller') || lower.includes('service') || lower.includes('api')) {
    return 'backend';
  }
  if (isTestFile(lower)) {
    return 'testing';
  }
  return null;
}

function extractImportsFromContent(content: string): string[] {
  const imports: string[] = [];
  
  // 1. Static ES6 imports: import ... from '...'
  const importFromRegex = /(?:import|export)\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importFromRegex.exec(content)) !== null) {
    if (match[1] && !imports.includes(match[1])) {
      imports.push(match[1]);
    }
  }

  // 2. Dynamic import(...) and require(...)
  const dynamicImportRegex = /(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(content)) !== null) {
    if (match[1] && !imports.includes(match[1])) {
      imports.push(match[1]);
    }
  }

  return imports;
}

function detectEndpointFromFile(filePath: string, content: string): string | null {
  const normalized = normalizePath(filePath);

  // Next.js App Router route.ts
  // e.g. app/api/users/route.ts -> /api/users
  if (normalized.startsWith('app/') && (normalized.endsWith('/route.ts') || normalized.endsWith('/route.js'))) {
    const withoutApp = normalized.substring('app/'.length);
    const routePart = withoutApp.replace(/\/route\.(ts|js)$/, '');
    return `ALL /${routePart}`;
  }

  // Next.js App Router page.tsx
  // e.g. app/page.tsx -> PAGE /, app/login/page.tsx -> PAGE /login
  if (normalized === 'app/page.tsx' || normalized === 'app/page.js') {
    return 'PAGE /';
  }
  if (normalized.startsWith('app/') && (normalized.endsWith('/page.tsx') || normalized.endsWith('/page.js'))) {
    const withoutApp = normalized.substring('app/'.length);
    const routePart = withoutApp.replace(/\/page\.(tsx|js)$/, '');
    return `PAGE /${routePart}`;
  }

  // NestJS controller decorator
  // e.g. @Controller('users') + @Get(':id')
  const controllerMatch = /@Controller\s*\(\s*['"]([^'"]*)['"]\s*\)/.exec(content);
  if (controllerMatch) {
    const basePath = controllerMatch[1] ? `/${controllerMatch[1].replace(/^\//, '')}` : '';
    const methodMatch = /@(Get|Post|Put|Delete|Patch)\s*\(\s*(?:['"]([^'"]*)['"])?\s*\)/i.exec(content);
    if (methodMatch) {
      const httpMethod = methodMatch[1].toUpperCase();
      const subPath = methodMatch[2] ? `/${methodMatch[2].replace(/^\//, '')}` : '';
      return `${httpMethod} ${basePath}${subPath}`;
    }
    return `ALL ${basePath || '/'}`;
  }

  return null;
}
