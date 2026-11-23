import {
  NoHealthyProvidersError,
  ProviderSelectionRequiredError,
  ProviderSelectionService,
} from '../../../src/core/provider/provider-selection-service';
import { ProviderAvailabilityEntry } from '../../../src/core/provider/provider-availability-service';
import { ProviderHealthResult } from '../../../src/domain/provider-health';

function healthy(name: string, type: 'ollama' | 'openai-compatible' = 'ollama'): ProviderAvailabilityEntry {
  const health: ProviderHealthResult = {
    providerType: type,
    endpoint: 'http://example',
    authentication: type === 'ollama' ? 'not_required' : 'ok',
    latencyMs: 1,
    status: 'healthy',
    checkedAt: new Date().toISOString(),
  };
  return {
    name,
    type,
    baseUrl: 'http://example',
    hasApiKey: type !== 'ollama',
    healthy: true,
    health,
  };
}

describe('ProviderSelectionService', () => {
  const service = new ProviderSelectionService();

  it('AC-01: zero healthy → clear failure', async () => {
    await expect(service.select([], null)).rejects.toBeInstanceOf(NoHealthyProvidersError);
  });

  it('AC-02/M: exactly one healthy → automatic, no prompt', async () => {
    const prompt = { chooseProvider: jest.fn() };
    const result = await service.select([healthy('ollama')], null, prompt);
    expect(result.source).toBe('automatic');
    expect(result.preferredName).toBe('ollama');
    expect(prompt.chooseProvider).not.toHaveBeenCalled();
  });

  it('AC-05: explicit healthy active → preferred, no prompt even if multiple', async () => {
    const prompt = { chooseProvider: jest.fn() };
    const result = await service.select(
      [healthy('ollama'), healthy('omniroute', 'openai-compatible')],
      'omniroute',
      prompt,
    );
    expect(result.source).toBe('explicit');
    expect(result.preferredName).toBe('omniroute');
    expect(result.orderedNames[0]).toBe('omniroute');
    expect(prompt.chooseProvider).not.toHaveBeenCalled();
  });

  it('AC-03/N: multiple healthy without explicit → requires prompt', async () => {
    await expect(
      service.select(
        [healthy('ollama'), healthy('omniroute', 'openai-compatible')],
        null,
      ),
    ).rejects.toBeInstanceOf(ProviderSelectionRequiredError);
  });

  it('AC-04: interactive prompt selects provider', async () => {
    const prompt = {
      chooseProvider: jest.fn(async () => 'omniroute'),
    };
    const result = await service.select(
      [healthy('ollama'), healthy('omniroute', 'openai-compatible')],
      null,
      prompt,
    );
    expect(result.source).toBe('interactive');
    expect(result.preferredName).toBe('omniroute');
    expect(prompt.chooseProvider).toHaveBeenCalledTimes(1);
  });

  it('AC-25: orderedNames keep preferred first then deterministic remainder', async () => {
    const result = await service.select(
      [healthy('alpha'), healthy('beta'), healthy('gamma')],
      'beta',
    );
    expect(result.orderedNames).toEqual(['beta', 'alpha', 'gamma']);
  });
});
