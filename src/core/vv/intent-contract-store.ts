import { promises as fs } from 'fs';
import * as path from 'path';
import { ProductAnalysis } from '../../domain/product-analysis';
import {
  VerificationSideEffect,
  VerificationSideEffectPolicy,
} from '../../domain/verification-side-effect';

const RELATIVE = path.join('.ai', 'vv', 'intent-contract.json');

/**
 * Persists the intent contract for later repair attempts.
 *
 * R1.25-R1.27: this writes inside `.ai/`, which is agent metadata rather than
 * project source, but it is still a mutation, so it is declared and it is
 * skipped entirely under a READ_ONLY policy.
 */
export async function saveIntentContract(
  workspacePath: string | undefined,
  analysis: ProductAnalysis,
  policy: VerificationSideEffectPolicy = 'CONTROLLED_MUTATION',
): Promise<VerificationSideEffect | undefined> {
  if (!workspacePath) return undefined;
  const target = path.join(workspacePath, RELATIVE);
  if (policy === 'READ_ONLY') {
    return effect(target, policy, 'BLOCKED');
  }
  try {
    const dir = path.join(workspacePath, '.ai', 'vv');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(target, JSON.stringify(analysis, null, 2), 'utf8');
    return effect(target, policy, 'PERFORMED');
  } catch {
    // Persistence is best-effort; in-memory handoff still applies.
    return effect(target, policy, 'SKIPPED');
  }
}

function effect(
  target: string,
  policy: VerificationSideEffectPolicy,
  status: 'PERFORMED' | 'BLOCKED' | 'SKIPPED',
): VerificationSideEffect {
  return Object.freeze({
    id: 'vv-intent-contract',
    source: 'intent-contract-store',
    kind: 'FILE_WRITE' as const,
    target,
    policy,
    status,
    declared: true,
    reversible: true,
    detail: 'stores the intent contract under .ai/vv so a later repair attempt can compare against the original intent',
  });
}

export async function loadIntentContract(workspacePath: string | undefined): Promise<ProductAnalysis | undefined> {
  if (!workspacePath) return undefined;
  try {
    const raw = await fs.readFile(path.join(workspacePath, RELATIVE), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    return parsed as ProductAnalysis;
  } catch {
    return undefined;
  }
}
