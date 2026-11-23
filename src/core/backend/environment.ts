import { TestEnvironmentClass } from '../../domain/test-credential';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function classifyBaseUrl(baseUrl: string): TestEnvironmentClass {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'unknown';
    const host = url.hostname.toLowerCase();
    if (LOCAL_HOSTS.has(host)) return 'test';
    if (host.endsWith('.localhost')) return 'test';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function isSafeTestBaseUrl(baseUrl: string): boolean {
  return classifyBaseUrl(baseUrl) === 'test';
}
