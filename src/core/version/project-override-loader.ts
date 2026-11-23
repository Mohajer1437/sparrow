/**
 * Discovers and parses project-specific dependency overrides from .ai/dependencies/.
 * Treats all project-derived content as untrusted project data.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  freezeProjectDependencyOverride,
  ProjectDependencyOverride,
} from '../../domain/version-intelligence';
import { normalizeTechnologyName } from './dependency-inventory';

export class ProjectOverrideLoader {
  /**
   * Loads all dependency overrides found in .ai/dependencies/ and .ai/dependencies.md/.json.
   */
  async loadOverrides(workspaceRoot: string): Promise<ReadonlyArray<ProjectDependencyOverride>> {
    const root = path.resolve(workspaceRoot);
    const overrides: ProjectDependencyOverride[] = [];

    const aiDepDir = path.join(root, '.ai', 'dependencies');
    if (fs.existsSync(aiDepDir)) {
      try {
        const stats = fs.statSync(aiDepDir);
        if (stats.isDirectory()) {
          const entries = fs.readdirSync(aiDepDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isFile()) continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (ext !== '.md' && ext !== '.json' && ext !== '.txt') continue;

            const filePath = path.join(aiDepDir, entry.name);
            const relativePath = path.posix.join('.ai', 'dependencies', entry.name);
            const override = this.parseOverrideFile(filePath, relativePath, entry.name);
            if (override) {
              overrides.push(override);
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    }

    // Also check single file .ai/dependencies.md or .ai/dependencies.json
    const singleMd = path.join(root, '.ai', 'dependencies.md');
    if (fs.existsSync(singleMd)) {
      const parsedList = this.parseMultiDependencyMarkdown(singleMd, '.ai/dependencies.md');
      for (const item of parsedList) {
        if (!overrides.some(o => o.technology === item.technology)) {
          overrides.push(item);
        }
      }
    }

    const singleJson = path.join(root, '.ai', 'dependencies.json');
    if (fs.existsSync(singleJson)) {
      const parsedList = this.parseMultiDependencyJson(singleJson, '.ai/dependencies.json');
      for (const item of parsedList) {
        if (!overrides.some(o => o.technology === item.technology)) {
          overrides.push(item);
        }
      }
    }

    // Sort deterministically
    overrides.sort((a, b) => a.technology.localeCompare(b.technology));

    return Object.freeze(overrides);
  }

  private parseOverrideFile(
    absolutePath: string,
    relativePath: string,
    fileName: string,
  ): ProjectDependencyOverride | null {
    try {
      const content = fs.readFileSync(absolutePath, 'utf-8');
      const ext = path.extname(fileName).toLowerCase();

      if (ext === '.json') {
        return this.parseSingleJson(content, relativePath, fileName);
      }

      return this.parseMarkdown(content, relativePath, fileName);
    } catch {
      return null;
    }
  }

  private parseSingleJson(
    content: string,
    relativePath: string,
    fileName: string,
  ): ProjectDependencyOverride | null {
    try {
      const json = JSON.parse(content);
      if (!json || typeof json !== 'object') return null;

      const techName = typeof json.technology === 'string' && json.technology.trim()
        ? normalizeTechnologyName(json.technology.trim())
        : normalizeTechnologyName(path.basename(fileName, path.extname(fileName)));

      const applicableVersion = typeof json.applicableVersion === 'string'
        ? json.applicableVersion.trim()
        : undefined;

      const summary = typeof json.summary === 'string' && json.summary.trim()
        ? json.summary.trim()
        : `Project-specific ${techName} override from ${relativePath}`;

      const guidance: string[] = Array.isArray(json.guidance)
        ? json.guidance.filter((g: unknown) => typeof g === 'string' && g.trim()).map((g: string) => g.trim())
        : [];

      const notes: string[] = Array.isArray(json.notes)
        ? json.notes.filter((n: unknown) => typeof n === 'string' && n.trim()).map((n: string) => n.trim())
        : [];

      return freezeProjectDependencyOverride({
        technology: techName,
        applicableVersion,
        summary,
        guidance: guidance.length > 0 ? guidance : [summary],
        notes: notes.length > 0 ? notes : undefined,
        filePath: relativePath,
        lastVerified: typeof json.lastVerified === 'string' ? json.lastVerified : undefined,
        scope: typeof json.scope === 'string' ? json.scope : undefined,
        source: 'project-override',
      });
    } catch {
      return null;
    }
  }

  private parseMarkdown(
    content: string,
    relativePath: string,
    fileName: string,
  ): ProjectDependencyOverride | null {
    const lines = content.split('\n');
    const baseName = path.basename(fileName, path.extname(fileName));
    let technology = normalizeTechnologyName(baseName);
    let applicableVersion: string | undefined;
    let lastVerified: string | undefined;
    let scope: string | undefined;
    let summary: string | undefined;
    const guidance: string[] = [];
    const notes: string[] = [];

    let inFrontmatter = false;
    let inGuidance = false;
    let inNotes = false;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();

      if (i === 0 && trimmed === '---') {
        inFrontmatter = true;
        continue;
      }

      if (inFrontmatter) {
        if (trimmed === '---') {
          inFrontmatter = false;
          continue;
        }
        const kvMatch = /^([a-zA-Z0-9_-]+)\s*:\s*(.+)$/.exec(trimmed);
        if (kvMatch) {
          const key = kvMatch[1].toLowerCase();
          const val = kvMatch[2].replace(/^["']|["']$/g, '').trim();
          if (key === 'technology' || key === 'tech') {
            technology = normalizeTechnologyName(val);
          } else if (key === 'applicableversion' || key === 'version' || key === 'applicable_version') {
            applicableVersion = val;
          } else if (key === 'lastverified' || key === 'last_verified') {
            lastVerified = val;
          } else if (key === 'scope') {
            scope = val;
          } else if (key === 'summary') {
            summary = val;
          }
        }
        continue;
      }

      if (trimmed.startsWith('#')) {
        const headerText = trimmed.replace(/^#+\s*/, '').toLowerCase();
        if (headerText.includes('guidance') || headerText.includes('rules') || headerText.includes('instructions')) {
          inGuidance = true;
          inNotes = false;
        } else if (headerText.includes('note') || headerText.includes('compatibility') || headerText.includes('warning')) {
          inNotes = true;
          inGuidance = false;
        } else {
          inGuidance = false;
          inNotes = false;
          if (!summary && trimmed.replace(/^#+\s*/, '').length > 0) {
            summary = trimmed.replace(/^#+\s*/, '');
          }
        }
        continue;
      }

      // Check key-value lines outside frontmatter (e.g. "Applicable Version: ^7.0.0")
      const kvMatch = /^(?:Technology|Applicable Version|Version|Last Verified|Scope)\s*:\s*(.+)$/i.exec(trimmed);
      if (kvMatch) {
        const lower = trimmed.toLowerCase();
        if (lower.startsWith('technology:')) {
          technology = normalizeTechnologyName(kvMatch[1].trim());
        } else if (lower.startsWith('applicable version:') || lower.startsWith('version:')) {
          applicableVersion = kvMatch[1].trim();
        } else if (lower.startsWith('last verified:')) {
          lastVerified = kvMatch[1].trim();
        } else if (lower.startsWith('scope:')) {
          scope = kvMatch[1].trim();
        }
        continue;
      }

      // Bullet points
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const text = trimmed.substring(2).trim();
        if (text) {
          if (inNotes) {
            notes.push(text);
          } else {
            guidance.push(text);
          }
        }
        continue;
      }

      // Plain paragraphs
      if (trimmed && !trimmed.startsWith('#')) {
        if (!summary) {
          summary = trimmed;
        } else if (inNotes) {
          notes.push(trimmed);
        } else {
          guidance.push(trimmed);
        }
      }
    }

    if (!summary) {
      summary = `Project-specific ${technology} override from ${relativePath}`;
    }

    return freezeProjectDependencyOverride({
      technology,
      applicableVersion,
      summary,
      guidance: guidance.length > 0 ? guidance : [summary],
      notes: notes.length > 0 ? notes : undefined,
      filePath: relativePath,
      lastVerified,
      scope,
      source: 'project-override',
    });
  }

  private parseMultiDependencyMarkdown(
    absolutePath: string,
    relativePath: string,
  ): ProjectDependencyOverride[] {
    const results: ProjectDependencyOverride[] = [];
    try {
      const content = fs.readFileSync(absolutePath, 'utf-8');
      const sections = content.split(/^##\s+/m);

      for (let i = 1; i < sections.length; i++) {
        const section = `## ${sections[i]}`;
        const firstLine = section.split('\n')[0].replace(/^##\s*/, '').trim();
        const techName = normalizeTechnologyName(firstLine);
        const parsed = this.parseMarkdown(section, relativePath, `${techName}.md`);
        if (parsed) {
          results.push(parsed);
        }
      }
    } catch {
      // Ignore
    }
    return results;
  }

  private parseMultiDependencyJson(
    absolutePath: string,
    relativePath: string,
  ): ProjectDependencyOverride[] {
    const results: ProjectDependencyOverride[] = [];
    try {
      const raw = fs.readFileSync(absolutePath, 'utf-8');
      const json = JSON.parse(raw);
      if (Array.isArray(json)) {
        for (const item of json) {
          if (item && typeof item === 'object' && typeof item.technology === 'string') {
            const techName = normalizeTechnologyName(item.technology.trim());
            const parsed = this.parseSingleJson(JSON.stringify(item), relativePath, `${techName}.json`);
            if (parsed) {
              results.push(parsed);
            }
          }
        }
      }
    } catch {
      // Ignore
    }
    return results;
  }
}
