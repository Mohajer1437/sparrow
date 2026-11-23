// E:\agentic\verify-d1.ts
import { ShellValidationEngine } from './src/core/patch/shell-validation-engine';

// Access private method via prototype for testing
const engine = new ShellValidationEngine({ commands: ['echo test'], cwd: process.cwd() });
const filter = (engine as any).filterErrorsToChangedFiles.bind(engine);

console.log('═'.repeat(70));
console.log('PHASE D.1 SANITY CHECK');
console.log('═'.repeat(70));

// ── Scenario A: Error in changed file → should FAIL ──
const resultA = {
  passed: false,
  stdout: '',
  stderr: 'src/core/foo.ts(10,5): error TS2322: Type mismatch\n  Expected string, got number',
  exitCode: 2,
  timedOut: false,
  command: 'npm run build',
};

const filteredA = filter(resultA, ['src/core/foo.ts']);
console.log('\n[A] Error in CHANGED file (src/core/foo.ts):');
console.log(`    Expected: FAIL  |  Actual: ${filteredA.passed ? 'PASS ❌' : 'FAIL ✅'}`);
console.log(`    Filtered stderr preview: ${filteredA.stderr.substring(0, 120)}`);

// ── Scenario B: Error in OTHER file → should PASS ──
const resultB = {
  passed: false,
  stdout: '',
  stderr: 'app/api/progress/[id].ts(25,26): error TS2304: Cannot find name progressStore\n\n',
  exitCode: 2,
  timedOut: false,
  command: 'npm run build',
};

const filteredB = filter(resultB, ['app/quiz/page.tsx']);
console.log('\n[B] Error in OTHER file (progress/[id].ts), changed = [quiz/page.tsx]:');
console.log(`    Expected: PASS  |  Actual: ${filteredB.passed ? 'PASS ✅' : 'FAIL ❌'}`);

// ── Scenario C: Next.js build error format ──
const resultC = {
  passed: false,
  stdout: '',
  stderr: './app/api/progress/[id].ts:25:26\nType error: Cannot find name progressStore\n\n',
  exitCode: 1,
  timedOut: false,
  command: 'npm run build',
};

const filteredC = filter(resultC, ['app/quiz/page.tsx']);
console.log('\n[C] Next.js format error in OTHER file:');
console.log(`    Expected: PASS  |  Actual: ${filteredC.passed ? 'PASS ✅' : 'FAIL ❌'}`);

// ── Scenario D: False-positive check (utils.ts vs utils-v2.ts) ──
const resultD = {
  passed: false,
  stdout: '',
  stderr: 'src/lib/utils-v2.ts(10,5): error TS2322: Type mismatch\n\n',
  exitCode: 2,
  timedOut: false,
  command: 'npm run build',
};

const filteredD = filter(resultD, ['src/lib/utils.ts']);
console.log('\n[D] False-positive check (utils.ts should NOT match utils-v2.ts):');
console.log(`    Expected: PASS  |  Actual: ${filteredD.passed ? 'PASS ✅' : 'FAIL ❌'}`);

// ── Scenario E: Multiple errors, only some in changed files ──
const resultE = {
  passed: false,
  stdout: '',
  stderr: [
    'app/api/progress/[id].ts(25,26): error TS2304: pre-existing error',
    'src/core/foo.ts(10,5): error TS2322: NEW error from agent',
    'src/lib/other.ts(5,1): error TS1005: another pre-existing',
  ].join('\n'),
  exitCode: 2,
  timedOut: false,
  command: 'npm run build',
};

const filteredE = filter(resultE, ['src/core/foo.ts']);
console.log('\n[E] Multiple errors, only ONE in changed files:');
console.log(`    Expected: FAIL  |  Actual: ${filteredE.passed ? 'PASS ❌' : 'FAIL ✅'}`);
console.log(`    Filtered should mention foo.ts only: ${filteredE.stderr.includes('foo.ts') ? '✅' : '❌'}`);
console.log(`    Filtered should NOT mention progress/[id]: ${!filteredE.stderr.includes('progress/[id]') ? '✅' : '❌'}`);

// ── Scenario F: Empty changedFiles (backward compat) ──
const filteredF = filter(resultA, []);
console.log('\n[F] Empty changedFiles (backward compat):');
console.log(`    Expected: no errors in empty set → PASS`);
console.log(`    Actual: ${filteredF.passed ? 'PASS ✅' : 'FAIL'}`);

console.log('\n' + '═'.repeat(70));
const allPassed = !filteredA.passed && filteredB.passed && filteredC.passed && filteredD.passed && !filteredE.passed;
console.log(`OVERALL: ${allPassed ? 'ALL SCENARIOS CORRECT ✅' : 'SOME SCENARIOS FAILED ❌'}`);
console.log('═'.repeat(70));

process.exit(allPassed ? 0 : 1);