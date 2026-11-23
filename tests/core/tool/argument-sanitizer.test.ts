import { sanitizeToolArguments } from '../../../src/core/tool/argument-sanitizer';

describe('sanitizeToolArguments', () => {
  const workspacePath = 'E:\\new-test-2';

  it('strips duplicate workspace name prefix from path argument', () => {
    const args = { path: 'new-test-2/data/questions.json' };
    const sanitized = sanitizeToolArguments(args, workspacePath);
    expect(sanitized.path).toBe('data/questions.json');
  });

  it('strips duplicate prefix with backslash (Windows)', () => {
    const args = { path: 'new-test-2\\data\\file.txt' };
    const sanitized = sanitizeToolArguments(args, workspacePath);
    expect(sanitized.path).toBe('data\\file.txt');
  });

  it('does not modify normal relative paths', () => {
    const args = { path: 'data/questions.json' };
    const sanitized = sanitizeToolArguments(args, workspacePath);
    expect(sanitized.path).toBe('data/questions.json');
  });

  it('does not modify absolute paths', () => {
    const args = { path: '/home/user/project/data/file.txt' };
    const sanitized = sanitizeToolArguments(args, workspacePath);
    expect(sanitized.path).toBe('/home/user/project/data/file.txt');
  });

  it('does not strip workspace name in middle of path', () => {
    const args = { path: 'data/new-test-2/file.txt' };
    const sanitized = sanitizeToolArguments(args, workspacePath);
    expect(sanitized.path).toBe('data/new-test-2/file.txt');
  });

  it('applies to multiple path-like keys', () => {
    const args = {
      filePath: 'new-test-2/src/index.ts',
      targetPath: 'new-test-2/dist/index.js',
      from: 'new-test-2/old.txt',
      to: 'new-test-2/new.txt',
      nonPath: 'new-test-2/should-not-stay',
    };
    const sanitized = sanitizeToolArguments(args, workspacePath);
    expect(sanitized.filePath).toBe('src/index.ts');
    expect(sanitized.targetPath).toBe('dist/index.js');
    expect(sanitized.from).toBe('old.txt');
    expect(sanitized.to).toBe('new.txt');
    expect(sanitized.nonPath).toBe('new-test-2/should-not-stay');
  });

  it('returns original args when workspacePath is empty', () => {
    const args = { path: 'data/file.txt' };
    expect(sanitizeToolArguments(args, '')).toEqual(args);
  });

  it('never throws on weird input', () => {
    expect(() => sanitizeToolArguments({} as any, workspacePath)).not.toThrow();
    expect(() => sanitizeToolArguments(123 as any, workspacePath)).not.toThrow();
    expect(() => sanitizeToolArguments('string' as any, workspacePath)).not.toThrow();
  });
});
