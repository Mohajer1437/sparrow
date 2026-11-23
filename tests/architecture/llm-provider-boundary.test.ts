import * as fs from 'fs';
import * as path from 'path';

/**
 * LLM provider boundary: vendor HTTP clients stay in the provider layer + composition root.
 */
describe('LLM provider boundary', () => {
  const repoRoot = path.resolve(__dirname, '../..');

  const allowedImportOfOllamaProvider = [
    path.normalize('src/core/app-factory.ts'),
    path.normalize('src/core/provider/ollama-provider.ts'),
    path.normalize('src/core/provider/create-llm-provider-from-settings.ts'),
    path.normalize('tests/core/provider/ollama-provider.test.ts'),
    path.normalize('tests/core/provider/provider-meta.test.ts'),
    path.normalize('tests/core/provider/provider-registry-factory.test.ts'),
    path.normalize('tests/core/provider/provider-health.test.ts'),
    path.normalize('tests/core/provider/provider-smoke-test.test.ts'),
    path.normalize('tests/core/provider/resilient-llm-provider-timeout.test.ts'),
    path.normalize('tests/cli/commands/provider-profiles.test.ts'),
    path.normalize('tests/integration/real-ollama.test.ts'),
    path.normalize('scripts/phase6-provider-stability-gate.ts'),
  ];

  const allowedImportOfOpenAICompatibleProvider = [
    path.normalize('src/core/app-factory.ts'),
    path.normalize('src/core/provider/openai-compatible-provider.ts'),
    path.normalize('src/core/provider/create-llm-provider-from-settings.ts'),
    path.normalize('tests/core/provider/openai-compatible-provider.test.ts'),
    path.normalize('tests/core/provider/provider-registry-factory.test.ts'),
    path.normalize('tests/core/provider/provider-health.test.ts'),
    path.normalize('tests/core/provider/provider-smoke-test.test.ts'),
    path.normalize('tests/cli/commands/provider-profiles.test.ts'),
  ];

  const allowedImportOfOllamaModelDiscovery = [
    path.normalize('src/core/app-factory.ts'),
    path.normalize('src/core/model/ollama-model-discovery.ts'),
  ];

  function collectTsFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'graphify-out') continue;
        collectTsFiles(full, out);
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  function relativePosix(file: string): string {
    return path.relative(repoRoot, file).split(path.sep).join('/');
  }

  function filesImporting(pattern: RegExp, searchRoots: string[]): string[] {
    const hits: string[] = [];
    for (const root of searchRoots) {
      for (const file of collectTsFiles(path.join(repoRoot, root))) {
        const text = fs.readFileSync(file, 'utf8');
        if (pattern.test(text)) {
          hits.push(path.normalize(relativePosix(file)));
        }
      }
    }
    return hits;
  }

  it('keeps OllamaProvider imports inside the provider composition boundary', () => {
    const hits = filesImporting(
      /from\s+['"].*ollama-provider['"]/,
      ['src', 'tests', 'scripts'],
    );
    const unexpected = hits.filter((h) => !allowedImportOfOllamaProvider.includes(h));
    expect(unexpected).toEqual([]);
  });

  it('keeps OpenAICompatibleProvider imports inside the provider composition boundary', () => {
    const hits = filesImporting(
      /from\s+['"].*openai-compatible-provider['"]/,
      ['src', 'tests', 'scripts'],
    );
    const unexpected = hits.filter((h) => !allowedImportOfOpenAICompatibleProvider.includes(h));
    expect(unexpected).toEqual([]);
  });

  it('keeps OllamaModelDiscovery imports inside the composition root', () => {
    const hits = filesImporting(
      /from\s+['"].*ollama-model-discovery['"]/,
      ['src', 'tests', 'scripts'],
    );
    const unexpected = hits.filter((h) => !allowedImportOfOllamaModelDiscovery.includes(h));
    expect(unexpected).toEqual([]);
  });

  it('does not place Ollama HTTP (/api/chat) outside OllamaProvider', () => {
    const hits = filesImporting(/\/api\/chat/, ['src']);
    const unexpected = hits.filter(
      (h) => h !== path.normalize('src/core/provider/ollama-provider.ts'),
    );
    expect(unexpected).toEqual([]);
  });

  it('Planner and Executor source do not import vendor provider clients', () => {
    const planningHits = filesImporting(
      /ollama-provider|openai-compatible-provider/,
      ['src/core/planning', 'src/core/execution', 'src/app'],
    );
    expect(planningHits).toEqual([]);
  });
});
