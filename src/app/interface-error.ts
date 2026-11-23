/**
 * One error vocabulary for every interface (H.19).
 *
 * CLI, REPL and the Web API translate failures through this module so the same
 * condition is named identically everywhere. The public shape carries a code
 * and a short message only: stack traces, provider credentials, tokens and
 * environment values never reach an interface response.
 */

export const INTERFACE_ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'BLOCKED',
  'REQUIRES_TEST_CREDENTIAL',
  'UNSAFE_ENVIRONMENT',
  'TIMEOUT',
  'METHOD_NOT_ALLOWED',
  'NOT_IMPLEMENTED',
  'INTERNAL_ERROR',
] as const;

export type InterfaceErrorCode = (typeof INTERFACE_ERROR_CODES)[number];

export interface InterfaceErrorBody {
  readonly error: {
    readonly code: InterfaceErrorCode;
    readonly message: string;
    /** Original application-level code, when a narrower one exists. */
    readonly detailCode?: string;
  };
}

const HTTP_STATUS: Readonly<Record<InterfaceErrorCode, number>> = Object.freeze({
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  BLOCKED: 409,
  REQUIRES_TEST_CREDENTIAL: 428,
  UNSAFE_ENVIRONMENT: 403,
  TIMEOUT: 504,
  METHOD_NOT_ALLOWED: 405,
  NOT_IMPLEMENTED: 501,
  INTERNAL_ERROR: 500,
});

export class InterfaceError extends Error {
  constructor(
    readonly code: InterfaceErrorCode,
    message: string,
    readonly detailCode?: string,
  ) {
    super(message);
    this.name = 'InterfaceError';
  }
}

export function httpStatusFor(code: InterfaceErrorCode): number {
  return HTTP_STATUS[code];
}

export function toInterfaceErrorBody(code: InterfaceErrorCode, message: string, detailCode?: string): InterfaceErrorBody {
  return Object.freeze({
    error: Object.freeze({ code, message, ...(detailCode ? { detailCode } : {}) }),
  });
}

/**
 * Classifies an application-layer error without ever forwarding its stack or
 * an unrecognised message body. Unknown failures collapse to INTERNAL_ERROR
 * with a fixed message, because an unclassified message may embed a path,
 * command line or credential.
 */
export function classifyError(error: unknown): InterfaceErrorBody {
  if (error instanceof InterfaceError) {
    return toInterfaceErrorBody(error.code, error.message, error.detailCode);
  }
  const appCode = (error as { code?: unknown })?.code;
  if (typeof appCode === 'string') {
    const message = error instanceof Error ? error.message : 'Request failed';
    switch (appCode) {
      case 'INVALID_TASK_ID':
      case 'INVALID_RUN_ID':
      case 'INVALID_CONTEXT_INDEX':
        return toInterfaceErrorBody('VALIDATION_ERROR', message, appCode);
      case 'TASK_NOT_FOUND':
      case 'RUN_NOT_FOUND':
      case 'TASK_RUN_MISMATCH':
      case 'CONTEXT_ITEM_NOT_FOUND':
        return toInterfaceErrorBody('NOT_FOUND', message, appCode);
      case 'REQUIRES_TEST_CREDENTIAL':
        return toInterfaceErrorBody('REQUIRES_TEST_CREDENTIAL', message, appCode);
      case 'CONFIRMATION_REQUIRED':
      case 'BLOCKED':
        return toInterfaceErrorBody('BLOCKED', message, appCode);
      case 'ETIMEDOUT':
      case 'TIMEOUT':
        return toInterfaceErrorBody('TIMEOUT', message, appCode);
      default:
        break;
    }
  }
  return toInterfaceErrorBody('INTERNAL_ERROR', 'The request could not be completed');
}
