import { promises as fs } from 'fs';
import * as path from 'path';
import { SecurityVerifier } from '../../contracts/security-verifier';
import { QualityProfile } from '../../domain/quality-profile';
import { VerificationCheck } from '../../domain/verification-check';

const SECRET_RE = /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/i;
const DANGEROUS_RE = /\beval\s*\(|new Function\s*\(|dangerouslySetInnerHTML|innerHTML\s*=/i;

export class DefaultSecurityVerifier implements SecurityVerifier {
  async verify(input: {
    readonly workspacePath: string;
    readonly profile: QualityProfile;
    readonly changedFiles?: ReadonlyArray<string>;
  }): Promise<ReadonlyArray<VerificationCheck>> {
    if (input.profile === 'MVP') {
      return Object.freeze([]);
    }

    const files = (input.changedFiles && input.changedFiles.length > 0)
      ? input.changedFiles.map(f => path.resolve(input.workspacePath, f))
      : await this.collectSourceFiles(input.workspacePath);

    const secretHits: string[] = [];
    const dangerHits: string[] = [];
    for (const file of files.slice(0, 200)) {
      if (!/\.(ts|tsx|js|jsx)$/i.test(file)) continue;
      let content = '';
      try {
        content = await fs.readFile(file, 'utf8');
      } catch {
        continue;
      }
      const rel = path.relative(input.workspacePath, file);
      if (SECRET_RE.test(content)) secretHits.push(rel);
      if (DANGEROUS_RE.test(content)) dangerHits.push(rel);
    }

    const secretFail = secretHits.length > 0;
    const dangerFail = dangerHits.length > 0 && input.profile === 'PRODUCTION';

    return Object.freeze([
      Object.freeze({
        id: 'security-secrets',
        category: 'security' as const,
        name: 'Hardcoded secrets',
        passed: !secretFail,
        severity: (secretFail ? 'CRITICAL' : 'LOW') as 'CRITICAL' | 'LOW',
        evidence: secretFail ? 'Potential secrets in: ' + secretHits.slice(0, 10).join(', ') : 'No hardcoded secret assignments found in scanned files',
        acceptanceCriterion: 'No hardcoded API keys, passwords, or tokens',
      }),
      Object.freeze({
        id: 'security-dangerous-sinks',
        category: 'security' as const,
        name: 'Dangerous sinks',
        passed: !dangerFail,
        severity: (dangerHits.length ? (input.profile === 'PRODUCTION' ? 'HIGH' : 'MEDIUM') : 'LOW') as 'HIGH' | 'MEDIUM' | 'LOW',
        evidence: dangerHits.length
          ? 'Dangerous sink(s) in: ' + dangerHits.slice(0, 10).join(', ')
          : 'No eval/innerHTML/dangerouslySetInnerHTML sinks found',
        acceptanceCriterion: 'PRODUCTION forbids eval, innerHTML assignment, and unsanitized dangerouslySetInnerHTML',
      }),
    ]);
  }

  private async collectSourceFiles(workspacePath: string): Promise<string[]> {
    const roots = ['src', 'app', 'pages'].map(p => path.join(workspacePath, p));
    const files: string[] = [];
    for (const rootDir of roots) {
      await this.walk(rootDir, files);
    }
    return files;
  }

  private async walk(dir: string, out: string[]): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.next') continue;
          await this.walk(full, out);
        } else {
          out.push(full);
        }
      }
    } catch {
      // missing
    }
  }
}
