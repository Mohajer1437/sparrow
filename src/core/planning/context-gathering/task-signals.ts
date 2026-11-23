export const TASK_SIGNAL_TERMS = [
  'auth',
  'authentication',
  'login',
  'middleware',
  'routing',
  'route',
  'router',
  'api',
  'database',
  'db',
  'testing',
  'test',
  'architecture',
  'conventions',
  'convention',
  'loading',
  'spinner',
  'page',
] as const;

export type TaskSignal = (typeof TASK_SIGNAL_TERMS)[number];

const SIGNAL_ALIASES: Record<string, TaskSignal> = {
  authenticate: 'authentication',
  authorization: 'auth',
  session: 'auth',
  jwt: 'auth',
  prisma: 'database',
  sql: 'database',
  spec: 'testing',
  jest: 'testing',
  playwright: 'testing',
  next: 'page',
};

export function extractTaskSignals(...texts: Array<string | undefined>): ReadonlyArray<TaskSignal> {
  const found = new Set<TaskSignal>();
  const haystack = texts.filter(Boolean).join(' ').toLowerCase();
  const tokens = haystack.split(/[^a-z0-9]+/g).filter(Boolean);

  for (const term of TASK_SIGNAL_TERMS) {
    if (haystack.includes(term)) {
      found.add(term);
    }
  }
  for (const token of tokens) {
    const alias = SIGNAL_ALIASES[token];
    if (alias) found.add(alias);
  }

  return Object.freeze([...found]);
}

export function pathMatchesSignal(relativePath: string, signals: ReadonlyArray<string>): boolean {
  const lower = relativePath.toLowerCase().replace(/\\/g, '/');
  return signals.some(signal => lower.includes(signal.toLowerCase()));
}
