const SHARED_FILE_RE = /(?:^|\/)(layout|template|providers?|CrashBeacon)\.[jt]sx?$/i;

export function pagesFromTask(
  task?: string,
  criteria?: ReadonlyArray<string>,
): string[] {
  const text = [task, ...(criteria ?? [])].filter(Boolean).join('\n');
  if (!text.trim()) return [];
  const pages = new Set<string>();
  if (/\bhome[- ]?page\b|\bhomepage\b|app\/page\.(tsx|jsx|ts|js)\b|pages\/index\.(tsx|jsx)/i.test(text)) {
    pages.add('/');
  }
  const appPageRe = /(?:^|[\s"'`(])(?:src\/)?app\/([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)\/page\.(tsx|jsx|ts|js)/g;
  let match: RegExpExecArray | null;
  while ((match = appPageRe.exec(text)) !== null) {
    pages.add('/' + match[1]);
  }
  const routeRe = /(?:^|[\s"'`(])(\/[a-z][a-z0-9/_-]*)/gi;
  while ((match = routeRe.exec(text)) !== null) {
    const route = match[1].replace(/\/+$/, '') || '/';
    if (route.startsWith('/api')) continue;
    if (route.split('/').filter(Boolean).length > 3) continue;
    pages.add(route);
  }
  return [...pages];
}

export function pageForChangedFile(file: string): string | undefined {
  const normalized = file.replace(/\\/g, '/').replace(/^\.?\//, '');
  if (SHARED_FILE_RE.test(normalized) || /(?:^|\/)components\//i.test(normalized)) {
    return undefined;
  }
  if (/(?:^|\/)app\/page\.(tsx|jsx|ts|js)$/i.test(normalized) || /(?:^|\/)pages\/index\.(tsx|jsx|ts|js)$/i.test(normalized)) {
    return '/';
  }
  const app = normalized.match(/(?:^|\/)app\/(.+)\/page\.(tsx|jsx|ts|js)$/i);
  if (app) return '/' + app[1];
  const pages = normalized.match(/(?:^|\/)pages\/(.+)\.(tsx|jsx|ts|js)$/i);
  if (pages) return '/' + pages[1].replace(/\/index$/i, '');
  return undefined;
}

export function selectBrowserPages(
  discovered: string[],
  changedFiles?: ReadonlyArray<string>,
  task?: string,
  criteria?: ReadonlyArray<string>,
): string[] {
  const known = new Set(discovered);
  const pick = (candidates: string[]) => candidates.filter(page => known.has(page));

  let selected = pick(pagesFromTask(task, criteria));
  if (selected.length === 0 && changedFiles && changedFiles.length > 0) {
    selected = pick(
      changedFiles.map(pageForChangedFile).filter((page): page is string => !!page),
    );
  }
  if (selected.length === 0) {
    selected = known.has('/') ? ['/'] : discovered.slice(0, 1);
  }
  const text = [task, ...(criteria ?? [])].join(' ');
  if (known.has('/') && /\bhome[- ]?page\b|app\/page\./i.test(text) && !selected.includes('/')) {
    selected = ['/', ...selected];
  }
  return selected.slice(0, 3);
}

export function isLoginRedirect(finalUrl: string, requestedPath: string): boolean {
  let finalPath = finalUrl;
  try {
    finalPath = new URL(finalUrl).pathname;
  } catch {
    // keep raw
  }
  const normalizedFinal = (finalPath.replace(/\/+$/, '') || '/').toLowerCase();
  const normalizedRequested = (requestedPath.replace(/\/+$/, '') || '/').toLowerCase();
  return normalizedFinal === '/login' && normalizedRequested !== '/login';
}
