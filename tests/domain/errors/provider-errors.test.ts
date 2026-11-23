import {
  ProviderError,
  ProviderAuthenticationError,
  ProviderRateLimitError,
  ProviderContextLengthExceededError,
  ProviderUnavailableError,
  ProviderInvalidResponseError,
  ProviderModelNotFoundError,
} from '../../../src/domain/errors/provider-errors';

describe('Provider Errors', () => {
  it('should create ProviderError with correct name', () => {
    const err = new ProviderError('base error');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.name).toBe('ProviderError');
    expect(err.message).toBe('base error');
  });

  it('should create ProviderAuthenticationError', () => {
    const err = new ProviderAuthenticationError('invalid key');
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.name).toBe('ProviderAuthenticationError');
  });

  it('should create ProviderRateLimitError with optional retryAfterMs', () => {
    const err = new ProviderRateLimitError('rate limited', 5000);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.name).toBe('ProviderRateLimitError');
    expect(err.retryAfterMs).toBe(5000);
  });

  it('should create ProviderRateLimitError without retryAfterMs', () => {
    const err = new ProviderRateLimitError('rate limited');
    expect(err.retryAfterMs).toBeUndefined();
  });

  it('should create ProviderContextLengthExceededError with optional maxTokens', () => {
    const err = new ProviderContextLengthExceededError('too long', 8192);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.maxTokens).toBe(8192);
  });

  it('should create ProviderUnavailableError', () => {
    const err = new ProviderUnavailableError('offline');
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.name).toBe('ProviderUnavailableError');
  });

  it('should create ProviderInvalidResponseError', () => {
    const err = new ProviderInvalidResponseError('malformed');
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.name).toBe('ProviderInvalidResponseError');
  });

  it('should create ProviderModelNotFoundError', () => {
    const err = new ProviderModelNotFoundError('gpt-5');
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.name).toBe('ProviderModelNotFoundError');
  });

  it('should create ProviderExhaustedError with attempts', () => {
    const { ProviderExhaustedError } = require('../../../src/domain/errors/provider-errors');
    const err = new ProviderExhaustedError('all failed', [
      { providerName: 'ollama', category: 'unavailable', message: 'down' },
    ]);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.name).toBe('ProviderExhaustedError');
    expect(err.attempts).toHaveLength(1);
    expect((err as any).isRetryable).toBeUndefined();
  });

  it('errors should not encode retry policy', () => {
    // Architectural invariant: errors describe facts, not policies.
    const err = new ProviderRateLimitError('rate limited');
    expect((err as any).isRetryable).toBeUndefined();
    expect((err as any).retryable).toBeUndefined();
    expect((err as any).fatal).toBeUndefined();
  });
});
