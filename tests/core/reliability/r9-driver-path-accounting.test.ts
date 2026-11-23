/**
 * Regression coverage for the R9 driver's changed-file accounting.
 *
 * The first full R9 campaign recorded seven corrupted paths — `.ai/backups/...` as
 * `ai/backups/...`, and `server/src/tasks/tasks.repository.ts` as
 * `erver/src/tasks/tasks.repository.ts`. Comparing against the benchmark repo's git
 * reflog proved Sparrow had written the correct paths, so the corruption was in the
 * driver's fixed-offset porcelain parsing.
 *
 * The consequence was not cosmetic: a corrupted `.ai/` path escapes the
 * infrastructure filter and is then scored as an out-of-scope source write, which
 * inflated the reported scope-violation rate from 6 cases to 9.
 */

import {
  isAgentAuthored,
  parsePorcelainLine,
} from '../../../src/core/reliability/r9-campaign-driver';

describe('porcelain path parsing', () => {
  it('reads an untracked path without losing a character', () => {
    expect(parsePorcelainLine('?? .ai/backups/0/metadata.json')).toBe('.ai/backups/0/metadata.json');
  });

  it('reads a modified path', () => {
    expect(parsePorcelainLine(' M server/src/tasks/tasks.repository.ts')).toBe(
      'server/src/tasks/tasks.repository.ts',
    );
  });

  it('reads a staged-and-modified path', () => {
    expect(parsePorcelainLine('MM types/domain.ts')).toBe('types/domain.ts');
  });

  it('reads an added path', () => {
    expect(parsePorcelainLine('A  components/ArchiveButton.tsx')).toBe('components/ArchiveButton.tsx');
  });

  it('reads a deleted path', () => {
    expect(parsePorcelainLine(' D tests/unit/tasks.service.test.ts')).toBe(
      'tests/unit/tasks.service.test.ts',
    );
  });

  it('takes the destination of a rename', () => {
    expect(parsePorcelainLine('R  old/name.ts -> new/name.ts')).toBe('new/name.ts');
  });

  it('survives extra padding without eating the leading character', () => {
    expect(parsePorcelainLine('??   .ai/config.json')).toBe('.ai/config.json');
  });

  /** The exact corruptions observed in the first campaign must not recur. */
  it('never reproduces the observed truncations', () => {
    expect(parsePorcelainLine('?? .ai/backups/0/metadata.json')).not.toBe('ai/backups/0/metadata.json');
    expect(parsePorcelainLine(' M server/src/tasks/tasks.repository.ts')).not.toBe(
      'erver/src/tasks/tasks.repository.ts',
    );
  });
});

describe('infrastructure path filtering', () => {
  it('treats Sparrow bookkeeping under .ai as infrastructure', () => {
    expect(isAgentAuthored('.ai/backups/0/metadata.json')).toBe(false);
    expect(isAgentAuthored('.ai/runs/task-1.run.json')).toBe(false);
    expect(isAgentAuthored('.ai/config.json')).toBe(false);
    expect(isAgentAuthored('.ai/vv/failure-contracts.json')).toBe(false);
  });

  it('treats build and dependency output as infrastructure', () => {
    expect(isAgentAuthored('node_modules/react/index.js')).toBe(false);
    expect(isAgentAuthored('.next/server/app.js')).toBe(false);
    expect(isAgentAuthored('taskflow.db')).toBe(false);
    expect(isAgentAuthored('tsconfig.tsbuildinfo')).toBe(false);
  });

  it('treats project source as agent-authored', () => {
    expect(isAgentAuthored('server/src/tasks/tasks.repository.ts')).toBe(true);
    expect(isAgentAuthored('components/TaskCard.tsx')).toBe(true);
    expect(isAgentAuthored('tsconfig.json')).toBe(true);
    expect(isAgentAuthored('tests/unit/tasks.service.test.ts')).toBe(true);
  });

  /**
   * The corruption's real damage: a truncated `.ai/` path no longer matches the
   * infrastructure filter and gets scored as a source write.
   */
  it('shows why a truncated .ai path was miscounted as a source write', () => {
    expect(isAgentAuthored('.ai/backups/0/metadata.json')).toBe(false);
    expect(isAgentAuthored('ai/backups/0/metadata.json')).toBe(true);
  });

  it('normalises windows separators before filtering', () => {
    expect(isAgentAuthored('.ai\\backups\\0\\metadata.json')).toBe(false);
  });
});
