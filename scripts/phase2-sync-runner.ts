/**
 * One-shot Phase 2 sync runner for evidence collection.
 * Usage: npx tsx scripts/phase2-sync-runner.ts <workspaceRoot> <targetPath> <outDir> <mode>
 */
import * as fs from 'fs';
import * as path from 'path';
import { AppFactory } from '../src/core/app-factory';

async function main(): Promise<void> {
  const workspaceRoot = process.argv[2];
  const target = process.argv[3];
  const auditDir = process.argv[4];
  const mode = process.argv[5] || 'modify';
  const candidatesArg = process.argv[6];
  const candidates = candidatesArg
    ? candidatesArg.split(',').map(s => s.trim()).filter(Boolean)
    : (target ? [target] : []);

  const logger = {
    debug() {},
    info() {},
    warn: console.warn,
    error: console.error,
  };
  const factory = new AppFactory(workspaceRoot, logger);
  const sync = factory.createKnowledgeSynchronizer();
  const indexer = factory.createStructuralGraphIndexer();

  const before = await indexer.load();
  const outcome =
    mode === 'rollback' ? 'rolled_back'
      : mode === 'failed' ? 'failed'
        : mode === 'no-mutation' ? 'success'
          : 'success';

  const result = await sync.sync({
    sessionId: 'phase2-runtime',
    stepId: `step-${mode}`,
    candidatePaths: mode === 'no-mutation' ? [] : candidates,
    outcome: outcome as 'success' | 'failed' | 'rolled_back' | 'skipped',
  });
  const after = await indexer.load();

  const payload = {
    mode,
    target,
    candidates,
    result: {
      ok: result.ok,
      skipped: result.skipped,
      reason: result.reason,
      fallbackUsed: result.fallbackUsed,
      fallbackReason: result.fallbackReason,
      repositoryFileCount: result.repositoryFileCount,
      affectedFileCount: result.affectedFileCount,
      analyzedFileCount: result.analyzedFileCount,
      analyzedPaths: result.analyzedPaths,
      changedNodes: result.changedNodes,
      changedEdges: result.changedEdges,
      stale: result.stale,
    },
    beforeContentHash: before?.meta.contentHash ?? null,
    afterContentHash: after?.meta.contentHash ?? null,
    beforeNode: before?.nodes.find(n => n.path === target) ?? null,
    afterNode: after?.nodes.find(n => n.path === target) ?? null,
    beforeImportEdges: before?.edges.filter(e => e.kind === 'imports' && (e.from === target || e.to === target)) ?? [],
    afterImportEdges: after?.edges.filter(e => e.kind === 'imports' && (e.from === target || e.to === target)) ?? [],
    syncState: result.syncState,
  };

  fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(path.join(auditDir, 'sync-result.json'), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: result.ok,
    skipped: result.skipped,
    analyzed: result.analyzedFileCount,
    affected: result.affectedFileCount,
    repoFiles: result.repositoryFileCount,
    fallback: result.fallbackUsed,
    contentHash: after?.meta.contentHash ?? null,
  }));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
