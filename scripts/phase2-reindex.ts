import { AppFactory } from '../src/core/app-factory';

async function main(): Promise<void> {
  const root = process.argv[2] || 'E:/agentic-r9-real-project';
  const factory = new AppFactory(root, {
    debug() {},
    info() {},
    warn() {},
    error: console.error,
  });
  const graph = await factory.createStructuralGraphIndexer().indexAndPersist();
  const taskListEdge = graph.edges.find(
    e => e.kind === 'imports'
      && e.from === 'components/TaskList.tsx'
      && e.to === 'components/TaskCard.tsx',
  );
  console.log(JSON.stringify({
    files: graph.meta.fileCount,
    hash: graph.meta.contentHash,
    hasTaskListToCard: Boolean(taskListEdge),
  }));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
