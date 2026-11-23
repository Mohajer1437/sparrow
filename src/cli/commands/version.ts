/**
 * CLI / REPL inspection command for Version Intelligence (Milestone E.27).
 * Reports detected dependencies, exact/normalized versions, lockfile awareness,
 * effective version knowledge, project overrides, stale status, and conflicts.
 */

import * as path from 'path';
import { AppFactory } from '../../core/app-factory';
import { Logger } from '../../contracts/logger';
import { resolveWorkspaceRoot } from '../workspace-resolver';

export async function versionCommand(args: string[] = []): Promise<void> {
  const targetDir = args[0] ? path.resolve(args[0]) : await resolveWorkspaceRoot();
  const logger: Logger = { debug: () => {}, info: () => {}, warn: console.warn, error: console.error };
  const factory = new AppFactory(targetDir, logger);
  const projectContextService = factory.createProjectContextService();

  console.log('Project Version Intelligence:');
  console.log(`Workspace: ${targetDir}`);
  console.log('');

  try {
    const cached = await projectContextService.load(targetDir, { refresh: true });
    const vi = cached.versionIntelligence;

    if (!vi || (vi.dependencies.length === 0 && vi.effectiveKnowledge.length === 0)) {
      console.log('No package dependencies or version knowledge found.');
      return;
    }

    console.log(`Summary: ${vi.summary}`);
    console.log('');

    console.log(`Detected Dependencies (${vi.dependencies.length}):`);
    for (const dep of vi.dependencies) {
      const decl = dep.declaredVersion ?? 'none';
      const res = dep.resolvedVersion ?? 'unresolved';
      console.log(`  - ${dep.name} (${dep.normalizedName}, ${dep.category}): declared=${decl}, resolved=${res}, source=${dep.versionSource}`);
    }
    console.log('');

    console.log(`Effective Version Knowledge (${vi.effectiveKnowledge.length}):`);
    for (const ek of vi.effectiveKnowledge) {
      console.log(`  * Technology: ${ek.technology} (version=${ek.normalizedVersion}, status=${ek.status}, source=${ek.effectiveSource})`);
      console.log(`    summary: ${ek.summary}`);
      console.log(`    provenance: ${ek.provenance}`);
      if (ek.overridePath) {
        console.log(`    overridePath: ${ek.overridePath}`);
      }
      if (ek.staleReason) {
        console.log(`    STALE WARNING: ${ek.staleReason}`);
      }
      if (ek.conflictReason) {
        console.log(`    CONFLICT NOTE: ${ek.conflictReason}`);
      }
      if (ek.guidance.length > 0) {
        console.log('    guidance:');
        for (const g of ek.guidance) {
          console.log(`      - ${g}`);
        }
      }
      if (ek.compatibilityNotes && ek.compatibilityNotes.length > 0) {
        console.log('    compatibility:');
        for (const c of ek.compatibilityNotes) {
          console.log(`      - ${c}`);
        }
      }
    }
    console.log('');

    if (vi.staleItems.length > 0) {
      console.log(`Stale Project Knowledge (${vi.staleItems.length}):`);
      for (const stale of vi.staleItems) {
        console.log(`  ! [STALE] ${stale.technology}: installed=${stale.installedVersion}, target=${stale.declaredApplicableVersion ?? 'unspecified'} in ${stale.overridePath} (${stale.reason})`);
      }
      console.log('');
    }

    if (vi.conflicts.length > 0) {
      console.log(`Knowledge Conflicts (${vi.conflicts.length}):`);
      for (const conflict of vi.conflicts) {
        console.log(`  ~ [CONFLICT] ${conflict.technology} (${conflict.resolvedVersion ?? 'unknown'}): ${conflict.resolution}`);
      }
      console.log('');
    }
  } catch (error: any) {
    console.error(`Error loading version intelligence: ${error.message}`);
  }
}
