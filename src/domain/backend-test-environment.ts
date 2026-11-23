import { isSafeTestBaseUrl } from '../core/backend/environment';

export interface BackendTestEnvironmentConfig {
  readonly root: string;
  readonly baseUrl: string;
  readonly port: number;
  readonly host: string;
  readonly healthEndpoint: string;
  readonly databasePath: string;
  readonly auth: {
    readonly userToken: string;
    readonly adminToken: string;
  };
  readonly adminCredentialRequirement: string;
  readonly startupCommand: string;
}

export interface BackendTestProcess {
  readonly pid?: number;
  readonly baseUrl: string;
  readonly port: number;
  readonly stop: () => Promise<void>;
}

export function validateBackendEnvironmentConfig(config: BackendTestEnvironmentConfig): void {
  if (!config.root || typeof config.root !== 'string') {
    throw new Error('Backend test environment requires a valid root directory path');
  }
  if (!config.baseUrl || !isSafeTestBaseUrl(config.baseUrl)) {
    throw new Error(`Unsafe backend test base URL: "${config.baseUrl}". Only local test environments (localhost / 127.0.0.1) are permitted.`);
  }
  if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) {
    throw new Error(`Invalid port number: ${config.port}`);
  }
}

export async function checkBackendHealth(
  baseUrl: string,
  healthPath = '/api/health',
  timeoutMs = 3000,
): Promise<{ readonly healthy: boolean; readonly status?: number; readonly details?: string }> {
  try {
    const url = `${baseUrl.replace(/\/+$/, '')}${healthPath.startsWith('/') ? '' : '/'}${healthPath}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text().catch(() => '');
    return {
      healthy: res.status === 200,
      status: res.status,
      details: text.slice(0, 200),
    };
  } catch (err: any) {
    return {
      healthy: false,
      details: err?.message || 'Connection failed',
    };
  }
}
