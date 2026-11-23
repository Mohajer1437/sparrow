export type QualityProfile = 'MVP' | 'STANDARD' | 'PRODUCTION';

export const DEFAULT_QUALITY_PROFILE: QualityProfile = 'STANDARD';

export function parseQualityProfile(value: unknown): QualityProfile {
  if (value === 'MVP' || value === 'STANDARD' || value === 'PRODUCTION') {
    return value;
  }
  return DEFAULT_QUALITY_PROFILE;
}
