/**
 * CLI: build deterministic structural knowledge index (no LLM).
 *
 * Usage:
 *   agent index-structural
 *   agent index-structural --json
 */

import { AppFactory } from '../../core/app-factory';
import { Logger } from '../../contracts/logger';
import { resolveWorkspaceRoot } from '../workspace-resolver';
import { STRUCTURAL_GRAPH_RELATIVE_PATH } from '../../domain/structural-knowledge';

export async function indexStructuralCommand(args: string[] = []): Promise<void> {
  const asJson = args.includes('--json');
  const workspaceRoot = await resolveWorkspaceRoot();
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: console.warn,
    error: console.error,
  };
  const factory = new AppFactory(workspaceRoot, logger);
  const indexer = factory.createStructuralGraphIndexer();

  if (!asJson) {
    console.log('Structural Graph Indexer (deterministic, LLM-free)');
    console.log(`Workspace: ${workspaceRoot}`);
    console.log('');
  }

  const graph = await indexer.indexAndPersist();

  if (asJson) {
    console.log(JSON.stringify({
      ok: true,
      path: `.ai/${STRUCTURAL_GRAPH_RELATIVE_PATH}`,
      meta: graph.meta,
    }, null, 2));
    return;
  }

  console.log('Indexed successfully.');
  console.log(`  Output:     .ai/${STRUCTURAL_GRAPH_RELATIVE_PATH}`);
  console.log(`  Files:      ${graph.meta.fileCount}`);
  console.log(`  Nodes:      ${graph.meta.nodeCount}`);
  console.log(`  Edges:      ${graph.meta.edgeCount}`);
  console.log(`  Roots:      ${graph.meta.roots.join(', ')}`);
  console.log(`  ContentHash:${graph.meta.contentHash}`);
  console.log(`  Schema:     ${graph.meta.schemaVersion}`);
  console.log(`  Mode:       ${graph.meta.generationMode}`);

  const importEdges = graph.edges.filter(e => e.kind === 'imports').slice(0, 8);
  if (importEdges.length > 0) {
    console.log('');
    console.log('Sample import edges:');
    for (const e of importEdges) {
      console.log(`  ${e.from} → ${e.to}`);
    }
  }
}
