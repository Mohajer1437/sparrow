import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MutationGuard, MutationGuardContext } from '../../../../src/core/execution/mutation/mutation-guard';

/**
 * R2 mutation guard behaviour against a real temporary workspace.
 *
 * These are FIXTURE tests: a real filesystem, but a stub in place of the LLM
 * and the tool registry. The stub writes exactly what it is told to, which is
 * how a malformed or truncated candidate is produced deterministically.
 */

const VALID_PAGE = `'use client';

export default function Page() {
  return (
    <main>
      <h1>Hello</h1>
    </main>
  );
}
`;

const BROKEN_PAGE = `'use client';

export default function Page() {
  return (
    <main>
      <h1>Hello</h1>
  );
}
`;

let workspace: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-guard-'));
  fs.mkdirSync(path.join(workspace, 'app'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'data'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'app', 'page.tsx'), VALID_PAGE, 'utf8');
  fs.writeFileSync(path.join(workspace, 'app', 'layout.tsx'), VALID_PAGE, 'utf8');
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

function hashOf(relative: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(workspace, relative))).digest('hex');
}

function read(relative: string): string {
  return fs.readFileSync(path.join(workspace, relative), 'utf8');
}

function context(over: Partial<MutationGuardContext> = {}): MutationGuardContext {
  return {
    workspaceRoot: workspace,
    executionMode: 'STANDARD',
    todoScope: ['app/page.tsx'],
    contractScope: [],
    expectedMarkers: [],
    ...over,
  };
}

/** Stands in for the real write_file tool: writes exactly what it is given. */
function writeTool(relative: string, content: string, options: { truncateTo?: number; fail?: boolean } = {}) {
  return async () => {
    if (options.fail) return { failed: true };
    const body = options.truncateTo === undefined ? content : content.slice(0, options.truncateTo);
    fs.mkdirSync(path.dirname(path.join(workspace, relative)), { recursive: true });
    fs.writeFileSync(path.join(workspace, relative), body, 'utf8');
    return { failed: false };
  };
}

const guard = new MutationGuard();

/* ------------------------------------------------------------ target scope */

describe('R2 target scope validation (R2.3, R2.24)', () => {
  it('allows a write to the file the todo names', async () => {
    const next = VALID_PAGE.replace('<h1>Hello</h1>', '<h1>Hello</h1>\n      <p>more</p>');
    const outcome = await guard.guard(
      { toolName: 'write_file', args: { path: 'app/page.tsx', content: next }, context: context() },
      writeTool('app/page.tsx', next),
    );
    expect(outcome.unit.status).toBe('APPLIED');
    expect(read('app/page.tsx')).toBe(next);
  });

  it('blocks an out-of-scope target before the tool runs', async () => {
    const before = hashOf('app/layout.tsx');
    let invoked = false;
    const outcome = await guard.guard(
      { toolName: 'write_file', args: { path: 'app/layout.tsx', content: 'x' }, context: context() },
      async () => { invoked = true; return { failed: false }; },
    );
    expect(invoked).toBe(false);
    expect(outcome.unit.status).toBe('BLOCKED');
    expect(outcome.unit.blockedBeforeWrite).toBe(true);
    expect(outcome.unit.findings[0].code).toBe('TARGET_OUT_OF_SCOPE');
    expect(hashOf('app/layout.tsx')).toBe(before);
  });

  it('blocks a path that traverses out of the workspace', async () => {
    let invoked = false;
    const outcome = await guard.guard(
      {
        toolName: 'write_file',
        args: { path: '../escaped.ts', content: 'x' },
        context: context({ todoScope: [] }),
      },
      async () => { invoked = true; return { failed: false }; },
    );
    expect(invoked).toBe(false);
    expect(outcome.unit.findings[0].code).toBe('PATH_TRAVERSAL');
  });

  it('blocks an absolute path outside the workspace', async () => {
    const outside = path.join(os.tmpdir(), 'r2-outside.ts');
    const outcome = await guard.guard(
      {
        toolName: 'write_file',
        args: { path: outside, content: 'x' },
        context: context({ todoScope: [] }),
      },
      async () => { throw new Error('tool must not run'); },
    );
    expect(outcome.unit.findings[0].code).toBe('PATH_TRAVERSAL');
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('accepts an absolute path that resolves back inside the workspace', async () => {
    const absolute = path.join(workspace, 'app', 'page.tsx');
    const next = VALID_PAGE + '\n';
    const outcome = await guard.guard(
      { toolName: 'write_file', args: { path: absolute, content: next }, context: context() },
      writeTool('app/page.tsx', next),
    );
    expect(outcome.unit.status).toBe('APPLIED');
  });

  it('imposes no scope restriction when the todo declared none', async () => {
    const outcome = await guard.guard(
      {
        toolName: 'write_file',
        args: { path: 'app/layout.tsx', content: VALID_PAGE + '\n' },
        context: context({ todoScope: [] }),
      },
      writeTool('app/layout.tsx', VALID_PAGE + '\n'),
    );
    expect(outcome.unit.status).toBe('APPLIED');
  });
});

/* -------------------------------------------------------- creation policy */

describe('R2 file creation policy (R2.4)', () => {
  it('permits creating a file the todo explicitly named', async () => {
    const outcome = await guard.guard(
      {
        toolName: 'create_file',
        args: { path: 'src/example.ts', content: 'export const x = 1;\n' },
        context: context({ todoScope: ['src/example.ts'] }),
      },
      writeTool('src/example.ts', 'export const x = 1;\n'),
    );
    expect(outcome.unit.status).toBe('APPLIED');
    expect(fs.existsSync(path.join(workspace, 'src/example.ts'))).toBe(true);
  });

  it('refuses to create an arbitrary file just because the tool asked', async () => {
    let invoked = false;
    const outcome = await guard.guard(
      {
        toolName: 'write_file',
        args: { path: 'random-file.ts', content: 'export const x = 1;\n' },
        context: context({ todoScope: ['app/page.tsx'] }),
      },
      async () => { invoked = true; return { failed: false }; },
    );
    expect(invoked).toBe(false);
    expect(outcome.unit.findings[0].code).toBe('TARGET_OUT_OF_SCOPE');
    expect(fs.existsSync(path.join(workspace, 'random-file.ts'))).toBe(false);
  });

  it('refuses creation inside the scope directory when only a sibling file was named', async () => {
    const outcome = await guard.guard(
      {
        toolName: 'create_file',
        args: { path: 'app/page.tsx/../new.tsx', content: 'export default () => <i/>;\n' },
        context: context({ todoScope: ['app/page.tsx'] }),
      },
      async () => ({ failed: false }),
    );
    expect(outcome.unit.status).toBe('BLOCKED');
  });

  it('permits creation beneath a declared directory scope', async () => {
    const outcome = await guard.guard(
      {
        toolName: 'create_file',
        args: { path: 'src/lib/helper.ts', content: 'export const y = 2;\n' },
        context: context({ todoScope: ['src/lib'] }),
      },
      writeTool('src/lib/helper.ts', 'export const y = 2;\n'),
    );
    expect(outcome.unit.status).toBe('APPLIED');
  });
});

/* ----------------------------------------------------------- write safety */

describe('R2 write safety and read-back (R2.5, R2.7)', () => {
  it('records before and after hashes for a real change', async () => {
    const before = hashOf('app/page.tsx');
    const next = VALID_PAGE.replace('Hello', 'Hi');
    const outcome = await guard.guard(
      { toolName: 'write_file', args: { path: 'app/page.tsx', content: next }, context: context() },
      writeTool('app/page.tsx', next),
    );
    const result = outcome.unit.results[0];
    expect(result.beforeHash).toBe(before);
    expect(result.afterHash).toBe(hashOf('app/page.tsx'));
    expect(result.changed).toBe(true);
  });

  it('reports a no-op write as applied but unchanged', async () => {
    const outcome = await guard.guard(
      { toolName: 'write_file', args: { path: 'app/page.tsx', content: VALID_PAGE }, context: context() },
      writeTool('app/page.tsx', VALID_PAGE),
    );
    const result = outcome.unit.results[0];
    expect(outcome.unit.status).toBe('APPLIED');
    expect(result.changed).toBe(false);
    expect(result.beforeHash).toBe(result.afterHash);
  });

  it('rolls back when the tool itself reports failure', async () => {
    const before = hashOf('app/page.tsx');
    const outcome = await guard.guard(
      { toolName: 'write_file', args: { path: 'app/page.tsx', content: VALID_PAGE }, context: context() },
      writeTool('app/page.tsx', VALID_PAGE, { fail: true }),
    );
    expect(outcome.unit.status).toBe('ROLLED_BACK');
    expect(outcome.unit.findings.some(f => f.code === 'WRITE_FAILED')).toBe(true);
    expect(hashOf('app/page.tsx')).toBe(before);
  });

  it('detects a write that reports success but leaves no readable file', async () => {
    const outcome = await guard.guard(
      {
        toolName: 'write_file',
        args: { path: 'app/page.tsx', content: VALID_PAGE },
        context: context(),
      },
      async () => {
        fs.rmSync(path.join(workspace, 'app', 'page.tsx'));
        return { failed: false };
      },
    );
    expect(outcome.unit.findings.some(f => f.code === 'READBACK_FAILED')).toBe(true);
    expect(read('app/page.tsx')).toBe(VALID_PAGE);
  });

  it('detects a delete that reports success while the file survives', async () => {
    const outcome = await guard.guard(
      { toolName: 'delete_file', args: { path: 'app/page.tsx' }, context: context() },
      async () => ({ failed: false }),
    );
    expect(outcome.unit.findings.some(f => f.code === 'READBACK_FAILED')).toBe(true);
  });
});

/* ------------------------------------------------------- syntax + rollback */

describe('R2 syntax validation and rollback (R2.9, R2.15, R2.16)', () => {
  it('refuses a malformed TSX candidate before it reaches the file', async () => {
    const before = hashOf('app/page.tsx');
    let invoked = false;
    const outcome = await guard.guard(
      { toolName: 'write_file', args: { path: 'app/page.tsx', content: BROKEN_PAGE }, context: context() },
      async () => { invoked = true; return { failed: false }; },
    );
    expect(invoked).toBe(false);
    expect(outcome.unit.status).toBe('REJECTED');
    expect(outcome.unit.findings[0].code).toBe('SYNTAX_INVALID');
    expect(hashOf('app/page.tsx')).toBe(before);
    expect(read('app/page.tsx')).toBe(VALID_PAGE);
  });

  it('rolls back a truncated write that the candidate check could not have seen', async () => {
    const before = hashOf('app/page.tsx');
    const next = VALID_PAGE.replace('Hello', 'Hi');
    const outcome = await guard.guard(
      { toolName: 'write_file', args: { path: 'app/page.tsx', content: next }, context: context() },
      writeTool('app/page.tsx', next, { truncateTo: 60 }),
    );
    expect(outcome.unit.status).toBe('ROLLED_BACK');
    expect(outcome.unit.findings.some(f => f.code === 'SYNTAX_INVALID')).toBe(true);
    expect(hashOf('app/page.tsx')).toBe(before);
    expect(outcome.unit.results[0].rollbackVerified).toBe(true);
    expect(outcome.unit.results[0].afterRollbackHash).toBe(before);
  });

  it('deletes a newly created file when the mutation is rejected', async () => {
    const outcome = await guard.guard(
      {
        toolName: 'create_file',
        args: { path: 'src/example.ts', content: 'export const ok = 1;\n' },
        context: context({ todoScope: ['src/example.ts'] }),
      },
      writeTool('src/example.ts', 'export const broken = (\n'),
    );
    expect(outcome.unit.status).toBe('ROLLED_BACK');
    expect(fs.existsSync(path.join(workspace, 'src/example.ts'))).toBe(false);
    expect(outcome.unit.results[0].rollbackVerified).toBe(true);
  });

  it('leaves a pre-existing dirty unrelated file completely untouched by a rollback', async () => {
    const dirty = path.join(workspace, 'data', 'saved_cards.json');
    fs.writeFileSync(dirty, '{"user":"edits"}', 'utf8');
    const dirtyHash = hashOf('data/saved_cards.json');
    const next = VALID_PAGE.replace('Hello', 'Hi');

    const outcome = await guard.guard(
      { toolName: 'write_file', args: { path: 'app/page.tsx', content: next }, context: context() },
      writeTool('app/page.tsx', next, { truncateTo: 60 }),
    );

    expect(outcome.unit.status).toBe('ROLLED_BACK');
    expect(hashOf('data/saved_cards.json')).toBe(dirtyHash);
    expect(read('data/saved_cards.json')).toBe('{"user":"edits"}');
  });

  it('reports rollback failure explicitly instead of claiming a clean workspace', async () => {
    const next = VALID_PAGE.replace('Hello', 'Hi');
    const target = path.join(workspace, 'app', 'page.tsx');
    const outcome = await guard.guard(
      { toolName: 'write_file', args: { path: 'app/page.tsx', content: next }, context: context() },
      async () => {
        // A directory in the target's place makes the restore write fail the
        // way a locked or permission-denied file would.
        fs.rmSync(target);
        fs.mkdirSync(target);
        return { failed: false };
      },
    );
    expect(outcome.unit.status).toBe('FAILED');
    expect(outcome.unit.findings.some(f => f.code === 'ROLLBACK_FAILED')).toBe(true);
    expect(outcome.unit.results[0].rollbackVerified).toBe(false);
    fs.rmdirSync(target);
  });

  it('has no syntax verdict for a file type it cannot deterministically parse', async () => {
    const outcome = await guard.guard(
      {
        toolName: 'write_file',
        args: { path: 'data/saved_cards.json', content: 'not json at all' },
        context: context({ todoScope: ['data/saved_cards.json'] }),
      },
      writeTool('data/saved_cards.json', 'not json at all'),
    );
    expect(outcome.unit.status).toBe('APPLIED');
    expect(outcome.unit.results[0].syntaxValid).toBeNull();
  });
});

/* ------------------------------------------------------- expected change */

describe('R2 expected change validation (R2.10)', () => {
  it('accepts a write that contains the declared marker', async () => {
    const next = VALID_PAGE.replace('<h1>Hello</h1>', '{/* r2-write-e2e */}\n      <h1>Hello</h1>');
    const outcome = await guard.guard(
      {
        toolName: 'write_file',
        args: { path: 'app/page.tsx', content: next },
        context: context({ expectedMarkers: ['r2-write-e2e'] }),
      },
      writeTool('app/page.tsx', next),
    );
    expect(outcome.unit.status).toBe('APPLIED');
    expect(outcome.unit.results[0].expectedChangePresent).toBe(true);
  });

  it('rolls back a write that silently omits the declared marker', async () => {
    const before = hashOf('app/page.tsx');
    const next = VALID_PAGE.replace('Hello', 'Hi');
    const outcome = await guard.guard(
      {
        toolName: 'write_file',
        args: { path: 'app/page.tsx', content: next },
        context: context({ expectedMarkers: ['r2-write-e2e'] }),
      },
      writeTool('app/page.tsx', next),
    );
    expect(outcome.unit.status).toBe('ROLLED_BACK');
    expect(outcome.unit.findings.some(f => f.code === 'EXPECTED_CHANGE_MISSING')).toBe(true);
    expect(hashOf('app/page.tsx')).toBe(before);
  });

  it('gives no expected-change verdict when the todo declared no marker', async () => {
    const next = VALID_PAGE.replace('Hello', 'Hi');
    const outcome = await guard.guard(
      { toolName: 'write_file', args: { path: 'app/page.tsx', content: next }, context: context() },
      writeTool('app/page.tsx', next),
    );
    expect(outcome.unit.results[0].expectedChangePresent).toBeNull();
    expect(outcome.unit.status).toBe('APPLIED');
  });
});

/* --------------------------------------------------------- diff awareness */

describe('R2 diff-aware validation (R2.11, R2.12)', () => {
  it('captures line and byte accounting for a small change', async () => {
    const next = VALID_PAGE.replace('<h1>Hello</h1>', '<h1>Hello</h1>\n      <p>extra</p>');
    const outcome = await guard.guard(
      { toolName: 'write_file', args: { path: 'app/page.tsx', content: next }, context: context() },
      writeTool('app/page.tsx', next),
    );
    const diff = outcome.unit.results[0].diffSummary;
    expect(diff.linesAdded).toBe(1);
    expect(diff.linesRemoved).toBe(0);
    expect(diff.bytesAfter).toBeGreaterThan(diff.bytesBefore);
  });

  it('warns but still applies a large diff when no marker pinned the scope', async () => {
    const big = 'export default function Page() {\n'
      + Array.from({ length: 40 }, (_, i) => `  const v${i} = ${i};`).join('\n')
      + '\n  return <main>{v0}</main>;\n}\n';
    const outcome = await guard.guard(
      { toolName: 'write_file', args: { path: 'app/page.tsx', content: big }, context: context() },
      writeTool('app/page.tsx', big),
    );
    expect(outcome.unit.status).toBe('APPLIED');
    expect(outcome.unit.results[0].suspicious).toBe(true);
    expect(outcome.unit.results[0].decision).toBe('WARN');
  });

  it('rolls back a large diff when the todo asked for one marked line', async () => {
    const before = hashOf('app/page.tsx');
    const big = 'export default function Page() {\n'
      + '  {/* r2-write-e2e */}\n'
      + Array.from({ length: 40 }, (_, i) => `  const v${i} = ${i};`).join('\n')
      + '\n  return <main>{v0}</main>;\n}\n';
    const outcome = await guard.guard(
      {
        toolName: 'write_file',
        args: { path: 'app/page.tsx', content: big },
        context: context({ expectedMarkers: ['r2-write-e2e'] }),
      },
      writeTool('app/page.tsx', big),
    );
    expect(outcome.unit.status).toBe('ROLLED_BACK');
    expect(outcome.unit.findings.some(f => f.code === 'DIFF_SUSPICIOUS')).toBe(true);
    expect(hashOf('app/page.tsx')).toBe(before);
  });

  it('Fix B: does not roll back a CRLF disk file modified with LF marker when semantic change is 1 line', async () => {
    // Write CRLF file on disk
    const crlfContent = Array.from({ length: 35 }, (_, i) => `export const x${i} = ${i};`).join('\r\n') + '\r\n';
    fs.writeFileSync(path.join(workspace, 'app/page.tsx'), crlfContent, 'utf8');

    // Model outputs LF content with marker {/* K6A */} added
    const lfContentWithMarker = crlfContent
      .replace(/\r\n/g, '\n')
      .replace('export const x10 = 10;', 'export const x10 = 10;\n/* K6A */');

    const outcome = await guard.guard(
      {
        toolName: 'write_file',
        args: { path: 'app/page.tsx', content: lfContentWithMarker },
        context: context({ expectedMarkers: ['K6A'] }),
      },
      writeTool('app/page.tsx', lfContentWithMarker),
    );

    expect(outcome.unit.status).toBe('APPLIED');
    expect(outcome.unit.results[0].suspicious).toBe(false);
    expect(outcome.unit.results[0].expectedChangePresent).toBe(true);
    expect(outcome.unit.results[0].diffSummary.linesAdded).toBe(1);
    expect(outcome.unit.results[0].diffSummary.linesRemoved).toBe(0);
  });
});

/* ---------------------------------------------------- multi-file mutation */

describe('R2 multi-file mutation (R2.13, R2.14)', () => {
  const patchArgs = (operations: unknown[]) => ({
    sessionId: 's1',
    reason: 'multi',
    operations,
  });

  it('records one result per file in the mutation set', async () => {
    const a = 'export const a = 1;\n';
    const b = 'export const b = 2;\n';
    const outcome = await guard.guard(
      {
        toolName: 'apply_patch',
        args: patchArgs([
          { path: 'src/a.ts', operation: 'create', newContent: a },
          { path: 'src/b.ts', operation: 'create', newContent: b },
        ]),
        context: context({ todoScope: ['src/a.ts', 'src/b.ts'] }),
      },
      async () => {
        fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
        fs.writeFileSync(path.join(workspace, 'src/a.ts'), a, 'utf8');
        fs.writeFileSync(path.join(workspace, 'src/b.ts'), b, 'utf8');
        return { failed: false };
      },
    );
    expect(outcome.unit.results).toHaveLength(2);
    expect(outcome.unit.status).toBe('APPLIED');
  });

  it('refuses the whole unit when one file in the set is out of scope', async () => {
    let invoked = false;
    const outcome = await guard.guard(
      {
        toolName: 'apply_patch',
        args: patchArgs([
          { path: 'app/page.tsx', operation: 'modify', newContent: VALID_PAGE },
          { path: 'package.json', operation: 'modify', newContent: '{}' },
        ]),
        context: context({ todoScope: ['app/page.tsx'] }),
      },
      async () => { invoked = true; return { failed: false }; },
    );
    expect(invoked).toBe(false);
    expect(outcome.unit.status).toBe('BLOCKED');
    expect(outcome.unit.results.map(r => r.status)).toEqual(['BLOCKED', 'BLOCKED']);
  });

  it('rolls back every file in the unit when one file fails syntax validation', async () => {
    const goodA = 'export const a = 1;\n';
    const beforePage = hashOf('app/page.tsx');
    const outcome = await guard.guard(
      {
        toolName: 'apply_patch',
        args: patchArgs([
          { path: 'app/page.tsx', operation: 'modify', newContent: VALID_PAGE.replace('Hello', 'Hi') },
          { path: 'src/a.ts', operation: 'create', newContent: goodA },
        ]),
        context: context({ todoScope: ['app/page.tsx', 'src/a.ts'] }),
      },
      async () => {
        fs.writeFileSync(path.join(workspace, 'app/page.tsx'), VALID_PAGE.replace('Hello', 'Hi'), 'utf8');
        fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
        // The second file lands broken even though its candidate was valid.
        fs.writeFileSync(path.join(workspace, 'src/a.ts'), 'export const a = (\n', 'utf8');
        return { failed: false };
      },
    );
    expect(outcome.unit.status).toBe('ROLLED_BACK');
    expect(hashOf('app/page.tsx')).toBe(beforePage);
    expect(fs.existsSync(path.join(workspace, 'src/a.ts'))).toBe(false);
  });
});

/* -------------------------------------------------------------- READ_ONLY */

describe('R2 READ_ONLY interaction (R2.25)', () => {
  it('blocks the mutation before any write and leaves no debris', async () => {
    const before = hashOf('app/page.tsx');
    const entriesBefore = fs.readdirSync(path.join(workspace, 'app')).sort();
    let invoked = false;

    const outcome = await guard.guard(
      {
        toolName: 'write_file',
        args: { path: 'app/page.tsx', content: VALID_PAGE.replace('Hello', 'readonly') },
        context: context({ executionMode: 'READ_ONLY' }),
      },
      async () => { invoked = true; return { failed: false }; },
    );

    expect(invoked).toBe(false);
    expect(outcome.unit.status).toBe('BLOCKED');
    expect(outcome.unit.blockedBeforeWrite).toBe(true);
    expect(outcome.unit.findings[0].code).toBe('READ_ONLY');
    expect(hashOf('app/page.tsx')).toBe(before);
    expect(fs.readdirSync(path.join(workspace, 'app')).sort()).toEqual(entriesBefore);
    expect(outcome.unit.results.every(r => !r.rolledBack)).toBe(true);
  });
});
