/**
 * Lightweight, deterministic SemVer parser and range matching implementation.
 * Zero external dependencies.
 */

import { NormalizedVersion } from '../../domain/version-intelligence';

export interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease?: string;
  readonly raw: string;
}

const SEMVER_EXACT_REGEX = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Parses a raw version string into a NormalizedVersion object.
 */
export function parseSemver(input?: string): NormalizedVersion {
  if (!input || typeof input !== 'string' || input.trim() === '' || input.trim().toUpperCase() === 'UNKNOWN') {
    return {
      raw: input ?? '',
      isRange: false,
      isExact: false,
      isUnknown: true,
      normalizedString: 'UNKNOWN',
    };
  }

  const trimmed = input.trim();

  // Check if it's explicitly a range indicator
  const isRange = isRangeString(trimmed);

  if (isRange) {
    return {
      raw: trimmed,
      isRange: true,
      isExact: false,
      isUnknown: false,
      normalizedString: trimmed,
    };
  }

  const match = SEMVER_EXACT_REGEX.exec(trimmed);
  if (!match) {
    return {
      raw: trimmed,
      isRange: false,
      isExact: false,
      isUnknown: true,
      normalizedString: 'UNKNOWN',
    };
  }

  const major = parseInt(match[1], 10);
  const minor = match[2] !== undefined ? parseInt(match[2], 10) : 0;
  const patch = match[3] !== undefined ? parseInt(match[3], 10) : 0;
  const prerelease = match[4];

  const normalizedString = prerelease !== undefined
    ? `${major}.${minor}.${patch}-${prerelease}`
    : `${major}.${minor}.${patch}`;

  return {
    raw: trimmed,
    major,
    minor,
    patch,
    prerelease,
    isRange: false,
    isExact: true,
    isUnknown: false,
    normalizedString,
  };
}

function isRangeString(str: string): boolean {
  return (
    str.startsWith('^') ||
    str.startsWith('~') ||
    str.startsWith('>') ||
    str.startsWith('<') ||
    str.startsWith('=') ||
    str.includes(' ') ||
    str.includes('||') ||
    str.includes(' - ') ||
    str.includes('*') ||
    str.toLowerCase().includes('.x')
  );
}

/**
 * Extracts a concrete ParsedSemver if possible.
 */
export function parseExactSemver(input?: string): ParsedSemver | null {
  if (!input) return null;
  const trimmed = input.trim().replace(/^v/, '');
  const match = SEMVER_EXACT_REGEX.exec(trimmed);
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: match[2] !== undefined ? parseInt(match[2], 10) : 0,
    patch: match[3] !== undefined ? parseInt(match[3], 10) : 0,
    prerelease: match[4],
    raw: trimmed,
  };
}

/**
 * Compares two parsed semver versions.
 * Returns -1 if a < b, 1 if a > b, 0 if equal.
 */
export function compareSemver(aInput: string | ParsedSemver, bInput: string | ParsedSemver): number {
  const a = typeof aInput === 'string' ? parseExactSemver(aInput) : aInput;
  const b = typeof bInput === 'string' ? parseExactSemver(bInput) : bInput;

  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;

  // Prerelease comparison: non-prerelease has higher precedence than prerelease
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  if (a.prerelease && b.prerelease) {
    if (a.prerelease === b.prerelease) return 0;
    return a.prerelease.localeCompare(b.prerelease);
  }

  return 0;
}

type ComparatorOp = '>' | '>=' | '<' | '<=' | '=' | '!=';

interface SimpleComparator {
  readonly op: ComparatorOp;
  readonly version: ParsedSemver;
}

/**
 * Determines if a concrete version satisfies a SemVer range.
 */
export function satisfiesRange(versionStr?: string, rangeStr?: string): boolean {
  if (!versionStr || !rangeStr) return false;
  if (rangeStr.trim() === '*' || rangeStr.trim() === '' || rangeStr.trim() === 'x' || rangeStr.trim() === 'X') {
    return true;
  }

  const ver = parseExactSemver(versionStr);
  if (!ver) return false;

  // Handle OR clauses (e.g. "^14.0.0 || ^15.0.0")
  const orClauses = rangeStr.split('||').map(c => c.trim()).filter(Boolean);
  if (orClauses.length > 1) {
    return orClauses.some(clause => satisfiesRange(versionStr, clause));
  }

  // Parse intersection clauses
  const comparators = parseComparators(rangeStr);
  if (comparators.length === 0) return false;

  return comparators.every(comp => evaluateComparator(ver, comp));
}

function parseComparators(range: string): SimpleComparator[] {
  const parts = range.trim().split(/\s+/).filter(Boolean);
  const result: SimpleComparator[] = [];

  for (const part of parts) {
    const comp = parseSingleComparator(part);
    if (comp) {
      if (Array.isArray(comp)) {
        result.push(...comp);
      } else {
        result.push(comp);
      }
    }
  }

  return result;
}

function parseSingleComparator(part: string): SimpleComparator | SimpleComparator[] | null {
  const trimmed = part.trim();
  if (!trimmed) return null;

  // Caret range ^1.2.3
  if (trimmed.startsWith('^')) {
    const base = parseExactSemver(trimmed.substring(1));
    if (!base) return null;
    if (base.major > 0) {
      // ^1.2.3 -> >=1.2.3 <2.0.0
      return [
        { op: '>=', version: base },
        { op: '<', version: { major: base.major + 1, minor: 0, patch: 0, raw: `${base.major + 1}.0.0` } },
      ];
    } else if (base.minor > 0) {
      // ^0.2.3 -> >=0.2.3 <0.3.0
      return [
        { op: '>=', version: base },
        { op: '<', version: { major: 0, minor: base.minor + 1, patch: 0, raw: `0.${base.minor + 1}.0` } },
      ];
    } else {
      // ^0.0.3 -> =0.0.3
      return [{ op: '=', version: base }];
    }
  }

  // Tilde range ~1.2.3
  if (trimmed.startsWith('~')) {
    const base = parseExactSemver(trimmed.substring(1));
    if (!base) return null;
    return [
      { op: '>=', version: base },
      { op: '<', version: { major: base.major, minor: base.minor + 1, patch: 0, raw: `${base.major}.${base.minor + 1}.0` } },
    ];
  }

  // Wildcard e.g. 14.x or 14.* or 14
  const xMatch = /^(\d+)(?:\.([xX*]|\d+))?(?:\.([xX*]|\d+))?$/.exec(trimmed);
  if (xMatch) {
    const major = parseInt(xMatch[1], 10);
    const minorStr = xMatch[2];
    const patchStr = xMatch[3];

    if (minorStr === undefined || minorStr === 'x' || minorStr === 'X' || minorStr === '*') {
      // 14 or 14.x -> >=14.0.0 <15.0.0
      return [
        { op: '>=', version: { major, minor: 0, patch: 0, raw: `${major}.0.0` } },
        { op: '<', version: { major: major + 1, minor: 0, patch: 0, raw: `${major + 1}.0.0` } },
      ];
    }

    const minor = parseInt(minorStr, 10);
    if (patchStr === undefined || patchStr === 'x' || patchStr === 'X' || patchStr === '*') {
      // 14.2 or 14.2.x -> >=14.2.0 <14.3.0
      return [
        { op: '>=', version: { major, minor, patch: 0, raw: `${major}.${minor}.0` } },
        { op: '<', version: { major, minor: minor + 1, patch: 0, raw: `${major}.${minor + 1}.0` } },
      ];
    }
  }

  // Operators: >=, <=, >, <, =, !=
  const opMatch = /^(>=|<=|>|<|=|!=)?\s*(.+)$/.exec(trimmed);
  if (!opMatch) return null;

  const op = (opMatch[1] as ComparatorOp) ?? '=';
  const ver = parseExactSemver(opMatch[2]);
  if (!ver) return null;

  return { op, version: ver };
}

function evaluateComparator(ver: ParsedSemver, comp: SimpleComparator): boolean {
  const cmp = compareSemver(ver, comp.version);
  switch (comp.op) {
    case '>':
      return cmp > 0;
    case '>=':
      return cmp >= 0;
    case '<':
      return cmp < 0;
    case '<=':
      return cmp <= 0;
    case '=':
      return cmp === 0;
    case '!=':
      return cmp !== 0;
  }
}
