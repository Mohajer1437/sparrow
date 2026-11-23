import { DefaultTaskIntake } from '../../../src/core/pre-execution/task-intake';

describe('DefaultTaskIntake', () => {
  let intake: DefaultTaskIntake;

  beforeEach(() => {
    intake = new DefaultTaskIntake();
  });

  describe('normalize', () => {
    it('should classify BUG_FIX intent', async () => {
      const result = await intake.normalize({
        rawPrompt: 'Fix the bug in src/utils.ts that causes crash',
      });
      expect(result.intent.type).toBe('BUG_FIX');
    });

    it('should classify FEATURE intent', async () => {
      const result = await intake.normalize({
        rawPrompt: 'Add a new feature to create bookmarks',
      });
      expect(result.intent.type).toBe('FEATURE');
    });

    it('should extract file paths', async () => {
      const result = await intake.normalize({
        rawPrompt: 'Update src/lib/utils.ts and src/components/Button.tsx',
      });
      expect(result.intent.initialScope).toContain('src/lib/utils.ts');
      expect(result.intent.initialScope).toContain('src/components/Button.tsx');
    });

    it('should default information status to UNKNOWN', async () => {
      const result = await intake.normalize({
        rawPrompt: 'The application needs better error handling',
      });
      const info = result.intent.information[0];
      expect(info.status).toBe('UNKNOWN');
      expect(info.requiresEvidence).toBe(true);
    });

    it('should classify ASSUMPTION correctly', async () => {
      const result = await intake.normalize({
        rawPrompt: 'I think the issue is in the database connection pool',
      });
      const info = result.intent.information.find(i =>
        i.content.toLowerCase().includes('i think')
      );
      expect(info?.status).toBe('ASSUMPTION');
      expect(info?.requiresEvidence).toBe(true);
    });

    it('does not treat Next.js as a source file path', async () => {
      const result = await intake.normalize({
        rawPrompt: 'Inspect this Next.js project and make a small safe change',
      });
      expect(result.intent.initialScope).not.toContain('Next.js');
      expect(result.intent.initialScope.some(path => /\.js$/i.test(path) && !path.includes('/'))).toBe(false);
    });

    it('should compute readiness score', async () => {
      const result = await intake.normalize({
        rawPrompt: 'Fix src/utils.ts',
      });
      expect(result.readinessScore).toBeGreaterThanOrEqual(0);
      expect(result.readinessScore).toBeLessThanOrEqual(100);
    });

    it('does not flag exact visible text as missing success criteria', async () => {
      const result = await intake.normalize({
        rawPrompt: 'On the home page file app/page.tsx add a footer with the exact visible text Sandbox verification marker',
      });
      expect(result.ambiguities.some(a => /success criteria/i.test(a))).toBe(false);
    });
  });
});
