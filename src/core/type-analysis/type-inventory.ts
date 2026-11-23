import { Workspace } from '../../contracts/workspace';
import { ExecutionLogger } from '../observability/execution-logger';

export interface TypeDefinition {
  name: string;
  kind: 'type' | 'interface' | 'enum';
  file: string;
  exported: boolean;
}

export interface TypeInventory {
  types: ReadonlyArray<TypeDefinition>;
  scannedAt: string;
  projectPath: string;
}

/**
 * D.3: Type Inventory Builder
 * Scans project for type/interface/enum definitions to help agent avoid duplicates.
 */
export class TypeInventoryBuilder {
  private cache: TypeInventory | null = null;
  private cacheTime: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly workspace: Workspace) {}

  /**
   * Build or retrieve cached type inventory.
   * Scans .ts/.tsx files for type/interface/enum definitions.
   */
  async build(): Promise<TypeInventory> {
    const now = Date.now();
    if (this.cache && (now - this.cacheTime) < this.CACHE_TTL_MS) {
      return this.cache;
    }

    const types: TypeDefinition[] = [];
    const seen = new Set<string>();

    try {
      const files = await this.scanFiles();

      for (const file of files) {
        try {
          const content = await this.workspace.readFile(file);
          const fileTypes = this.extractTypes(content, file);
          for (const t of fileTypes) {
            const key = `${t.name}:${t.kind}`;
            if (!seen.has(key)) {
              seen.add(key);
              types.push(t);
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch (e: any) {
      ExecutionLogger.log('TYPE_INVENTORY', '-', '-',
        `Warning: type scan failed: ${e.message}`);
    }

    this.cache = {
      types: Object.freeze(types),
      scannedAt: new Date().toISOString(),
      projectPath: this.workspace.constructor.name,
    };
    this.cacheTime = now;

    ExecutionLogger.log('TYPE_INVENTORY', '-', '-',
      `Scanned ${types.length} type definitions`);

    return this.cache;
  }

  /**
   * Format inventory for injection into agent prompt.
   */
  formatForPrompt(inventory: TypeInventory, maxTypes: number = 20): string {
    if (inventory.types.length === 0) {
      return '';
    }

    const lines: string[] = [];
    lines.push('');
    lines.push('## EXISTING TYPES IN PROJECT (reuse when possible)');
    lines.push('');

    // Group by kind
    const byKind = { type: [], interface: [], enum: [] } as Record<string, TypeDefinition[]>;
    for (const t of inventory.types.slice(0, maxTypes)) {
      if (!byKind[t.kind]) byKind[t.kind] = [];
      byKind[t.kind].push(t);
    }

    for (const kind of ['type', 'interface', 'enum']) {
      const defs = byKind[kind] || [];
      if (defs.length > 0) {
        lines.push(`### ${kind.charAt(0).toUpperCase() + kind.slice(1)}s:`);
        for (const d of defs) {
          const exportStr = d.exported ? '(exported)' : '(internal)';
          lines.push(`- \`${d.name}\` ${exportStr} in ${d.file}`);
        }
        lines.push('');
      }
    }

    if (inventory.types.length > maxTypes) {
      lines.push(`... and ${inventory.types.length - maxTypes} more (use grep to find specific types)`);
      lines.push('');
    }

    lines.push('**GUIDANCE**: Before defining a new type, check if one already exists above.');
    lines.push('If a type with the same name or purpose exists, import it instead of redefining.');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Scan for .ts/.tsx files (excluding node_modules, tests, etc.)
   */
  private async scanFiles(): Promise<string[]> {
    const files: string[] = [];
    const dirsToScan = ['src', 'app', 'components', 'lib', 'types'];
    const excludeDirs = new Set([
      'node_modules', '.next', 'dist', 'build', '.git', '.ai',
      '__tests__', 'tests', 'coverage', '.nyc_output'
    ]);

    for (const dir of dirsToScan) {
      try {
        await this.scanDir(dir, files, excludeDirs, 0);
      } catch {
        // Directory doesn't exist
      }
    }

    return files;
  }

  private async scanDir(
    dir: string,
    files: string[],
    excludeDirs: Set<string>,
    depth: number
  ): Promise<void> {
    if (depth > 4) return; // Max depth

    try {
      const entries = await this.workspace.listEntries(dir);
      for (const entry of entries) {
        const fullPath = dir === '.' ? entry : `${dir}/${entry}`;

        if (entry.endsWith('/')) {
          const dirName = entry.slice(0, -1);
          if (excludeDirs.has(dirName)) continue;
          await this.scanDir(fullPath, files, excludeDirs, depth + 1);
        } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
          if (!entry.endsWith('.test.ts') && !entry.endsWith('.spec.ts')) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Skip inaccessible
    }
  }

  /**
   * Extract type/interface/enum definitions from file content.
   */
  private extractTypes(content: string, file: string): TypeDefinition[] {
    const types: TypeDefinition[] = [];
    const lines = content.split('\n');

    // Patterns for type definitions
    const patterns = [
      { kind: 'type' as const, regex: /^\s*(export\s+)?type\s+(\w+)/ },
      { kind: 'interface' as const, regex: /^\s*(export\s+)?interface\s+(\w+)/ },
      { kind: 'enum' as const, regex: /^\s*(export\s+)?enum\s+(\w+)/ },
    ];

    for (const line of lines) {
      for (const pattern of patterns) {
        const match = pattern.regex.exec(line);
        if (match) {
          const exported = !!match[1];
          const name = match[2];
          // Skip common utility types
          if (name.length > 1 && !name.startsWith('_')) {
            types.push({ name, kind: pattern.kind, file, exported });
          }
        }
      }
    }

    return types;
  }
}
