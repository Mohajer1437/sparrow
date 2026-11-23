import { AppFactory } from '../../app-factory';
import { Logger } from '../../../contracts/logger';

const logger: Logger = {
  debug: (msg: string) => console.log(`[DEBUG] ${msg}`),
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
};

async function checkOllama(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const data = await response.json() as { models?: Array<{ name: string }> };
    const models = data.models?.map(m => m.name) ?? [];
    console.log(`   Available models: ${models.slice(0, 5).join(', ')}${models.length > 5 ? '...' : ''}`);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('═'.repeat(60));
  console.log('🚀 KNOWLEDGE PIPELINE');
  console.log('═'.repeat(60));
  console.log('');

  // Step 1: Create AppFactory and load configuration
  const factory = new AppFactory(process.cwd(), logger);
  console.log('✅ AppFactory created');

  // Step 2: Read model from configuration
  const config = factory.createConfigurationLoader();
  const effectiveConfig = await config.load();
  const model = process.argv[2] || effectiveConfig.defaultModel;
  const ollamaUrl = effectiveConfig.ollamaBaseUrl;

  console.log(`📋 Configuration loaded:`);
  console.log(`   Model:      ${model}`);
  console.log(`   Ollama URL: ${ollamaUrl}`);
  console.log('');

  // Step 3: Check Ollama connectivity
  console.log('🔌 Checking Ollama connectivity...');
  const ollamaOk = await checkOllama(ollamaUrl);
  if (!ollamaOk) {
    console.error('');
    console.error('❌ Cannot connect to Ollama!');
    console.error('');
    console.error('🔧 Troubleshooting:');
    console.error(`   1. Start Ollama:  ollama serve`);
    console.error(`   2. Pull model:    ollama pull ${model}`);
    console.error(`   3. Check URL:     ${ollamaUrl}`);
    console.error('');
    process.exit(1);
  }
  console.log('✅ Ollama is running');
  console.log('');

  // Step 4: Create and execute pipeline
  console.log('📦 Creating Knowledge Pipeline...');
  const pipeline = factory.createKnowledgePipeline(model);
  console.log('✅ Pipeline created');
  console.log('');

  console.log('🔄 Executing pipeline...');
  console.log('   Stage 1/3: Architectural Map');
  console.log('   Stage 2/3: Codebase Map');
  console.log('   Stage 3/3: Knowledge Base');
  console.log('');
  console.log('─'.repeat(60));

  const startTime = Date.now();
  const result = await pipeline.execute();
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('─'.repeat(60));
  console.log('');
  console.log(`⏱️  Duration: ${duration}s`);
  console.log('');

  if (result.success) {
    console.log('✅ SUCCESS! Knowledge Pipeline completed.');
    console.log('');
    console.log('📁 Generated files:');
    console.log(`   📄 ${result.files.architecturalMap}`);
    console.log(`   📄 ${result.files.codebaseMap}`);
    console.log(`   📄 ${result.files.knowledgeBase}`);
    if (result.modes) {
      console.log('');
      console.log('📊 Generation modes:');
      console.log(`   Architectural Map: ${result.modes.architecturalMap ?? 'unknown'}`);
      console.log(`   Codebase Map:      ${result.modes.codebaseMap ?? 'unknown'}`);
      console.log(`   Knowledge Base:    ${result.modes.knowledgeBase ?? 'unknown'}`);
    }
    console.log('');
    console.log('💡 Files are in .ai/knowledge/ directory');
  } else {
    console.log('❌ FAILED! Pipeline encountered errors:');
    console.log('');
    if (result.errors && result.errors.length > 0) {
      result.errors.forEach((err, i) => {
        console.log(`   ${i + 1}. ${err}`);
      });
    }
    console.log('');
    console.log('🔧 Common issues:');
    console.log(`   - Model not available: ollama pull ${model}`);
    console.log('   - LLM returned invalid JSON (check Ollama logs)');
    console.log('   - Context too large for model (try a larger model)');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('');
  console.error('💥 Fatal error:', err.message || err);
  process.exit(1);
});
