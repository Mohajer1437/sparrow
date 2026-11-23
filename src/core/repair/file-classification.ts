import {
  RepairFileCategory,
  normalizeObjectivePath,
} from '../../domain/repair/repair-objective';

/**
 * R4.13/R4.14/R4.15: decide what kind of artifact a path is.
 *
 * Editing a test or a build config is not wrong on its own, but it is a
 * different act from editing the implementation, and repair policy has to be
 * able to tell them apart before it can ask whether the original task
 * authorised it. Classification is purely by path, so it is stable and cheap.
 */

const TEST_DIR = /(^|\/)(tests?|__tests__|spec|e2e|cypress|playwright)(\/|$)/i;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/i;
const FEATURE_FILE = /\.feature$/i;

const CONFIG_FILES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'tsconfig.json',
  'tsconfig.build.json',
  'jsconfig.json',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'babel.config.js',
  '.babelrc',
  'tailwind.config.js',
  'tailwind.config.ts',
  'postcss.config.js',
  'webpack.config.js',
  'vite.config.ts',
  'vite.config.js',
  'nest-cli.json',
]);

const CONFIG_PATTERN =
  /(^|\/)(\.eslintrc|eslint\.config|\.prettierrc|jest\.config|vitest\.config|playwright\.config|cypress\.config|karma\.conf|\.env|\.npmrc|\.nvmrc|docker-compose|Dockerfile)/i;

/** Artifacts that describe *how* the run is verified, not what it produces. */
const VERIFICATION_PATTERN =
  /(^|\/)\.ai\/|(^|\/)(intent-contract|acceptance|verification|quality-policy|test-inventory|endpoint-inventory)[.-]/i;

const DOC_PATTERN = /\.(md|mdx|txt|rst|adoc)$/i;

const SOURCE_PATTERN =
  /\.([cm]?[jt]sx?|vue|svelte|css|scss|less|html|json5|py|go|rs|java|kt|rb|php|cs)$/i;

export function classifyRepairFile(file: string): RepairFileCategory {
  const path = normalizeObjectivePath(file || '').trim();
  if (path.length === 0) return 'UNKNOWN';

  // Verification artifacts are checked first: `.ai/quality-policy.json` is a
  // config file by shape, but weakening it is a verification bypass, which is
  // the more serious reading.
  if (VERIFICATION_PATTERN.test(path)) return 'VERIFICATION';

  const base = path.slice(path.lastIndexOf('/') + 1);
  if (CONFIG_FILES.has(base) || CONFIG_PATTERN.test(path)) return 'CONFIG';

  if (TEST_DIR.test(path) || TEST_FILE.test(path) || FEATURE_FILE.test(path)) return 'TEST';

  if (DOC_PATTERN.test(path)) return 'DOC';
  if (SOURCE_PATTERN.test(path)) return 'SOURCE';
  return 'UNKNOWN';
}

export function isTestFile(file: string): boolean {
  return classifyRepairFile(file) === 'TEST';
}

export function isConfigFile(file: string): boolean {
  return classifyRepairFile(file) === 'CONFIG';
}

export function isVerificationArtifact(file: string): boolean {
  return classifyRepairFile(file) === 'VERIFICATION';
}
