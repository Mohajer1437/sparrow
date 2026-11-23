import * as path from 'path';
import {
  KnowledgeFusionProvenance,
  KnowledgeFusionRequest,
  KnowledgeFusionResult,
  KnowledgeFusionRetriever,
} from '../../contracts/knowledge-fusion';
import {
  StructuralKnowledgeQuery,
} from '../../contracts/structural-knowledge-query';
import { RuntimeRepository } from '../../contracts/runtime-repository';
import {
  FUSION_HARD_LIMITS,
  KnowledgeConflict,
  KnowledgeItem,
  StructuralClaim,
} from '../../domain/knowledge-fusion';
import { KnowledgeCandidate } from '../../domain/knowledge-feedback';
import { SharedMemoryEntry } from '../../domain/role-memory';
import { StructuralGraph } from '../../domain/structural-knowledge';

interface SemanticRuleRecord {
  readonly id: string;
  readonly content: string;
  readonly relatedFiles?: ReadonlyArray<string>;
  readonly keywords?: ReadonlyArray<string>;
  readonly scope?: KnowledgeItem['scope'];
  readonly updatedAt?: string;
  readonly confidence?: KnowledgeItem['confidence'];
  readonly structuralClaim?: StructuralClaim;
  readonly stale?: boolean;
}

interface ExperientialLessonRecord {
  readonly id: string;
  readonly content: string;
  readonly title?: string;
  readonly relatedFiles?: ReadonlyArray<string>;
  readonly keywords?: ReadonlyArray<string>;
  readonly scope?: KnowledgeItem['scope'];
  readonly createdAt?: string;
  readonly confidence?: KnowledgeItem['confidence'];
  readonly structuralClaim?: StructuralClaim;
  readonly source?: string;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function basenameTokens(seeds: ReadonlyArray<string>, taskText?: string): string[] {
  const tokens = new Set<string>();
  for (const s of seeds) {
    const base = path.posix.basename(normalizePath(s)).replace(/\.[^.]+$/, '');
    if (base.length >= 2) tokens.add(base.toLowerCase());
    for (const part of normalizePath(s).split('/')) {
      if (part.length >= 3 && !part.startsWith('.')) tokens.add(part.toLowerCase());
    }
  }
  if (taskText) {
    for (const m of taskText.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? []) {
      tokens.add(m.toLowerCase());
    }
  }
  return [...tokens];
}

function overlapsFiles(
  related: ReadonlyArray<string> | undefined,
  seeds: ReadonlyArray<string>,
): boolean {
  if (!related || related.length === 0) return false;
  const seedSet = new Set(seeds.map(normalizePath));
  return related.some(r => {
    const n = normalizePath(r);
    if (seedSet.has(n)) return true;
    return [...seedSet].some(s => s.endsWith('/' + path.posix.basename(n)) || n.endsWith('/' + path.posix.basename(s)) || s.includes(path.posix.basename(n).replace(/\.[^.]+$/, '')));
  });
}

function matchesKeywords(
  keywords: ReadonlyArray<string> | undefined,
  content: string,
  tokens: ReadonlyArray<string>,
): boolean {
  const hay = `${(keywords ?? []).join(' ')} ${content}`.toLowerCase();
  return tokens.some(t => t.length >= 3 && hay.includes(t));
}

function graphHasImport(graph: StructuralGraph, from: string, to: string): boolean | null {
  const fromN = normalizePath(from);
  const toN = normalizePath(to);
  const fileIds = new Set(
    graph.nodes
      .filter(n => n.kind === 'file')
      .map(n => normalizePath(n.path ?? n.id)),
  );
  if (!fileIds.has(fromN) || !fileIds.has(toN)) return null;
  return graph.edges.some(e => {
    if (e.kind !== 'imports') return false;
    return normalizePath(e.from) === fromN && normalizePath(e.to) === toN;
  });
}

/**
 * Bounded fusion retriever. Structural traversal is delegated — never reimplemented.
 */
export class DefaultKnowledgeFusionRetriever implements KnowledgeFusionRetriever {
  constructor(
    private readonly structuralQuery: StructuralKnowledgeQuery,
    private readonly runtime: RuntimeRepository,
  ) {}

  async retrieve(request: KnowledgeFusionRequest): Promise<KnowledgeFusionResult> {
    const queryId = request.queryId ?? `fusion-${request.consumer}-${Date.now()}`;
    const structuralMaxFiles = request.consumer === 'planner' ? 10 : 8;
    const structuralMaxNodes = request.consumer === 'planner' ? 20 : 16;

    const structuralQuery = request.seeds.length === 0
      ? null
      : await this.structuralQuery.query({
          seeds: request.seeds,
          direction: request.structural?.direction ?? 'both',
          maxDepth: request.structural?.maxDepth ?? 1,
          maxNodes: request.structural?.maxNodes ?? structuralMaxNodes,
          maxFiles: request.structural?.maxFiles ?? structuralMaxFiles,
          includeSymbols: request.structural?.includeSymbols ?? true,
          queryId: `${queryId}-structural`,
          sessionId: request.sessionId,
          stepId: request.stepId,
          reason: request.reason ?? `fusion ${request.consumer}`,
        });

    const structuralItems = this.toStructuralItems(structuralQuery);
    const tokens = basenameTokens(request.seeds, request.taskText);
    const relatedFromStructural = structuralQuery?.relatedFiles ?? [];

    const semanticAll = await this.loadSemanticCandidates(tokens, request.seeds, relatedFromStructural);
    const experientialAll = await this.loadExperientialCandidates(
      tokens,
      request.seeds,
      relatedFromStructural,
      request.experientialScope ?? 'module',
    );

    const conflicts: KnowledgeConflict[] = [];
    const graph = structuralQuery?.graph ?? null;
    const semantic = this.applyAuthority(semanticAll, graph, conflicts).slice(
      0,
      FUSION_HARD_LIMITS.maxSemanticItems,
    );
    const experiential = this.applyAuthority(experientialAll, graph, conflicts).slice(
      0,
      FUSION_HARD_LIMITS.maxExperientialItems,
    );

    const relatedFiles = uniquePaths([
      ...relatedFromStructural,
      ...semantic.flatMap(i => i.relatedFiles),
      ...experiential.flatMap(i => i.relatedFiles),
    ]).slice(0, FUSION_HARD_LIMITS.maxRelatedFilesListed);

    let promptSection = this.formatPrompt(
      structuralQuery,
      structuralItems,
      semantic,
      experiential,
      conflicts,
    );
    let truncated = structuralQuery?.provenance.truncated ?? false;
    if (promptSection.length > FUSION_HARD_LIMITS.maxTotalPromptChars) {
      promptSection = promptSection.slice(0, FUSION_HARD_LIMITS.maxTotalPromptChars)
        + '\n\n[Fusion context truncated — use targeted reads for more]';
      truncated = true;
    }

    const provenance: KnowledgeFusionProvenance = {
      queryId,
      consumer: request.consumer,
      structuralSource: structuralQuery?.provenance.source ?? 'unavailable',
      structuralFreshness: structuralQuery?.provenance.freshness ?? 'UNKNOWN',
      structuralClaimCertainty: structuralQuery?.provenance.claimCertainty ?? false,
      structuralItemCount: structuralItems.length,
      semanticItemCount: semantic.length,
      experientialItemCount: experiential.length,
      conflictCount: conflicts.length,
      truncated,
      promptChars: promptSection.length,
      relatedFiles,
    };

    return {
      structural: structuralItems,
      semantic,
      experiential,
      conflicts: Object.freeze(conflicts),
      relatedFiles,
      promptSection,
      structuralQuery,
      provenance,
    };
  }

  private toStructuralItems(
    result: Awaited<ReturnType<StructuralKnowledgeQuery['query']>> | null,
  ): KnowledgeItem[] {
    if (!result || result.relatedFiles.length === 0) return [];
    const freshness =
      result.provenance.freshness === 'FRESH' ? 'FRESH'
        : result.provenance.freshness === 'STALE' ? 'STALE'
          : 'UNKNOWN';
    return [{
      id: `structural-${result.provenance.queryId}`,
      knowledgeClass: 'structural',
      content: result.promptSection || `Structural neighborhood: ${result.relatedFiles.join(', ')}`,
      source: result.provenance.source,
      freshness,
      scope: 'module',
      relatedFiles: result.relatedFiles,
      confidence: result.provenance.claimCertainty ? 'HIGH' : 'LOW',
    }];
  }

  private async loadSemanticCandidates(
    tokens: ReadonlyArray<string>,
    seeds: ReadonlyArray<string>,
    relatedFiles: ReadonlyArray<string>,
  ): Promise<KnowledgeItem[]> {
    const items: KnowledgeItem[] = [];
    const seedLike = [...seeds, ...relatedFiles];

    // Primary: authored semantic-rules.json (controlled, queryable)
    try {
      if (await this.runtime.exists('knowledge/semantic-rules.json')) {
        const raw = await this.runtime.readFile('knowledge/semantic-rules.json');
        if (raw?.trim()) {
          const parsed = JSON.parse(raw) as { rules?: SemanticRuleRecord[] };
          for (const rule of parsed.rules ?? []) {
            if (!rule.id || !rule.content) continue;
            const fileHit = overlapsFiles(rule.relatedFiles, seedLike);
            const kwHit = matchesKeywords(rule.keywords, rule.content, tokens);
            if (!fileHit && !kwHit) continue;
            items.push({
              id: rule.id,
              knowledgeClass: 'semantic',
              content: rule.content,
              source: 'semantic-rules',
              freshness: rule.stale ? 'STALE' : (rule.updatedAt ? 'FRESH' : 'UNKNOWN'),
              scope: rule.scope ?? 'module',
              relatedFiles: rule.relatedFiles ?? [],
              confidence: rule.confidence ?? 'MEDIUM',
              structuralClaim: rule.structuralClaim,
              createdAt: rule.updatedAt,
            });
          }
        }
      }
    } catch {
      // fail-open
    }

    // Optional: knowledge_base strict_rules when present (bounded)
    try {
      if (await this.runtime.exists('knowledge/knowledge_base.json')) {
        const raw = await this.runtime.readFile('knowledge/knowledge_base.json');
        if (raw?.trim()) {
          const kb = JSON.parse(raw);
          const rules = kb?.knowledge_base?.strict_rules as Array<{ id: string; rule: string }> | undefined;
          for (const rule of (rules ?? []).slice(0, 5)) {
            if (!matchesKeywords(undefined, rule.rule, tokens)) continue;
            items.push({
              id: `kb-${rule.id}`,
              knowledgeClass: 'semantic',
              content: rule.rule,
              source: 'knowledge_base',
              freshness: 'UNKNOWN',
              scope: 'repository',
              relatedFiles: [],
              confidence: 'MEDIUM',
            });
          }
        }
      }
    } catch {
      // fail-open
    }

    return items;
  }

  private async loadExperientialCandidates(
    tokens: ReadonlyArray<string>,
    seeds: ReadonlyArray<string>,
    relatedFiles: ReadonlyArray<string>,
    scopeMode: NonNullable<KnowledgeFusionRequest['experientialScope']>,
  ): Promise<KnowledgeItem[]> {
    const items: KnowledgeItem[] = [];
    const seedLike = [...seeds, ...relatedFiles];

    // Controlled experiential lessons store (optional; used for scoped/conflict fixtures)
    try {
      if (await this.runtime.exists('knowledge/experiential-lessons.json')) {
        const raw = await this.runtime.readFile('knowledge/experiential-lessons.json');
        if (raw?.trim()) {
          const parsed = JSON.parse(raw) as { lessons?: ExperientialLessonRecord[] };
          for (const lesson of parsed.lessons ?? []) {
            if (!lesson.id || !lesson.content) continue;
            const scope = lesson.scope ?? 'module';
            if (!this.scopeAllowed(scope, scopeMode, lesson.relatedFiles, seedLike, tokens, lesson.content)) {
              continue;
            }
            items.push({
              id: lesson.id,
              knowledgeClass: 'experiential',
              content: lesson.title ? `${lesson.title}: ${lesson.content}` : lesson.content,
              source: lesson.source ?? 'experiential-lessons',
              freshness: 'HISTORICAL',
              scope,
              relatedFiles: lesson.relatedFiles ?? [],
              confidence: lesson.confidence ?? 'MEDIUM',
              structuralClaim: lesson.structuralClaim,
              createdAt: lesson.createdAt,
            });
          }
        }
      }
    } catch {
      // fail-open
    }

    // feedback_candidates.json — real experiential candidates (not promoted KB)
    try {
      if (await this.runtime.exists('knowledge/feedback_candidates.json')) {
        const raw = await this.runtime.readFile('knowledge/feedback_candidates.json');
        if (raw?.trim()) {
          const parsed = JSON.parse(raw) as { candidates?: KnowledgeCandidate[] };
          for (const c of parsed.candidates ?? []) {
            if (c.status === 'rejected') continue;
            const text = `${c.title} ${c.content} ${c.reason}`;
            if (!matchesKeywords(undefined, text, tokens) && !overlapsFiles(
              this.extractPathsFromEvidence(c.evidence),
              seedLike,
            )) {
              continue;
            }
            items.push({
              id: `fb-${c.id}`,
              knowledgeClass: 'experiential',
              content: `${c.title}: ${c.content}`,
              source: 'feedback-candidate',
              freshness: 'HISTORICAL',
              scope: 'repository',
              relatedFiles: this.extractPathsFromEvidence(c.evidence),
              confidence: c.confidence,
              createdAt: c.generatedAt,
            });
          }
        }
      }
    } catch {
      // fail-open
    }

    // shared memory — soft experiential
    try {
      if (await this.runtime.exists('memory/shared/memory.json')) {
        const raw = await this.runtime.readFile('memory/shared/memory.json');
        if (raw?.trim()) {
          const parsed = JSON.parse(raw) as { entries?: SharedMemoryEntry[] };
          for (const e of parsed.entries ?? []) {
            if (!matchesKeywords(undefined, e.content, tokens)) continue;
            items.push({
              id: `shared-${e.id}`,
              knowledgeClass: 'experiential',
              content: e.content,
              source: 'shared-memory',
              freshness: 'HISTORICAL',
              scope: 'repository',
              relatedFiles: [],
              confidence: 'LOW',
              createdAt: e.createdAt,
            });
          }
        }
      }
    } catch {
      // fail-open
    }

    return items;
  }

  private scopeAllowed(
    itemScope: KnowledgeItem['scope'],
    mode: NonNullable<KnowledgeFusionRequest['experientialScope']>,
    relatedFiles: ReadonlyArray<string> | undefined,
    seeds: ReadonlyArray<string>,
    tokens: ReadonlyArray<string>,
    content: string,
  ): boolean {
    if (mode === 'global') return true;
    if (itemScope === 'global' && mode !== 'repository') {
      // Global lessons excluded unless keyword/file overlap when asking module/file
      return overlapsFiles(relatedFiles, seeds) || matchesKeywords(undefined, content, tokens);
    }
    if (mode === 'file' || mode === 'module') {
      return overlapsFiles(relatedFiles, seeds) || matchesKeywords(undefined, content, tokens);
    }
    return true;
  }

  private extractPathsFromEvidence(evidence: ReadonlyArray<string> | undefined): string[] {
    if (!evidence) return [];
    const paths: string[] = [];
    for (const line of evidence) {
      for (const m of line.match(/[\w./\\-]+\.(tsx?|jsx?|py|go|rs)/g) ?? []) {
        paths.push(normalizePath(m));
      }
    }
    return paths;
  }

  private applyAuthority(
    items: KnowledgeItem[],
    graph: StructuralGraph | null,
    conflicts: KnowledgeConflict[],
  ): KnowledgeItem[] {
    const out: KnowledgeItem[] = [];
    for (const item of items) {
      const claim = item.structuralClaim;
      if (!claim || !graph) {
        out.push(item);
        continue;
      }
      const has = claim.predicate === 'imports'
        ? graphHasImport(graph, claim.subjectFile, claim.objectFile)
        : graphHasImport(graph, claim.objectFile, claim.subjectFile);

      if (has === true) {
        conflicts.push({
          id: `conflict-support-${item.id}`,
          claim,
          claimSourceItemId: item.id,
          claimKnowledgeClass: item.knowledgeClass,
          structuralVerdict: 'supported',
          resolution: 'structural_wins',
          detail: 'Claim agrees with current structural graph.',
        });
        out.push(item);
        continue;
      }

      if (has === false) {
        conflicts.push({
          id: `conflict-${item.id}`,
          claim,
          claimSourceItemId: item.id,
          claimKnowledgeClass: item.knowledgeClass,
          structuralVerdict: 'contradicted',
          resolution: 'structural_wins',
          detail:
            `Structural graph does not support ${claim.subjectFile} ${claim.predicate} ${claim.objectFile}. `
            + 'Historical/semantic claim retained as non-authoritative history only.',
        });
        // Keep as historical awareness but strip structuralClaim presentation as truth
        out.push({
          ...item,
          freshness: 'HISTORICAL',
          content:
            `[HISTORICAL — contradicted by current structural graph; structural wins] ${item.content}`,
          confidence: 'LOW',
        });
        continue;
      }

      conflicts.push({
        id: `conflict-unres-${item.id}`,
        claim,
        claimSourceItemId: item.id,
        claimKnowledgeClass: item.knowledgeClass,
        structuralVerdict: 'unresolvable',
        resolution: 'structural_wins',
        detail: 'One or both claim files absent from graph; claim not treated as structural truth.',
      });
      out.push({
        ...item,
        freshness: 'HISTORICAL',
        content: `[HISTORICAL — unresolvable against graph] ${item.content}`,
        confidence: 'LOW',
      });
    }
    return out;
  }

  private formatPrompt(
    structuralQuery: KnowledgeFusionResult['structuralQuery'],
    structural: ReadonlyArray<KnowledgeItem>,
    semantic: ReadonlyArray<KnowledgeItem>,
    experiential: ReadonlyArray<KnowledgeItem>,
    conflicts: ReadonlyArray<KnowledgeConflict>,
  ): string {
    const sections: string[] = [];
    sections.push('## FUSED KNOWLEDGE (bounded — classes remain distinct)');

    if (structuralQuery?.promptSection) {
      sections.push('### STRUCTURAL (filesystem-derived, authoritative for structure)');
      sections.push(
        `freshness=${structuralQuery.provenance.freshness} claimCertainty=${structuralQuery.provenance.claimCertainty}`,
      );
      sections.push(structuralQuery.promptSection);
    } else if (structural.length > 0) {
      sections.push('### STRUCTURAL');
      sections.push(structural[0].content);
    }

    if (semantic.length > 0) {
      sections.push('### SEMANTIC (design constraints — not structural truth)');
      for (const s of semantic) {
        sections.push(
          `- [${s.id}] (${s.source}, freshness=${s.freshness}, scope=${s.scope}`
          + `${s.confidence ? `, confidence=${s.confidence}` : ''}) ${s.content}`,
        );
      }
    }

    if (experiential.length > 0) {
      sections.push('### EXPERIENTIAL (historical lessons — not current structural truth)');
      for (const e of experiential) {
        sections.push(
          `- [${e.id}] (${e.source}, freshness=${e.freshness}, scope=${e.scope}`
          + `${e.confidence ? `, confidence=${e.confidence}` : ''}`
          + `${e.createdAt ? `, createdAt=${e.createdAt}` : ''}) ${e.content}`,
        );
      }
    }

    if (conflicts.length > 0) {
      sections.push('### CONFLICTS (deterministic: structural_wins)');
      for (const c of conflicts) {
        if (c.structuralVerdict === 'supported') continue;
        sections.push(
          `- ${c.id}: ${c.claim.subjectFile} ${c.claim.predicate} ${c.claim.objectFile}`
          + ` → ${c.structuralVerdict}; resolution=${c.resolution}. ${c.detail}`,
        );
      }
    }

    if (sections.length <= 1) return '';
    return sections.join('\n');
  }
}

function uniquePaths(paths: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const n = normalizePath(p);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
