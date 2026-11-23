import { InternalValidationRequest } from '../../domain/internal-validation';

export interface InternalValidationParseResult {
  readonly ok: boolean;
  readonly request?: InternalValidationRequest;
  readonly error?: string;
}

const VALIDATOR_PATTERN = /\bvalidator\s*=\s*("([^"]+)"|'([^']+)'|([^\s]+))/i;

/**
 * Extracts a balanced JSON literal that starts at `start`, so nested objects
 * and arrays inside the payload survive. Returns null when unbalanced.
 */
function extractBalancedLiteral(text: string, start: number): string | null {
  const open = text[start];
  const close = open === '{' ? '}' : open === '[' ? ']' : '';
  if (!close) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function readAssignedLiteral(text: string, key: string): { found: boolean; raw?: string } {
  const marker = new RegExp(`\\b${key}\\s*=\\s*`, 'i');
  const match = marker.exec(text);
  if (!match) return { found: false };
  const start = match.index + match[0].length;
  const raw = extractBalancedLiteral(text, start);
  return raw === null ? { found: true } : { found: true, raw };
}

function invalid(detail: string): InternalValidationParseResult {
  return Object.freeze({ ok: false, error: `INVALID_VALIDATION_REQUEST: ${detail}` });
}

/**
 * Deterministically parses an internal validation directive of the form:
 *
 *   INTERNAL_VALIDATION validator=<name> input={...}
 *
 * No model is consulted. `authority` and `context` may be supplied either as
 * top-level assignments or as fields inside `input`; the input payload itself
 * is passed through to the validator exactly as written.
 */
export function parseInternalValidationCommand(text: string): InternalValidationParseResult {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return invalid('no internal validation directive found');
  }

  const validatorMatch = VALIDATOR_PATTERN.exec(text);
  const validator = (validatorMatch?.[2] ?? validatorMatch?.[3] ?? validatorMatch?.[4] ?? '').trim();
  if (!validator) {
    return invalid('missing validator');
  }

  const inputLiteral = readAssignedLiteral(text, 'input');
  if (!inputLiteral.found) {
    return invalid('missing input');
  }
  if (!inputLiteral.raw) {
    return invalid('malformed input: unbalanced JSON literal');
  }

  let input: unknown;
  try {
    input = JSON.parse(inputLiteral.raw);
  } catch {
    return invalid('malformed input: not valid JSON');
  }
  if (input === null || typeof input !== 'object') {
    return invalid('malformed input: expected a JSON object');
  }

  const payload = input as Record<string, unknown>;

  const readSection = (key: 'authority' | 'context'): unknown => {
    const assigned = readAssignedLiteral(text, key);
    if (assigned.found && assigned.raw) {
      try {
        return JSON.parse(assigned.raw);
      } catch {
        return undefined;
      }
    }
    return payload[key];
  };

  return Object.freeze({
    ok: true,
    request: Object.freeze({
      validator,
      input,
      authority: readSection('authority'),
      context: readSection('context'),
    }),
  });
}
