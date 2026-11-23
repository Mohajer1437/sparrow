import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DefaultProjectStructureService } from '../../../src/core/discovery/default-project-structure-service';

describe('DefaultProjectStructureService', () => {
  const service = new DefaultProjectStructureService();
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `sparrow-structure-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty string for nonexistent path', async () => {
    const result = await service.scan('/nonexistent/path/xyz');
    expect(result).toBe('');
  });

  it('scans a simple directory tree', async () => {
    fs.mkdirSync(path.join(tmpDir, 'app'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'components'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'app', 'page.tsx'), 'export default function Home() {}');
    fs.writeFileSync(path.join(tmpDir, 'components', 'Button.tsx'), 'export default function Button() {}');
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');

    const result = await service.scan(tmpDir);

    expect(result).toContain('# Project Structure');
    expect(result).toContain('app/');
    expect(result).toContain('components/');
    expect(result).toContain('page.tsx');
    expect(result).toContain('Button.tsx');
    expect(result).toContain('package.json');
  });

  it('excludes node_modules and .next', async () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.next'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'export {}');

    const result = await service.scan(tmpDir);

    expect(result).toContain('[excluded]');
    expect(result).toContain('src/');
    expect(result).toContain('index.ts');
  });

  it('never throws on permission errors', async () => {
    const result = await service.scan(tmpDir);
    expect(typeof result).toBe('string');
    expect(result).toContain('# Project Structure');
  });
});
