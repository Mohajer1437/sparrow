/**
 * G.2: DefaultEvidenceBuilder — Evidence Collection
 * FIXED: Uses rootPath from constructor
 */

import { EvidenceBuilder } from '../../contracts/evidence-builder';
import {
  Evidence,
  EvidenceType,
  EvidenceStatus,
  EvidenceCollectionRequest,
  EvidenceCollectionResult,
  Hypothesis,
} from '../../domain/pre-execution/evidence';
import { Workspace } from '../../contracts/workspace';
import { canonicalizeWorkspaceRoot, resolveWorkspacePath, WorkspacePathError } from '../workspace/workspace-paths';
import { PlannerAllowedTargets, createPlannerAllowedTargets } from '../../domain/planner-allowed-targets';

export class DefaultEvidenceBuilder implements EvidenceBuilder {
  private readonly rootPath: string;

  constructor(
    private readonly workspace: Workspace,
    rootPath: string,
  ) {
    this.rootPath = canonicalizeWorkspaceRoot(rootPath);
  }

  generateAllowedTargets(
    evidence?: ReadonlyArray<Evidence>,
    plannerContext?: any,
  ): PlannerAllowedTargets {
    return createPlannerAllowedTargets({
      evidence,
      plannerContext,
    });
  }

  async collect(request: EvidenceCollectionRequest): Promise<EvidenceCollectionResult> {
    const evidence: Evidence[] = [];

    for (const type of request.evidenceTypes) {
      for (const target of request.targets) {
        const ev = await this.collectSingle(type, target);
        evidence.push(ev);
      }
    }

    return Object.freeze({
      evidence: Object.freeze(evidence),
      hypothesesUpdated: Object.freeze([]),
      stillMissing: Object.freeze([]),
    });
  }

  async verify(evidence: Evidence): Promise<boolean> {
    const reCollected = await this.collectSingle(evidence.type, evidence.source || '');
    return reCollected.status === 'CONFIRMED' && reCollected.observation === evidence.observation;
  }

  async hasSufficientEvidence(hypothesis: Hypothesis): Promise<boolean> {
    for (const requiredType of hypothesis.requiredEvidenceTypes) {
      const matchingEvidence = hypothesis.evidence.find(
        e => e.type === requiredType && e.status === 'CONFIRMED',
      );
      if (!matchingEvidence) return false;
    }
    return true;
  }

  private async collectSingle(type: EvidenceType, target: string): Promise<Evidence> {
    const id = `evidence-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    switch (type) {
      case 'FILE_EXISTS':
        return this.checkFileExists(id, target);
      case 'FILE_CONTENT':
        return this.readFileContent(id, target);
      case 'DIRECTORY_STRUCTURE':
        return this.scanDirectory(id, target);
      case 'CONFIG_VALUE':
        return this.readConfigValue(id, target);
      case 'DEPENDENCY_INSTALLED':
        return this.checkDependency(id, target);
      case 'FRAMEWORK_DETECTED':
        return this.detectFramework(id, target);
      case 'ERROR_MESSAGE':
        return this.captureError(id, target);
      default:
        return this.createUnsupportedEvidence(id, type, target);
    }
  }

  private async checkFileExists(id: string, filePath: string): Promise<Evidence> {
    try {
      const resolved = resolveWorkspacePath(this.rootPath, filePath);
      const exists = await this.workspace.exists(resolved.relative);
      if (!exists) {
        return Object.freeze({
          id, type: 'FILE_EXISTS',
          description: `File exists: ${resolved.relative}`,
          status: 'NOT_FOUND',
          observation: `File not found in workspace: ${resolved.absolute}`,
          source: resolved.relative,
          collectedAt: new Date().toISOString(),
        });
      }
      return Object.freeze({
        id, type: 'FILE_EXISTS',
        description: `File exists: ${resolved.relative}`,
        status: 'CONFIRMED',
        observation: `File found: ${resolved.absolute}`,
        source: resolved.relative,
        collectedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      const status: EvidenceStatus = error instanceof WorkspacePathError && error.code === 'TRAVERSAL'
        ? 'ERROR'
        : 'NOT_FOUND';
      return Object.freeze({
        id, type: 'FILE_EXISTS',
        description: `File exists: ${filePath}`,
        status,
        observation: error?.message || String(error),
        source: filePath,
        error: error?.message,
        collectedAt: new Date().toISOString(),
      });
    }
  }

  private async readFileContent(id: string, filePath: string): Promise<Evidence> {
    try {
      const resolved = resolveWorkspacePath(this.rootPath, filePath);
      const content = await this.workspace.readFile(resolved.relative);
      return Object.freeze({
        id, type: 'FILE_CONTENT',
        description: `File content: ${resolved.relative}`,
        status: 'CONFIRMED',
        observation: content.substring(0, 1000),
        source: resolved.relative,
        collectedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      return Object.freeze({
        id, type: 'FILE_CONTENT',
        description: `File content: ${filePath}`,
        status: 'ERROR',
        error: error.message,
        source: filePath,
        collectedAt: new Date().toISOString(),
      });
    }
  }

  private async scanDirectory(id: string, dirPath: string): Promise<Evidence> {
    try {
      const resolved = resolveWorkspacePath(this.rootPath, dirPath);
      const entries = await this.workspace.listEntries(resolved.relative);
      const structure = entries.map(name => name.endsWith('/') ? `[DIR] ${name.slice(0, -1)}` : `[FILE] ${name}`).join('\n');
      return Object.freeze({
        id, type: 'DIRECTORY_STRUCTURE',
        description: `Directory structure: ${resolved.relative}`,
        status: 'CONFIRMED',
        observation: structure,
        source: resolved.relative,
        collectedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      return Object.freeze({
        id, type: 'DIRECTORY_STRUCTURE',
        description: `Directory structure: ${dirPath}`,
        status: 'ERROR',
        error: error.message,
        source: dirPath,
        collectedAt: new Date().toISOString(),
      });
    }
  }

  private async readPackageJson(): Promise<any> {
    const content = await this.workspace.readFile('package.json');
    return JSON.parse(content);
  }

  private async readConfigValue(id: string, configKey: string): Promise<Evidence> {
    try {
      const pkg = await this.readPackageJson();
      const keys = configKey.split('.');
      let value: any = pkg;
      for (const key of keys) {
        value = value?.[key];
      }
      return Object.freeze({
        id, type: 'CONFIG_VALUE',
        description: `Config value: ${configKey}`,
        status: 'CONFIRMED',
        observation: JSON.stringify(value),
        source: `package.json:${configKey}`,
        collectedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      return Object.freeze({
        id, type: 'CONFIG_VALUE',
        description: `Config value: ${configKey}`,
        status: 'ERROR',
        error: error.message,
        source: `package.json:${configKey}`,
        collectedAt: new Date().toISOString(),
      });
    }
  }

  private async checkDependency(id: string, packageName: string): Promise<Evidence> {
    try {
      const pkg = await this.readPackageJson();
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const version = allDeps[packageName];
      if (version) {
        return Object.freeze({
          id, type: 'DEPENDENCY_INSTALLED',
          description: `Dependency: ${packageName}`,
          status: 'CONFIRMED',
          observation: `Version: ${version}`,
          source: `package.json:dependencies.${packageName}`,
          collectedAt: new Date().toISOString(),
        });
      } else {
        return Object.freeze({
          id, type: 'DEPENDENCY_INSTALLED',
          description: `Dependency: ${packageName}`,
          status: 'NOT_FOUND',
          observation: 'Package not found in dependencies',
          source: 'package.json',
          collectedAt: new Date().toISOString(),
        });
      }
    } catch (error: any) {
      return Object.freeze({
        id, type: 'DEPENDENCY_INSTALLED',
        description: `Dependency: ${packageName}`,
        status: 'ERROR',
        error: error.message,
        source: 'package.json',
        collectedAt: new Date().toISOString(),
      });
    }
  }

  private async detectFramework(id: string, frameworkName: string): Promise<Evidence> {
    try {
      const pkg = await this.readPackageJson();
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const installed = allDeps[frameworkName] !== undefined;
      return Object.freeze({
        id, type: 'FRAMEWORK_DETECTED',
        description: `Framework: ${frameworkName}`,
        status: installed ? 'CONFIRMED' : 'NOT_FOUND',
        observation: installed ? `Framework ${frameworkName} is installed` : `Framework ${frameworkName} not found`,
        source: 'package.json',
        collectedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      return Object.freeze({
        id, type: 'FRAMEWORK_DETECTED',
        description: `Framework: ${frameworkName}`,
        status: 'ERROR',
        error: error.message,
        source: 'package.json',
        collectedAt: new Date().toISOString(),
      });
    }
  }

  private async captureError(id: string, errorMessage: string): Promise<Evidence> {
    return Object.freeze({
      id, type: 'ERROR_MESSAGE',
      description: 'Error message',
      status: 'CONFIRMED',
      observation: errorMessage,
      source: 'user_provided',
      collectedAt: new Date().toISOString(),
    });
  }

  private createUnsupportedEvidence(id: string, type: EvidenceType, target: string): Evidence {
    return Object.freeze({
      id, type,
      description: `Evidence type ${type} not yet implemented`,
      status: 'SKIPPED',
      source: target,
      collectedAt: new Date().toISOString(),
    });
  }
}
