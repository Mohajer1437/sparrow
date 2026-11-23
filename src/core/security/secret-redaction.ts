/**
 * Shared secret redaction. Used by the backend verifier (so tokens never
 * enter evidence) and by the application read model.
 */

export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|passphrase|secret|apikey|api[-_]?key|access[-_]?key|private[-_]?key|credential|authorization|auth[-_]?header|cookie|bearer|signature|connection[-_]?string|dsn)/i;

const TOKEN_KEY_PATTERN = /(^|[^a-z])tokens?$|(^|[_-])token([_-]|$)|token$/i;
const TOKEN_METRIC_KEYS: ReadonlySet<string> = new Set([
  'tokens',
  'tokencount',
  'totaltokens',
  'prompttokens',
  'completiontokens',
]);

const CREDENTIAL_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  /\bBearer\s+[A-Za-z0-9._\-~+/]{8,}=*/gi,
  /\bBasic\s+[A-Za-z0-9+/]{12,}=*/gi,
  /\bsk-[A-Za-z0-9]{12,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
]);

const ASSIGNMENT_PATTERN =
  /((?:[A-Za-z0-9_.-]*(?:password|passwd|passphrase|secret|token|api[-_]?key|apikey|access[-_]?key|private[-_]?key|credentials?|authorization|cookie))\s*[:=]\s*)("?)([^\s"',}]{3,})/gi;

const URL_CREDENTIAL_PATTERN =
  /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|https?):\/\/[^\s:@/]+:)([^\s@/]+)(@)/gi;

const MAX_REDACT_DEPTH = 8;

export function isSensitiveKey(key: string): boolean {
  if (SENSITIVE_KEY_PATTERN.test(key)) return true;
  if (TOKEN_METRIC_KEYS.has(key.toLowerCase())) return false;
  return TOKEN_KEY_PATTERN.test(key);
}

export function redactText(value: string): string {
  let out = value;
  for (const pattern of CREDENTIAL_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  out = out.replace(URL_CREDENTIAL_PATTERN, (_match, prefix, _secret, suffix) =>
    `${prefix}${REDACTED}${suffix}`);
  out = out.replace(ASSIGNMENT_PATTERN, (_match, key, quote) => `${key}${quote}${REDACTED}`);
  return out;
}

export function redactValue<T>(value: T, depth = 0): T {
  if (depth > MAX_REDACT_DEPTH) return undefined as unknown as T;
  if (typeof value === 'string') return redactText(value) as unknown as T;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(item => redactValue(item, depth + 1)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactValue(item, depth + 1);
  }
  return out as unknown as T;
}
