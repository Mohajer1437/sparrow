import path from 'path';
import {
  canonicalizeWorkspaceRoot,
  isPathInsideRoot,
  resolveWorkspacePath,
  selectTaskChangedFiles,
  WorkspacePathError,
} from '../../../src/core/workspace/workspace-paths';

describe('workspace path policy', () => {
  const root = canonicalizeWorkspaceRoot('E:/new-test-2');

  it('canonicalizes mixed separators to a deterministic root', () => {
    const a = canonicalizeWorkspaceRoot('E:/new-test-2');
    const b = canonicalizeWorkspaceRoot('E:\\new-test-2');
    expect(a).toBe(b);
    expect(path.isAbsolute(a)).toBe(true);
  });

  it('resolves a project-relative path against the workspace root', () => {
    const resolved = resolveWorkspacePath(root, 'app/page.tsx');
    expect(resolved.relative).toBe('app/page.tsx');
    expect(resolved.absolute).toBe(path.join(root, 'app', 'page.tsx'));
  });

  it('resolves a dot-relative path against the workspace root', () => {
    const resolved = resolveWorkspacePath(root, './app/page.tsx');
    expect(resolved.relative).toBe('app/page.tsx');
    expect(resolved.absolute).toBe(path.join(root, 'app', 'page.tsx'));
  });

  it('resolves Windows separators to the same file', () => {
    const a = resolveWorkspacePath(root, 'app/page.tsx');
    const b = resolveWorkspacePath(root, 'app\\page.tsx');
    expect(a.absolute).toBe(b.absolute);
    expect(a.relative).toBe('app/page.tsx');
    expect(b.relative).toBe('app/page.tsx');
  });

  it('keeps an in-workspace absolute path inside the workspace', () => {
    const absolute = path.join(root, 'app', 'page.tsx');
    const resolved = resolveWorkspacePath(root, absolute);
    expect(resolved.relative).toBe('app/page.tsx');
    expect(resolved.absolute).toBe(absolute);
  });

  it('resolves nested paths', () => {
    const resolved = resolveWorkspacePath(root, 'app/login/page.tsx');
    expect(resolved.relative).toBe('app/login/page.tsx');
    expect(resolved.absolute).toBe(path.join(root, 'app', 'login', 'page.tsx'));
  });

  it('rejects path traversal', () => {
    expect(() => resolveWorkspacePath(root, '../secret.txt')).toThrow(WorkspacePathError);
    expect(() => resolveWorkspacePath(root, '..')).toThrow(WorkspacePathError);
    try {
      resolveWorkspacePath(root, '../secret.txt');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspacePathError);
      expect((error as WorkspacePathError).code).toBe('TRAVERSAL');
    }
  });

  it('does not treat a similarly prefixed directory as inside the workspace', () => {
    expect(isPathInsideRoot(root, path.resolve(root + '-other', 'app', 'page.tsx'))).toBe(false);
  });

  it('does not resolve a project-relative path against Sparrow install dir', () => {
    const resolved = resolveWorkspacePath(root, 'app/page.tsx');
    expect(resolved.absolute.toLowerCase().includes('agentic' + path.sep + 'app')).toBe(false);
    expect(resolved.absolute.startsWith(root)).toBe(true);
  });

  it('selects only files changed by the task, not pre-existing dirty files', () => {
    const selected = selectTaskChangedFiles(
      ['app/page.tsx', 'data/saved_cards.json'],
      ['data/saved_cards.json'],
    );
    expect(selected).toEqual(['app/page.tsx']);
  });
});
