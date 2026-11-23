import { EffectiveConfiguration } from '../domain/effective-configuration';

export interface ConfigurationLoader {
  /**
   * Load, merge, validate, and freeze the effective configuration.
   * Order: Built-in Defaults → Workspace Config → Environment Overrides.
   */
  load(): Promise<EffectiveConfiguration>;
}
