import {
  IntentConfidence,
  OriginalIntent,
  OriginalIntentClassification,
} from '../../domain/repair/repair-objective';

/**
 * R4.7: classify what the original task was asking for.
 *
 * Two rules govern this file. First, it reads the user's task text and nothing
 * else — not model output, not project sources, not `.ai` context — so text
 * planted in the repository cannot change what the repair is allowed to do.
 * Second, it only ever selects from a fixed enum, so the worst a crafted task
 * can do is pick a different member of that enum, and the operation table
 * still constrains what follows.
 *
 * Ambiguity resolves to UNKNOWN, which grants the narrowest operation set.
 */

interface IntentRule {
  readonly intent: OriginalIntent;
  readonly pattern: RegExp;
  /** Removal intents grant DELETE, so they need corroboration to win. */
  readonly removal?: boolean;
}

/** Ordered by specificity: the first match wins. */
const INTENT_RULES: ReadonlyArray<IntentRule> = Object.freeze([
  {
    // The verb has to govern the noun directly. A loose bridge between them
    // lets unrelated sentences ("...repair rules and delete the test suite")
    // read as a test-fixing task, which would authorise editing tests.
    intent: 'FIX_TEST',
    pattern: /\b(fix|repair|correct|update|adjust)\s+(the\s+|a\s+)?(failing\s+)?(unit\s+|integration\s+|e2e\s+)?tests?\b|\bfailing\s+(unit\s+|integration\s+|e2e\s+)?tests?\b/i,
  },
  {
    intent: 'ADD_COMMENT',
    pattern: /\badd(ing)?\b[^.]{0,40}?\bcomments?\b|\bcomments?\b[^.]{0,20}?\bto\s+the\s+(top|file|component)\b/i,
  },
  {
    intent: 'ADD_ENDPOINT',
    pattern: /\b(add|create|implement|expose)\b[^.]{0,60}?\b(endpoint|route|api|handler)\b/i,
  },
  {
    // Ordered ahead of the constructive intents so that removal language
    // always reaches the ambiguity check below rather than being masked by an
    // earlier match. A task that both fixes and removes must not silently
    // resolve to a fix that happens to carry deletion along with it.
    intent: 'REMOVE_FEATURE',
    pattern: /\b(remov(e|es|ing|al)|delet(e|es|ing|ion)|drop(s|ping)?|deprecat(e|ed|ing)|get\s+rid\s+of|strip(s|ping)?\s+out|eliminat(e|es|ing))\b/i,
    removal: true,
  },
  {
    intent: 'FIX_BUG',
    pattern: /\b(fix|bug|broken|crash(es|ing)?|failing|defect|regression|not\s+working|repair)\b/i,
  },
  {
    intent: 'REFACTOR',
    pattern: /\b(refactor|rename|extract|reorganize|restructure|clean\s+up|tidy)\b/i,
  },
  {
    intent: 'CHANGE_UI',
    pattern: /\b(ui|button|form|layout|style|css|page|component|heading|label|text)\b[^.]{0,40}?\b(change|update|show|display|render)\b|\b(change|update)\b[^.]{0,40}?\b(ui|button|form|layout|style|heading|label)\b/i,
  },
  {
    intent: 'MODIFY_BEHAVIOR',
    pattern: /\b(change|modify|update|adjust|make|set|replace|edit)\b/i,
  },
]);

/**
 * Intents that describe building or correcting something. If one of these is
 * present alongside a removal verb, the task is ambiguous about deletion and
 * we refuse to grant DELETE.
 */
const CONSTRUCTIVE_INTENTS: ReadonlySet<OriginalIntent> = new Set<OriginalIntent>([
  'ADD_COMMENT',
  'ADD_ENDPOINT',
  'FIX_BUG',
  'FIX_TEST',
  'CHANGE_UI',
  'MODIFY_BEHAVIOR',
]);

const MAX_EVIDENCE_LENGTH = 120;

export function classifyOriginalIntent(originalTask: string): OriginalIntentClassification {
  const task = (originalTask || '').trim();
  if (task.length === 0) {
    return unknown('Original task is empty');
  }

  const matches = INTENT_RULES.filter(rule => rule.pattern.test(task));
  if (matches.length === 0) {
    return unknown('No task phrase matched a known intent category');
  }

  const winner = matches[0];

  // A removal verb only authorises deletion when the task is unambiguously
  // about removal. "Fix X by removing Y" must not become a licence to delete.
  if (winner.removal) {
    const competing = matches.find(rule => CONSTRUCTIVE_INTENTS.has(rule.intent));
    if (competing) {
      return unknown(
        `Task mixes removal language with ${competing.intent} language; deletion is not clearly authorised`,
      );
    }
  }

  return Object.freeze({
    intent: winner.intent,
    confidence: 'EVIDENCED' as IntentConfidence,
    evidence: quoteMatch(task, winner.pattern),
    reason: `Task text matched ${winner.intent} vocabulary`,
  });
}

function unknown(reason: string): OriginalIntentClassification {
  return Object.freeze({
    intent: 'UNKNOWN' as OriginalIntent,
    confidence: 'UNKNOWN' as IntentConfidence,
    reason,
  });
}

function quoteMatch(task: string, pattern: RegExp): string | undefined {
  const found = pattern.exec(task);
  if (!found || !found[0]) return undefined;
  const text = found[0].trim();
  return text.length > MAX_EVIDENCE_LENGTH
    ? text.slice(0, MAX_EVIDENCE_LENGTH) + '…'
    : text;
}
