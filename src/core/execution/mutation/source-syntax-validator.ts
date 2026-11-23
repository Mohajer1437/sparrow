import * as ts from 'typescript';
import * as path from 'path';

/**
 * Reliability Hardening R2 — deterministic syntax validation (R2.8, R2.9).
 *
 * Uses the TypeScript parser that already ships with this repository. Parsing
 * a single file is cheap (no program, no type checker, no module resolution),
 * which is what makes it usable on every write instead of a project build
 * (R2.29).
 *
 * This answers exactly one question — "is this text a well-formed source
 * file?" — and deliberately not "is this correct code". Type errors and
 * product defects remain V&V's job (R2.22).
 */

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'] as const;

export interface SyntaxValidationResult {
  /** null when the file type has no deterministic validator available. */
  readonly valid: boolean | null;
  readonly applicable: boolean;
  readonly language: string;
  readonly errors: ReadonlyArray<string>;
  readonly detail?: string;
}

const NOT_APPLICABLE = (language: string): SyntaxValidationResult => Object.freeze({
  valid: null,
  applicable: false,
  language,
  errors: Object.freeze([]),
});

export function isSyntaxCheckable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return (SUPPORTED_EXTENSIONS as ReadonlyArray<string>).includes(ext);
}

export class SourceSyntaxValidator {
  validate(filePath: string, content: string): SyntaxValidationResult {
    const ext = path.extname(filePath).toLowerCase();
    if (!isSyntaxCheckable(filePath)) return NOT_APPLICABLE(ext || 'unknown');

    // JSX must stay enabled for .js/.jsx too: a Next.js project routinely puts
    // JSX in .js files, and parsing those without JSX would report a false
    // syntax error and roll back a perfectly good write.
    const scriptKind = ext === '.ts' || ext === '.mts' || ext === '.cts'
      ? ts.ScriptKind.TS
      : ext === '.tsx'
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.JSX;

    let sourceFile: ts.SourceFile;
    try {
      sourceFile = ts.createSourceFile(
        path.basename(filePath),
        content,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ false,
        scriptKind,
      );
    } catch (error: any) {
      return Object.freeze({
        valid: false,
        applicable: true,
        language: ext,
        errors: Object.freeze([`parser threw: ${error?.message ?? String(error)}`]),
        detail: `parser threw: ${error?.message ?? String(error)}`,
      });
    }

    const diagnostics = collectParseDiagnostics(sourceFile);
    if (diagnostics.length === 0) {
      return Object.freeze({ valid: true, applicable: true, language: ext, errors: Object.freeze([]) });
    }

    const errors = diagnostics.slice(0, 5).map(diagnostic => formatDiagnostic(sourceFile, diagnostic));
    return Object.freeze({
      valid: false,
      applicable: true,
      language: ext,
      errors: Object.freeze(errors),
      detail: `${diagnostics.length} syntax error(s): ${errors.join(' | ')}`,
    });
  }
}

/**
 * `parseDiagnostics` is internal to the compiler API but is the only place a
 * standalone parse records syntax errors, so it is read defensively.
 */
function collectParseDiagnostics(sourceFile: ts.SourceFile): ReadonlyArray<ts.Diagnostic> {
  const raw = (sourceFile as unknown as { parseDiagnostics?: ReadonlyArray<ts.Diagnostic> }).parseDiagnostics;
  if (Array.isArray(raw)) return raw;
  return [];
}

function formatDiagnostic(sourceFile: ts.SourceFile, diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  if (typeof diagnostic.start !== 'number') return message;
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
  return `line ${line + 1}:${character + 1} ${message}`;
}
