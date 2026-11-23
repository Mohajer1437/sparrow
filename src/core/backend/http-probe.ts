import { redactText } from '../security/secret-redaction';

const STACK_TRACE = /\n\s+at\s+\S+/;
const EXCEPTION_PAGE = /<(html|body)[\s>][\s\S]*(exception|stack trace|error occurred|whitelabel error)/i;
const NEST_EXCEPTION = /HttpException|UnhandledPromiseRejection|Cannot GET|Cannot POST/i;

export interface HttpProbeResult {
  readonly status: number;
  readonly body: string;
  readonly contentType: string;
  readonly timedOut: boolean;
  readonly connectionError?: string;
}

export async function probeHttp(input: {
  readonly url: string;
  readonly method: string;
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}): Promise<HttpProbeResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    if (typeof (timer as NodeJS.Timeout).unref === 'function') (timer as NodeJS.Timeout).unref();
    const method = input.method.toUpperCase();
    const res = await fetch(input.url, {
      method,
      headers: { ...input.headers },
      body: method === 'GET' || method === 'HEAD' ? undefined : input.body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const raw = await res.text().catch(() => '');
    const body = raw.slice(0, input.maxResponseBytes);
    return {
      status: res.status,
      body,
      contentType: res.headers.get('content-type') || '',
      timedOut: false,
    };
  } catch (error: any) {
    const message = String(error?.message || 'request failed');
    const timedOut = error?.name === 'AbortError' || /aborted|timeout/i.test(message);
    return {
      status: 0,
      body: '',
      contentType: '',
      timedOut,
      connectionError: timedOut ? 'timeout' : message,
    };
  }
}

export function looksLikeUnhandledException(result: HttpProbeResult): boolean {
  if (result.status >= 500) return true;
  if (result.connectionError && !result.timedOut) return true;
  if (STACK_TRACE.test(result.body)) return true;
  if (EXCEPTION_PAGE.test(result.body)) return true;
  if (NEST_EXCEPTION.test(result.body) && result.status >= 500) return true;
  return false;
}

export function summarizeBody(body: string, max = 400): string {
  return redactText(body.replace(/\s+/g, ' ').trim()).slice(0, max);
}

export function redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/authorization|cookie|token|secret|password|api[-_]?key/i.test(key)) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = redactText(value);
    }
  }
  return out;
}
