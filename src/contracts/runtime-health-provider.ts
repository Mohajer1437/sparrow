import { RuntimeHealth } from '../domain/runtime-health';

export interface RuntimeHealthProvider {
  collect(): Promise<RuntimeHealth>;
  isAvailable(): Promise<boolean>;
}
