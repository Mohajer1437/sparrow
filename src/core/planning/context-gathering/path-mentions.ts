import { toPosixRelative } from '../../workspace/workspace-paths';

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.md', '.css', '.scss',
]);

/**
 * Extract file-like path mentions from free text.
 * Deterministic; does not invent paths that were not written.
 */
export function extractPathMentions(text: string): string[] {
  if (!text || text.trim().length === 0) return [];
  const found: string[] = [];
  const seen = new Set<string>();

  const patterns = [
    /(?:^|[\s"'`(])((?:\.\.[\\/])+[\w./\\-]+\.[A-Za-z0-9]+)/g,
    /(?:^|[\s"'`(])((?:[A-Za-z]:)?(?:[\w.-]+[\\/])+[\w.-]+\.[A-Za-z0-9]+)/g,
    /(?:^|[\s"'`(])((?:\.{1,2}[\\/])?(?:[\w.-]+[\\/])+[\w.-]+\.[A-Za-z0-9]+)/g,
    /(?:^|[\s"'`(])((?:[\w.-]+[\\/])?[\w.-]+\.(?:tsx|ts|jsx|js|mjs|cjs|md|json|css|scss))\b/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[1];
      const normalized = normalizeMentionedPath(raw);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      found.push(normalized);
    }
  }

  return found;
}

export function normalizeMentionedPath(raw: string, options?: { allowTraversal?: boolean }): string | undefined {
  const trimmed = raw.trim().replace(/^['"`]+|['"`]+$/g, '');
  if (!trimmed || trimmed.startsWith('http:') || trimmed.startsWith('https:')) {
    return undefined;
  }
  const withoutQuery = trimmed.split(/[?#]/)[0];
  const posix = toPosixRelative(withoutQuery.replace(/^\.\//, ''));
  if (!posix || posix === '.') {
    return undefined;
  }
  const last = posix.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  const ext = dot >= 0 ? last.slice(dot).toLowerCase() : '';
  if (ext && !SOURCE_EXTENSIONS.has(ext) && last !== 'middleware') {
    return undefined;
  }
  if (posix.startsWith('node_modules/') || posix.startsWith('dist/') || posix.startsWith('.git/')) {
    return undefined;
  }
  if (!posix.includes('/') && isProductNameDisguisedAsPath(posix)) {
    return undefined;
  }
  return posix;
}

const PRODUCT_NAME_PATHS = new Set([
  'next.js', 'node.js', 'react.js', 'vue.js', 'express.js', 'nest.js', 'angular.js',
]);

function isProductNameDisguisedAsPath(posix: string): boolean {
  return PRODUCT_NAME_PATHS.has(posix.toLowerCase());
}

export function extractDirectoryMentions(text: string): string[] {
  const dirs: string[] = [];
  const seen = new Set<string>();
  const dirPattern = /(?:^|[\s"'`(])((?:src|app|pages|lib|components)[\\/][\w-]+(?:[\\/][\w-]+)*)/gi;
  let match: RegExpExecArray | null;
  while ((match = dirPattern.exec(text)) !== null) {
    const posix = toPosixRelative(match[1]).replace(/\/$/, '');
    if (!posix || seen.has(posix) || posix.includes('..')) continue;
    if (/\.[a-z0-9]+$/i.test(posix)) continue;
    seen.add(posix);
    dirs.push(posix);
  }
  return dirs;
}
