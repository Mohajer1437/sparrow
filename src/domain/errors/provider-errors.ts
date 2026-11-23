/**
 * Provider Error Hierarchy
 * 
 * These errors describe WHAT went wrong at the Provider boundary.
 * They intentionally do NOT encode policy decisions such as
 * "retryable" or "fatal". Those decisions belong to the Pipeline
 * and RetryPolicy layers, not to the Domain.
 * 
 * This separation preserves SRP: errors describe facts,
 * policies decide reactions.
 */

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when authentication with the provider fails
 * (invalid API key, expired token, missing credentials).
 */
export class ProviderAuthenticationError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderAuthenticationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the provider rejects the request due to rate limiting.
 * The optional retryAfterMs field carries the provider's hint,
 * but whether to honor it is the Pipeline's decision.
 */
export class ProviderRateLimitError extends ProviderError {
  constructor(message: string, public readonly retryAfterMs?: number) {
    super(message);
    this.name = 'ProviderRateLimitError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the request exceeds the model's context window.
 * Carries the provider's reported limit when available.
 */
export class ProviderContextLengthExceededError extends ProviderError {
  constructor(message: string, public readonly maxTokens?: number) {
    super(message);
    this.name = 'ProviderContextLengthExceededError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the provider is unreachable
 * (network failure, DNS resolution, connection refused).
 */
export class ProviderUnavailableError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the provider returned a response that could not
 * be parsed into a valid ModelResponse.
 */
export class ProviderInvalidResponseError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderInvalidResponseError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the requested model is not available on the provider.
 */
export class ProviderModelNotFoundError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderModelNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Fact: every candidate provider in a failover cascade failed.
 * Carries attempt summaries for diagnosis — never includes secrets.
 * Policy (whether to retry the cascade) belongs to the caller, not this type.
 */
export interface ProviderFailoverAttempt {
  readonly providerName: string;
  readonly category: string;
  readonly message: string;
}

export class ProviderExhaustedError extends ProviderError {
  constructor(
    message: string,
    public readonly attempts: ReadonlyArray<ProviderFailoverAttempt> = [],
  ) {
    super(message);
    this.name = 'ProviderExhaustedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
