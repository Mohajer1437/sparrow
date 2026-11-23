import { MemoryContextBuilder } from '../../contracts/memory-context-builder';
import { WorkspaceKnowledge } from '../../domain/workspace-knowledge';

const LIMITS = {
  maxRules: 15,
  maxPatterns: 10,
  maxDomains: 5,
  maxChars: 4000,
  maxDescriptionLength: 200,
  // Buffer for truncation message + safety margin for UTF-16 surrogate pairs
  // Truncation message is ~62 chars, but we use 100 to handle Unicode edge cases
  truncationBuffer: 100,
};

const TRUNCATION_MESSAGE = '\n\n[Context truncated for brevity — use tools for more details]';

export class DefaultMemoryContextBuilder implements MemoryContextBuilder {
  build(knowledge: WorkspaceKnowledge): string {
    try {
      if (!knowledge || knowledge.isEmpty) {
        return '';
      }

      const sections: string[] = [];

      const archSection = this.buildArchitectureSection(knowledge);
      if (archSection) sections.push(archSection);

      const domainsSection = this.buildDomainsSection(knowledge);
      if (domainsSection) sections.push(domainsSection);

      const patternsSection = this.buildPatternsSection(knowledge);
      if (patternsSection) sections.push(patternsSection);

      const rulesSection = this.buildRulesSection(knowledge);
      if (rulesSection) sections.push(rulesSection);

      if (sections.length === 0) {
        return '';
      }

      let result = `PROJECT CONTEXT:\n\n${sections.join('\n\n')}`;

      if (result.length > LIMITS.maxChars) {
        result = result.substring(0, LIMITS.maxChars - LIMITS.truncationBuffer)
          + TRUNCATION_MESSAGE;
      }

      return result;
    } catch (error: any) {
      console.warn(
        `[MemoryContextBuilder] Warning: build failed, returning empty context. ` +
        `Error: ${error.message}`
      );
      return '';
    }
  }

  private buildArchitectureSection(knowledge: WorkspaceKnowledge): string | null {
    const arch = knowledge.architecturalMap;
    if (!arch?.meta?.architecture_style && !arch?.system_overview?.description) {
      return null;
    }

    const parts: string[] = [];

    if (arch.meta.architecture_style) {
      parts.push(`Architecture: ${arch.meta.architecture_style}`);
    }

    if (arch.system_overview?.description) {
      const desc = arch.system_overview.description.length > LIMITS.maxDescriptionLength
        ? arch.system_overview.description.substring(0, LIMITS.maxDescriptionLength) + '...'
        : arch.system_overview.description;
      parts.push(desc);
    }

    if (arch.system_overview?.core_modules?.length) {
      const modules = arch.system_overview.core_modules.slice(0, 8);
      parts.push(`Core modules: ${modules.join(', ')}`);
    }

    return parts.join('\n');
  }

  private buildDomainsSection(knowledge: WorkspaceKnowledge): string | null {
    const domains = knowledge.knowledgeBase?.domain_contexts;
    if (!domains || domains.length === 0) {
      return null;
    }

    const lines: string[] = ['Important Domains:'];
    for (const domain of domains.slice(0, LIMITS.maxDomains)) {
      const summary = domain.summary.length > LIMITS.maxDescriptionLength
        ? domain.summary.substring(0, LIMITS.maxDescriptionLength) + '...'
        : domain.summary;
      lines.push(`- ${domain.module_name}: ${summary}`);
    }

    return lines.join('\n');
  }

  private buildRulesSection(knowledge: WorkspaceKnowledge): string | null {
    const rules = knowledge.knowledgeBase?.knowledge_base?.strict_rules;
    if (!rules || rules.length === 0) {
      return null;
    }

    const lines: string[] = ['Important Rules:'];
    for (const rule of rules.slice(0, LIMITS.maxRules)) {
      lines.push(`- [${rule.id}] ${rule.rule}`);
    }

    return lines.join('\n');
  }

  private buildPatternsSection(knowledge: WorkspaceKnowledge): string | null {
    const patterns = knowledge.knowledgeBase?.knowledge_base?.successful_patterns;
    if (!patterns || patterns.length === 0) {
      return null;
    }

    const lines: string[] = ['Successful Patterns:'];
    for (const pattern of patterns.slice(0, LIMITS.maxPatterns)) {
      lines.push(`- [${pattern.id}] ${pattern.approach}`);
    }

    return lines.join('\n');
  }
}
