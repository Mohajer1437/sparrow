/**
 * Selects the preferred provider from healthy availability results.
 * Core does not depend on CLI — interactive prompting is injected via port.
 */

import { ExecutionLogger } from '../observability/execution-logger';
import { ProviderAvailabilityEntry } from './provider-availability-service';

export type ProviderSelectionSource =
  | 'explicit'
  | 'automatic'
  | 'interactive'
  | 'failover';

export interface ProviderSelectionPrompt {
  /**
   * Ask the user to pick one provider name from the healthy list.
   * Must return a name that exists in `healthy`.
   */
  chooseProvider(
    healthy: ReadonlyArray<{ name: string; type: string }>,
  ): Promise<string>;
}

export interface ProviderSelectionResult {
  readonly preferredName: string;
  readonly orderedNames: ReadonlyArray<string>;
  readonly source: ProviderSelectionSource;
  readonly healthy: ReadonlyArray<ProviderAvailabilityEntry>;
}

export class NoHealthyProvidersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoHealthyProvidersError';
  }
}

export class ProviderSelectionRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderSelectionRequiredError';
  }
}

export class ProviderSelectionService {
  /**
   * @param healthy - already-filtered healthy entries (sorted by discover order)
   * @param explicitActive - persisted active profile name from `provider use`, if any
   * @param prompt - required when multiple healthy and no usable explicit selection
   */
  async select(
    healthy: ReadonlyArray<ProviderAvailabilityEntry>,
    explicitActive: string | null | undefined,
    prompt?: ProviderSelectionPrompt,
  ): Promise<ProviderSelectionResult> {
    if (healthy.length === 0) {
      throw new NoHealthyProvidersError(
        'No healthy providers available. Configure a provider and verify with: agent provider health',
      );
    }

    const byName = new Map(healthy.map((h) => [h.name, h]));
    const sortedNames = healthy.map((h) => h.name); // discover order already sorted

    // Explicit selection that is currently healthy → preferred start, no prompt
    if (explicitActive && byName.has(explicitActive)) {
      const ordered = preferFirst(sortedNames, explicitActive);
      const result: ProviderSelectionResult = {
        preferredName: explicitActive,
        orderedNames: ordered,
        source: 'explicit',
        healthy,
      };
      this.emitSelected(result);
      return result;
    }

    if (healthy.length === 1) {
      const preferredName = healthy[0].name;
      const result: ProviderSelectionResult = {
        preferredName,
        orderedNames: [preferredName],
        source: 'automatic',
        healthy,
      };
      this.emitSelected(result);
      return result;
    }

    // 2+ healthy, no usable explicit → must ask
    if (!prompt) {
      throw new ProviderSelectionRequiredError(
        `Multiple healthy providers available (${sortedNames.join(', ')}). `
        + `Select one with: agent provider use <name>`,
      );
    }

    const chosen = await prompt.chooseProvider(
      healthy.map((h) => ({ name: h.name, type: h.type })),
    );
    if (!byName.has(chosen)) {
      throw new ProviderSelectionRequiredError(
        `Invalid provider selection "${chosen}". Available: ${sortedNames.join(', ')}`,
      );
    }

    const ordered = preferFirst(sortedNames, chosen);
    const result: ProviderSelectionResult = {
      preferredName: chosen,
      orderedNames: ordered,
      source: 'interactive',
      healthy,
    };
    this.emitSelected(result);
    return result;
  }

  private emitSelected(result: ProviderSelectionResult): void {
    ExecutionLogger.log(
      'PROVIDER_SELECTED',
      '-',
      '-',
      `provider.selected name=${result.preferredName} source=${result.source}`,
      {
        event: 'provider.selected',
        preferredName: result.preferredName,
        source: result.source,
        orderedNames: [...result.orderedNames],
      },
    );
  }
}

function preferFirst(names: ReadonlyArray<string>, preferred: string): string[] {
  const rest = names.filter((n) => n !== preferred);
  return [preferred, ...rest];
}
