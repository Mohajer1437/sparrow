import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import * as path from 'path';
import { sanitizeImplicatedSourcePath } from './api-route';

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git', '.ai', 'coverage', 'out']);

export function pageSlug(pagePath: string): string {
  const slug = pagePath.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'home';
}

export function extractFilePaths(text: string): string[] {
  if (!text) return [];
  const paths: string[] = [];
  const seen = new Set<string>();
  const filePathRegex = /(?:^|[\s"'`(\[])(?![\*.])([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|json|md|css|scss))\b/gi;
  let match: RegExpExecArray | null;
  while ((match = filePathRegex.exec(text)) !== null) {
    let file = match[1];
    if (!file) continue;
    if (file.includes('*')) continue;
    if (file.startsWith('./')) file = file.substring(2);
    if (file.length < 3 || file.includes('://')) continue;
    if (file.includes('node_modules') || file.includes('_next/')) continue;
    if (/^[A-Za-z0-9._-]+-[a-f0-9]{8,}\.js$/.test(file)) continue;
    const base = file.split('/').pop() || file;
    if (/^[A-Za-z0-9._-]+-[a-f0-9]{8,}\.js$/.test(base)) continue;
    if (!file.includes('/') && !/\.(tsx|ts|jsx|json|md)$/i.test(file)) continue;
    if (!seen.has(file)) {
      seen.add(file);
      paths.push(file);
    }
  }
  return paths;
}

export function inferFilesFromNextChunks(evidence: string): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const chunkRe = /\/_next\/static\/chunks\/app\/([A-Za-z0-9._/-]+?)(?:-[a-f0-9]{8,})?\.js/gi;
  let match: RegExpExecArray | null;
  while ((match = chunkRe.exec(evidence)) !== null) {
    const rel = match[1].replace(/\\/g, '/').replace(/\/index$/i, '');
    const candidates = [
      'app/' + rel + '.tsx',
      'app/' + rel + '.jsx',
      'app/' + rel + '.ts',
      'app/' + rel + '.js',
      'src/app/' + rel + '.tsx',
    ];
    for (const candidate of candidates) {
      if (!seen.has(candidate)) {
        seen.add(candidate);
        files.push(candidate);
      }
    }
  }
  return files;
}

function isLayoutFile(file: string): boolean {
  return /(^|\/)layout\.(tsx|jsx|ts|js)$/i.test(file.replace(/\\/g, '/'));
}

export function inferImplicatedFiles(evidence: string, workspacePath?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (file: string) => {
    const normalized = sanitizeImplicatedSourcePath(file.replace(/\\/g, '/').replace(/^\.?\//, ''));
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  const errorHits = workspacePath ? findFilesContainingError(workspacePath, evidence) : [];
  for (const file of errorHits) push(file);
  const hasSpecificThrow = errorHits.some(file => !isLayoutFile(file));

  for (const file of inferFilesFromNextChunks(evidence)) {
    if (hasSpecificThrow && isLayoutFile(file)) continue;
    push(file);
  }
  for (const file of extractFilePaths(evidence)) push(file);

  if (workspacePath) {
    for (const file of [...out]) {
      if (!existsSync(path.join(workspacePath, file))) {
        const basename = path.posix.basename(file);
        const found = findFileByName(workspacePath, basename, 4);
        if (found) push(found);
      }
    }
    return out.filter(file => existsSync(path.join(workspacePath, file)));
  }

  return out;
}

function errorNeedles(evidence: string): string[] {
  const needles: string[] = [];
  const errorLine = evidence.match(/Error:\s*([^\n|;]+)/);
  if (errorLine && errorLine[1].trim().length >= 12) {
    needles.push(errorLine[1].trim());
  }
  const quoted = evidence.match(/controlled [^\n|;]+/i);
  if (quoted) needles.push(quoted[0].trim());
  return needles.filter(n => n.length >= 12 && n.length < 180);
}

function findFilesContainingError(workspacePath: string, evidence: string): string[] {
  const needles = errorNeedles(evidence);
  if (needles.length === 0) return [];
  const hits: string[] = [];
  walkSourceFiles(workspacePath, '', hits, needles, 0, 80);
  return hits;
}

function walkSourceFiles(
  root: string,
  rel: string,
  hits: string[],
  needles: string[],
  depth: number,
  budget: { n: number } | number,
): void {
  const remaining = typeof budget === 'number' ? { n: budget } : budget;
  if (remaining.n <= 0 || depth > 6 || hits.length >= 8) return;
  const dir = rel ? path.join(root, rel) : root;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (remaining.n <= 0 || hits.length >= 8) return;
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const childRel = rel ? rel + '/' + entry : entry;
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkSourceFiles(root, childRel, hits, needles, depth + 1, remaining);
      continue;
    }
    if (!/\.(tsx|ts|jsx|js)$/i.test(entry)) continue;
    remaining.n -= 1;
    try {
      const content = readFileSync(full, 'utf8');
      if (needles.some(n => content.includes(n))) {
        hits.push(childRel.replace(/\\/g, '/'));
      }
    } catch {
      // skip unreadable
    }
  }
}

function findFileByName(root: string, basename: string, maxDepth: number): string | undefined {
  const queue: Array<{ dir: string; rel: string; depth: number }> = [{ dir: root, rel: '', depth: 0 }];
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.depth > maxDepth) continue;
    let entries: string[];
    try {
      entries = readdirSync(item.dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = path.join(item.dir, entry);
      const childRel = item.rel ? item.rel + '/' + entry : entry;
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        queue.push({ dir: full, rel: childRel, depth: item.depth + 1 });
      } else if (entry === basename || entry === basename.replace(/\.tsx?$/, '.tsx')) {
        return childRel.replace(/\\/g, '/');
      }
    }
  }
  return undefined;
}

export function expectedBehaviorFromCheck(id: string, evidence: string, acceptanceCriterion?: string): string {
  if (id.includes('pageerror') || /pageerror:/i.test(evidence)) {
    return 'The page must load without uncaught runtime exceptions';
  }
  if (id.includes('console-error') || /console\.error:/i.test(evidence)) {
    return 'The page must not emit console.error';
  }
  if (id.includes('network') || /requestfailed:|http5xx:|unexpected network failure:/i.test(evidence)) {
    return 'Critical document, script, XHR, and fetch requests must succeed (no 5xx or requestfailed)';
  }
  if (id.startsWith('api-') || /scenario:\s*/i.test(evidence)) {
    const expected = evidence.match(/Expected:\s*([^;]+)/i);
    const method = evidence.match(/method:\s*([A-Z]+)/i);
    const route = evidence.match(/route:\s*([^;]+)/i);
    if (expected) {
      return (method ? method[1] + ' ' : '') + (route ? route[1].trim() + ' ' : '') + 'must satisfy ' + expected[1].trim();
    }
  }
  const labeledExpected = evidence.match(/Expected:\s*([^;]+)/i);
  if (labeledExpected) {
    return labeledExpected[1].trim();
  }
  const missingTestId = evidence.match(/missing visible test id:\s*([A-Za-z0-9:_-]+)/i)
    || evidence.match(/\[data-testid=["']([^"']+)["']\]/i);
  if (missingTestId && /element not found|not visible/i.test(evidence)) {
    return 'Element with test id "' + missingTestId[1] + '" must be visible';
  }
  const missingText = evidence.match(/missing visible text:\s*(.+?)(?:\s*\||$)/i);
  if (missingText) {
    return 'Visible text must include "' + missingText[1].trim() + '"';
  }
  if (acceptanceCriterion && !/^(missing |forbidden |failed )/i.test(acceptanceCriterion)) {
    return acceptanceCriterion;
  }
  return acceptanceCriterion || 'Failed verification checks must pass';
}
