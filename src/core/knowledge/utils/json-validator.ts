export function isValidJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes leading/trailing whitespace from all JSON object keys recursively.
 * Fixes LLM hallucinations like "meta ": { ... } -> "meta": { ... }
 */
export function sanitizeJsonKeys(value: any): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(sanitizeJsonKeys);
  }
  if (typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      result[key.trim()] = sanitizeJsonKeys(value[key]);
    }
    return result;
  }
  return value;
}

export function parseJsonSafely<T>(str: string): T | null {
  try {
    return sanitizeJsonKeys(JSON.parse(str)) as T;
  } catch {
    return null;
  }
}

/**
 * Extracts valid JSON from an LLM response that may contain:
 * - Markdown code blocks (```json ... ```)
 * - Extra text before/after the JSON
 * - Multiple JSON-like structures (we want the first valid one)
 */
export function extractJsonFromResponse<T>(response: string): T | null {
  if (!response || response.trim().length === 0) {
    return null;
  }

  // Strategy 1: Try raw parse first
  const directParse = parseJsonSafely<T>(response.trim());
  if (directParse !== null) {
    return directParse;
  }

  // Strategy 2: Strip markdown code blocks
  const codeBlockRegex = /\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/gi;
  let match = codeBlockRegex.exec(response);
  while (match !== null) {
    const extracted = match[1].trim();
    const parsed = parseJsonSafely<T>(extracted);
    if (parsed !== null) {
      return parsed;
    }
    match = codeBlockRegex.exec(response);
  }

  // Strategy 3: Find first '{' and last '}'
  const firstBrace = response.indexOf('{');
  const lastBrace = response.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonSubstring = response.substring(firstBrace, lastBrace + 1);
    const parsed = parseJsonSafely<T>(jsonSubstring);
    if (parsed !== null) {
      return parsed;
    }
  }

  // Strategy 4: Find first '[' and last ']' (for array responses)
  const firstBracket = response.indexOf('[');
  const lastBracket = response.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const jsonSubstring = response.substring(firstBracket, lastBracket + 1);
    const parsed = parseJsonSafely<T>(jsonSubstring);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}
