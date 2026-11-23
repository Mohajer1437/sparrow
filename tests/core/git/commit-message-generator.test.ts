import { CommitMessageGenerator } from '../../../src/core/git/commit-message-generator';

describe('CommitMessageGenerator', () => {
  let generator: CommitMessageGenerator;

  beforeEach(() => {
    generator = new CommitMessageGenerator();
  });

  describe('type inference', () => {
    it('infers feat for new features', () => {
      const msg = generator.generate({
        userRequest: 'Add authentication middleware',
        changedFiles: ['src/auth.ts'],
        validationPassed: true,
        testsPassed: true,
      });
      expect(msg).toMatch(/^feat/);
    });

    it('infers fix for bug fixes', () => {
      const msg = generator.generate({
        userRequest: 'Fix the authentication bug',
        changedFiles: ['src/auth.ts'],
        validationPassed: true,
        testsPassed: true,
      });
      expect(msg).toMatch(/^fix/);
    });

    it('infers refactor for restructuring', () => {
      const msg = generator.generate({
        userRequest: 'Refactor the auth module',
        changedFiles: ['src/auth.ts'],
        validationPassed: true,
        testsPassed: true,
      });
      expect(msg).toMatch(/^refactor/);
    });

    it('infers test for test additions', () => {
      const msg = generator.generate({
        userRequest: 'Add tests for auth',
        changedFiles: ['src/auth.test.ts'],
        validationPassed: true,
        testsPassed: true,
      });
      expect(msg).toMatch(/^test/);
    });

    it('infers docs for documentation', () => {
      const msg = generator.generate({
        userRequest: 'Update the README',
        changedFiles: ['README.md'],
        validationPassed: true,
        testsPassed: true,
      });
      expect(msg).toMatch(/^docs/);
    });
  });

  describe('scope inference', () => {
    it('infers scope from file path', () => {
      const msg = generator.generate({
        userRequest: 'Add feature',
        changedFiles: ['src/auth/middleware.ts'],
        validationPassed: true,
        testsPassed: true,
      });
      expect(msg).toContain('(auth)');
    });

    it('skips common directories', () => {
      const msg = generator.generate({
        userRequest: 'Add feature',
        changedFiles: ['src/core/knowledge/service.ts'],
        validationPassed: true,
        testsPassed: true,
      });
      expect(msg).toContain('(knowledge)');
      expect(msg).not.toContain('(core)');
    });
  });

  describe('description generation', () => {
    it('uses patch reason when available', () => {
      const msg = generator.generate({
        userRequest: 'Do something',
        patchReason: 'Add JWT validation',
        changedFiles: ['src/auth.ts'],
        validationPassed: true,
        testsPassed: true,
      });
      expect(msg).toContain('add JWT validation');
    });

    it('falls back to user request', () => {
      const msg = generator.generate({
        userRequest: 'Add authentication',
        changedFiles: ['src/auth.ts'],
        validationPassed: true,
        testsPassed: true,
      });
      expect(msg).toContain('authentication');
    });

    it('lowercases first character', () => {
      const msg = generator.generate({
        userRequest: 'Add Something',
        changedFiles: ['src/a.ts'],
        validationPassed: true,
        testsPassed: true,
      });
      expect(msg).toMatch(/^[a-z]+\S*: [a-z]/);
    });

    it('removes trailing punctuation', () => {
      const msg = generator.generate({
        userRequest: 'Add feature!',
        changedFiles: ['src/a.ts'],
        validationPassed: true,
        testsPassed: true,
      });
      expect(msg).not.toMatch(/!$/);
    });
  });

  describe('length limits', () => {
    it('enforces 72 char limit', () => {
      const msg = generator.generate({
        userRequest: 'A'.repeat(100),
        changedFiles: ['src/a.ts'],
        validationPassed: true,
        testsPassed: true,
      });
      expect(msg.length).toBeLessThanOrEqual(72);
    });
  });

  describe('edge cases', () => {
    it('handles empty input gracefully', () => {
      const msg = generator.generate({
        userRequest: '',
        changedFiles: [],
        validationPassed: true,
        testsPassed: true,
      });
      expect(msg).toMatch(/^[a-z]+:/);
    });
  });
});
