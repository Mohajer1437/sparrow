import * as fs from 'fs/promises';
import * as path from 'path';

export interface RetryOptions {
  maxAttempts: number;
  backoffMs: number;
  shouldRetry: (error: any) => boolean;
  onRetry?: (attempt: number, error: any, delayMs: number) => void;
  debugDir?: string;
  saveDebugLog?: (attempt: number, content: string, error: any) => Promise<string | undefined>;
}

export class RetryExecutor {
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute a function with automatic retry on transient failures.
   * Implements exponential backoff with jitter.
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions
  ): Promise<T> {
    const { maxAttempts, backoffMs, shouldRetry, onRetry } = options;
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;

        if (attempt >= maxAttempts || !shouldRetry(error)) {
          throw error;
        }

        // Exponential backoff with jitter
        const delay = backoffMs * Math.pow(2, attempt - 1) + Math.random() * 1000;

        if (onRetry) {
          onRetry(attempt, error, delay);
        }

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Check if error is a transient Ollama error (500, timeout, etc.)
   */
  static isTransientError(error: any): boolean {
    const message = error?.message || String(error);
    
    // Ollama 500 errors
    if (message.includes('500') || message.includes('Internal Server Error')) {
      return true;
    }
    
    // Timeouts
    if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
      return true;
    }
    
    // Connection errors
    if (message.includes('ECONNRESET') || message.includes('ECONNREFUSED')) {
      return true;
    }
    
    // JSON parse failures (sometimes transient)
    if (message.includes('Failed to parse') || message.includes('JSON')) {
      return true;
    }
    
    return false;
  }

  /**
   * Save debug log to .ai/knowledge/debug/
   */
  async saveDebugLog(
    stage: string,
    attempt: number,
    content: string,
    error?: any
  ): Promise<string | undefined> {
    try {
      const debugDir = '.ai/knowledge/debug';
      await fs.mkdir(debugDir, { recursive: true });
      const filename = `${stage}_attempt_${attempt}.txt`;
      const debugPath = path.join(debugDir, filename);
      
      const header = `=== DEBUG LOG ===
Stage: ${stage}
Attempt: ${attempt}
Timestamp: ${new Date().toISOString()}
Error: ${error?.message || 'Unknown'}
Content length: ${content.length} chars

=== RAW CONTENT ===
`;
      await fs.writeFile(debugPath, header + content, 'utf-8');
      console.log(`   📄 Debug saved: ${debugPath}`);
      return debugPath;
    } catch (e: any) {
      console.log(`   ⚠️  Could not save debug log: ${e.message}`);
      return undefined;
    }
  }
}
