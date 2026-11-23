import { AppFactory } from '../../../core/app-factory';
import { Logger } from '../../../contracts/logger';
import { KnowledgePipeline } from '../knowledge-pipeline';

const logger: Logger = {
  debug: (msg: string) => console.log(`[DEBUG] ${msg}`),
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
}

async function main() {
  console.log('\n╔' + '═'.repeat(68) + '╗');
  console.log('║  🧪 KNOWLEDGE PIPELINE - CHUNKED + INCREMENTAL'.padEnd(69) + '║');
  console.log('║  First run: chunked generation'.padEnd(69) + '║');
  console.log('║  Subsequent runs: incremental updates (90% token savings!)'.padEnd(69) + '║');
  console.log('╚' + '═'.repeat(68) + '╝\n');

  const factory = new AppFactory(process.cwd(), logger);

  console.log('✅ AppFactory created');
  console.log('📂 Working directory:', process.cwd());
  console.log('🎯 Model: gpt-oss:120b-cloud');
  console.log('🔧 Tools: 7 workspace tools\n');

  const pipeline = new KnowledgePipeline(
    factory.createRuntimeRepository(),
    factory.createTaskExecutor(),
    factory.createWorkspace(),
    factory.createToolDefinitions(),
    'qwen3-32b'
  );

  const startTime = Date.now();

  console.log('═'.repeat(70));
  console.log('🚀 EXECUTING KNOWLEDGE PIPELINE');
  console.log('═'.repeat(70));

  const result = await pipeline.execute();

  const totalDuration = Date.now() - startTime;

  console.log('\n' + '═'.repeat(70));
  console.log('📊 FINAL SUMMARY');
  console.log('═'.repeat(70));

  if (result.success) {
    console.log('✅ SUCCESS');
    console.log(`   Total time: ${formatDuration(totalDuration)}`);
    console.log(`\n📁 Generated files:`);
    console.log(`   - ${result.files.architecturalMap}`);
    console.log(`   - ${result.files.codebaseMap}`);
    console.log(`   - ${result.files.knowledgeBase}`);

    if (result.modes) {
      console.log(`\n🎯 Generation modes:`);
      console.log(`   Architectural Map: ${result.modes.architecturalMap}`);
      console.log(`   Codebase Map:      ${result.modes.codebaseMap}`);
      console.log(`   Knowledge Base:    ${result.modes.knowledgeBase}`);
    }

    console.log('\n💡 Next run will use INCREMENTAL mode (faster + cheaper)!');
  } else {
    console.log('❌ FAILED');
    if (result.errors && result.errors.length > 0) {
      console.log(`\nErrors:`);
      result.errors.forEach((err, i) => {
        console.log(`   ${i + 1}. ${err}`);
      });
    }
    process.exit(1);
  }

  console.log('═'.repeat(70));
}

main().catch((err) => {
  console.error('\n💥 Fatal error:', err);
  process.exit(1);
});
