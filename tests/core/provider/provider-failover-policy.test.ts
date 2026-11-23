import {
  classifyProviderFailure,
  isFailoverCandidate,
  safeProviderFailureReason,
} from '../../../src/core/provider/provider-failover-policy';
import {
  ProviderAuthenticationError,
  ProviderContextLengthExceededError,
  ProviderError,
  ProviderInvalidResponseError,
  ProviderModelNotFoundError,
  ProviderRateLimitError,
  ProviderUnavailableError,
} from '../../../src/domain/errors/provider-errors';

describe('provider-failover-policy', () => {
  it('fails over on connection / unavailable', () => {
    const err = new ProviderUnavailableError('connection refused');
    expect(classifyProviderFailure(err)).toBe('unavailable');
    expect(isFailoverCandidate(err)).toBe(true);
  });

  it('fails over on timeout', () => {
    const err = new ProviderUnavailableError('request timed out or was aborted');
    expect(classifyProviderFailure(err)).toBe('timeout');
    expect(isFailoverCandidate(err)).toBe(true);
  });

  it('fails over on AbortError-like objects', () => {
    const err = Object.assign(new Error('Aborted'), { name: 'AbortError' });
    expect(classifyProviderFailure(err)).toBe('timeout');
    expect(isFailoverCandidate(err)).toBe(true);
  });

  it('fails over on rate limit / 429', () => {
    const err = new ProviderRateLimitError('HTTP 429');
    expect(classifyProviderFailure(err)).toBe('rate_limit');
    expect(isFailoverCandidate(err)).toBe(true);
  });

  it('fails over on 502/503 message equivalents', () => {
    expect(isFailoverCandidate(new Error('HTTP 502 bad gateway'))).toBe(true);
    expect(isFailoverCandidate(new Error('HTTP 503 service unavailable'))).toBe(true);
  });

  it('does NOT fail over on authentication', () => {
    const err = new ProviderAuthenticationError('invalid key');
    expect(isFailoverCandidate(err)).toBe(false);
    expect(classifyProviderFailure(err)).toBe('authentication');
  });

  it('does NOT fail over on model not found', () => {
    expect(isFailoverCandidate(new ProviderModelNotFoundError('missing'))).toBe(false);
  });

  it('does NOT fail over on context length', () => {
    expect(isFailoverCandidate(new ProviderContextLengthExceededError('too long'))).toBe(false);
  });

  it('does NOT fail over on invalid response', () => {
    expect(isFailoverCandidate(new ProviderInvalidResponseError('bad json'))).toBe(false);
  });

  it('does NOT fail over on generic application ProviderError', () => {
    expect(isFailoverCandidate(new ProviderError('malformed request'))).toBe(false);
    expect(classifyProviderFailure(new ProviderError('malformed request'))).toBe('application');
  });

  it('sanitizes secrets from failure reasons', () => {
    const reason = safeProviderFailureReason(
      new ProviderAuthenticationError('Bearer sk-abcdefghijklmnopqrstuvwxyz Authorization failed'),
    );
    expect(reason).not.toMatch(/sk-abcdefgh/);
    expect(reason).toMatch(/\*\*\*/);
  });
});
