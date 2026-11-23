import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LocalRuntimeRepository } from '../../../src/core/runtime/local-runtime-repository';

describe('LocalRuntimeRepository - Atomic Writes', () => {
  let tempDir: string;
  let repo: LocalRuntimeRepository;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-test-'));
    await fs.mkdir(path.join(tempDir, '.ai'), { recursive: true });
    repo = new LocalRuntimeRepository(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes file atomically (no partial writes)', async () => {
    const content = JSON.stringify({ test: 'data', value: 123 });
    await repo.writeFile('test.json', content);

    const read = await repo.readFile('test.json');
    expect(read).toBe(content);

    // Verify no .tmp files remain
    const aiDir = path.join(tempDir, '.ai');
    const files = await fs.readdir(aiDir);
    const tmpFiles = files.filter(f => f.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('overwrites existing file atomically', async () => {
    await repo.writeFile('test.json', '{"version": 1}');
    await repo.writeFile('test.json', '{"version": 2}');

    const read = await repo.readFile('test.json');
    expect(JSON.parse(read).version).toBe(2);
  });

  it('creates parent directories if needed', async () => {
    await repo.writeFile('nested/dir/test.json', '{"nested": true}');
    const read = await repo.readFile('nested/dir/test.json');
    expect(JSON.parse(read).nested).toBe(true);
  });
});
