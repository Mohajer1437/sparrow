import { BackendEndpoint } from '../domain/backend-endpoint';
import { BackendVerificationLimits } from '../domain/backend-verification-limits';

export interface EndpointDiscoveryInput {
  readonly workspacePath: string;
  readonly limits: BackendVerificationLimits;
  readonly frameworks?: ReadonlyArray<string>;
  readonly discoveryHints?: ReadonlyArray<string>;
}

export interface EndpointDiscoverer {
  readonly id: string;
  discover(input: EndpointDiscoveryInput): Promise<ReadonlyArray<BackendEndpoint>>;
}
