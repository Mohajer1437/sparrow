import { ExecutionPlan } from '../../domain/execution-plan';

export interface CommitMessageInput {
  readonly userRequest: string;
  readonly plan?: ExecutionPlan | null;
  readonly changedFiles: ReadonlyArray<string>;
  readonly patchReason?: string;
  readonly validationPassed: boolean;
  readonly testsPassed: boolean;
}

export class CommitMessageGenerator {
  generate(input: CommitMessageInput): string {
    const type = this.inferType(input);
    const scope = this.inferScope(input.changedFiles);
    const description = this.generateDescription(input);

    const scopePart = scope ? `(${scope})` : '';
    const firstLine = `${type}${scopePart}: ${description}`;

    if (firstLine.length > 72) {
      return firstLine.substring(0, 69) + '...';
    }

    return firstLine;
  }

  private inferType(input: CommitMessageInput): string {
    const lower = (input.userRequest + ' ' + (input.patchReason || '')).toLowerCase();

    if (lower.includes('fix') || lower.includes('bug') || lower.includes('repair')) {
      return 'fix';
    }
    if (lower.includes('test') || lower.includes('spec')) {
      return 'test';
    }
    if (lower.includes('doc') || lower.includes('readme') || lower.includes('comment')) {
      return 'docs';
    }
    if (lower.includes('refactor') || lower.includes('restructure') || lower.includes('rename')) {
      return 'refactor';
    }
    if (lower.includes('chore') || lower.includes('dep') || lower.includes('config')) {
      return 'chore';
    }

    return 'feat';
  }

  private inferScope(files: ReadonlyArray<string>): string | null {
    if (files.length === 0) return null;

    const paths = files.map(f => f.replace(/\\/g, '/'));
    const first = paths[0];
    const parts = first.split('/').filter(p => p && p !== 'src');

    if (parts.length === 0) return null;

    const skipDirs = ['core', 'domain', 'contracts', 'cli', 'utils', 'helpers'];
    const meaningful = parts.find(p => !skipDirs.includes(p.toLowerCase()));

    if (meaningful) {
      const clean = meaningful.replace(/\.[^.]+$/, '');
      return clean.toLowerCase();
    }

    return null;
  }

  private generateDescription(input: CommitMessageInput): string {
    if (input.patchReason && input.patchReason.trim().length > 0) {
      return this.sanitize(input.patchReason);
    }

    if (input.userRequest && input.userRequest.trim().length > 0) {
      return this.sanitize(input.userRequest);
    }

    if (input.changedFiles.length > 0) {
      const count = input.changedFiles.length;
      return `update ${count} file${count === 1 ? '' : 's'}`;
    }

    return 'update code';
  }

  private sanitize(text: string): string {
    let clean = text.trim();
    clean = clean.replace(/^["']|["']$/g, '');

    if (clean.length > 0) {
      clean = clean.charAt(0).toLowerCase() + clean.slice(1);
    }

    clean = clean.replace(/[.!?,;:]+$/, '');
    clean = clean.replace(/^(adding?|added)\s+/i, '');

    return clean || 'update code';
  }
}
