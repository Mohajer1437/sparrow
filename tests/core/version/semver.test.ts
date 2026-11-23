import {
  compareSemver,
  parseExactSemver,
  parseSemver,
  satisfiesRange,
} from '../../../src/core/version/semver';

describe('Version Normalization & SemVer', () => {
  describe('parseSemver', () => {
    it('parses exact semver strings', () => {
      const v = parseSemver('14.2.35');
      expect(v.isExact).toBe(true);
      expect(v.isRange).toBe(false);
      expect(v.isUnknown).toBe(false);
      expect(v.major).toBe(14);
      expect(v.minor).toBe(2);
      expect(v.patch).toBe(35);
      expect(v.normalizedString).toBe('14.2.35');
    });

    it('parses semver with leading v', () => {
      const v = parseSemver('v7.2.1');
      expect(v.isExact).toBe(true);
      expect(v.major).toBe(7);
      expect(v.minor).toBe(2);
      expect(v.patch).toBe(1);
      expect(v.normalizedString).toBe('7.2.1');
    });

    it('parses prerelease versions', () => {
      const v = parseSemver('15.0.0-rc.1');
      expect(v.isExact).toBe(true);
      expect(v.major).toBe(15);
      expect(v.minor).toBe(0);
      expect(v.patch).toBe(0);
      expect(v.prerelease).toBe('rc.1');
      expect(v.normalizedString).toBe('15.0.0-rc.1');
    });

    it('identifies caret range strings', () => {
      const v = parseSemver('^16.0.0');
      expect(v.isRange).toBe(true);
      expect(v.isExact).toBe(false);
      expect(v.isUnknown).toBe(false);
      expect(v.normalizedString).toBe('^16.0.0');
    });

    it('identifies tilde range strings', () => {
      const v = parseSemver('~7.0.0');
      expect(v.isRange).toBe(true);
      expect(v.isExact).toBe(false);
      expect(v.normalizedString).toBe('~7.0.0');
    });

    it('identifies inequality range strings', () => {
      const v = parseSemver('>=14.0.0 <15.0.0');
      expect(v.isRange).toBe(true);
      expect(v.isExact).toBe(false);
      expect(v.normalizedString).toBe('>=14.0.0 <15.0.0');
    });

    it('handles unknown and invalid version strings safely', () => {
      expect(parseSemver(undefined).isUnknown).toBe(true);
      expect(parseSemver('').isUnknown).toBe(true);
      expect(parseSemver('UNKNOWN').isUnknown).toBe(true);
      expect(parseSemver('unknown').isUnknown).toBe(true);
      expect(parseSemver('invalid-string-xyz').isUnknown).toBe(true);
      expect(parseSemver('invalid-string-xyz').normalizedString).toBe('UNKNOWN');
    });
  });

  describe('compareSemver', () => {
    it('compares versions correctly', () => {
      expect(compareSemver('14.0.0', '14.2.0')).toBe(-1);
      expect(compareSemver('15.0.0', '14.9.9')).toBe(1);
      expect(compareSemver('7.1.0', '7.1.0')).toBe(0);
      expect(compareSemver('15.0.0-rc.1', '15.0.0')).toBe(-1);
    });
  });

  describe('satisfiesRange', () => {
    it('matches exact version requirements', () => {
      expect(satisfiesRange('14.2.0', '14.2.0')).toBe(true);
      expect(satisfiesRange('14.2.1', '14.2.0')).toBe(false);
    });

    it('matches caret ranges', () => {
      expect(satisfiesRange('14.2.35', '^14.2.0')).toBe(true);
      expect(satisfiesRange('14.1.0', '^14.2.0')).toBe(false);
      expect(satisfiesRange('15.0.0', '^14.2.0')).toBe(false);

      expect(satisfiesRange('0.2.5', '^0.2.0')).toBe(true);
      expect(satisfiesRange('0.3.0', '^0.2.0')).toBe(false);

      expect(satisfiesRange('0.0.3', '^0.0.3')).toBe(true);
      expect(satisfiesRange('0.0.4', '^0.0.3')).toBe(false);
    });

    it('matches tilde ranges', () => {
      expect(satisfiesRange('14.2.5', '~14.2.0')).toBe(true);
      expect(satisfiesRange('14.3.0', '~14.2.0')).toBe(false);
    });

    it('matches inequality ranges with bounds', () => {
      expect(satisfiesRange('14.2.35', '>=14.0.0 <15.0.0')).toBe(true);
      expect(satisfiesRange('15.0.0', '>=14.0.0 <15.0.0')).toBe(false);
      expect(satisfiesRange('13.9.0', '>=14.0.0 <15.0.0')).toBe(false);
      expect(satisfiesRange('7.2.1', '>=7.0.0 <8.0.0')).toBe(true);
      expect(satisfiesRange('6.9.0', '>=7.0.0 <8.0.0')).toBe(false);
    });

    it('matches wildcard and X-ranges', () => {
      expect(satisfiesRange('14.2.35', '14.x')).toBe(true);
      expect(satisfiesRange('14.0.0', '14.*')).toBe(true);
      expect(satisfiesRange('15.0.0', '14.x')).toBe(false);
      expect(satisfiesRange('7.2.1', '7.x')).toBe(true);
      expect(satisfiesRange('6.2.1', '7.x')).toBe(false);
      expect(satisfiesRange('7.2.1', '*')).toBe(true);
    });

    it('matches OR union ranges', () => {
      expect(satisfiesRange('14.2.0', '^14.0.0 || ^15.0.0')).toBe(true);
      expect(satisfiesRange('15.1.0', '^14.0.0 || ^15.0.0')).toBe(true);
      expect(satisfiesRange('16.0.0', '^14.0.0 || ^15.0.0')).toBe(false);
    });

    it('returns false for unparseable versions or invalid ranges', () => {
      expect(satisfiesRange('UNKNOWN', '>=14.0.0')).toBe(false);
      expect(satisfiesRange('14.2.0', undefined)).toBe(false);
      expect(satisfiesRange(undefined, '14.2.0')).toBe(false);
    });
  });
});
