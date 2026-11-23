import { QualityProfile } from './quality-profile';
import { VerificationCategory } from './verification-check';

export interface RegressionBrowserAssertion {
  readonly kind: string;
  readonly value: string;
}

export interface RegressionCase {
  readonly id: string;
  readonly createdAt: string;
  readonly qualityProfile: QualityProfile;
  readonly category: VerificationCategory;
  readonly checkId: string;
  readonly name: string;
  readonly acceptanceCriterion?: string;
  readonly expectedBehavior: string;
  readonly method?: string;
  readonly url?: string;
  readonly route?: string;
  readonly requestData?: string;
  readonly requestHeaders?: Readonly<Record<string, string>>;
  readonly scenario?: string;
  readonly expectedStatuses?: ReadonlyArray<number>;
  readonly browserRoute?: string;
  readonly browserAssertions?: ReadonlyArray<RegressionBrowserAssertion>;
  readonly expectedState?: string;
  readonly relevantFiles?: ReadonlyArray<string>;
  readonly evidence: string;
}
