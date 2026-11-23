import { TypeInventory } from './type-inventory';

export interface TypeConflict {
  typeName: string;
  kind: 'type' | 'interface' | 'enum';
  existingFile: string;
  newFile: string;
  severity: 'warning' | 'error';
  message: string;
}

/**
 * D.3: Pre-Patch Type Checker
 * Checks if agent is redefining existing types in patch operations.
 */
export class PrePatchTypeChecker {
  /**
   * Check patch operations for type redefinitions.
   * Returns array of conflicts found.
   */
  check(
    operations: Array<{ path: string; newContent?: string; operation: string }>,
    inventory: TypeInventory
  ): TypeConflict[] {
    const conflicts: TypeConflict[] = [];

    for (const op of operations) {
      if (!op.newContent) continue;
      if (op.operation !== 'create' && op.operation !== 'modify') continue;

      const newTypes = this.extractTypes(op.newContent);

      for (const newType of newTypes) {
        // Find existing type with same name
        const existing = inventory.types.find(t =>
          t.name === newType.name && t.kind === newType.kind
        );

        if (existing && existing.file !== op.path) {
          const existingFilePath = existing.file;
          conflicts.push({
            typeName: newType.name,
            kind: newType.kind,
            existingFile: existingFilePath,
            newFile: op.path,
            severity: 'warning',
            message: `${newType.kind} '${newType.name}' already exists in ${existingFilePath}. Consider importing instead.`,
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Format conflicts for display to agent.
   */
  formatConflicts(conflicts: TypeConflict[]): string {
    if (conflicts.length === 0) return '';

    const lines: string[] = [];
    lines.push('');
    lines.push('⚠️  TYPE CONFLICTS DETECTED:');
    lines.push('');

    for (const conflict of conflicts) {
      lines.push(`- ${conflict.message}`);
    }

    lines.push('');
    lines.push('Please review: importing existing types is preferred over redefining.');
    lines.push('');

    return lines.join('\n');
  }

  private extractTypes(content: string): Array<{ name: string; kind: 'type' | 'interface' | 'enum' }> {
    const types: Array<{ name: string; kind: 'type' | 'interface' | 'enum' }> = [];
    const lines = content.split('\n');

    const patterns = [
      { kind: 'type' as const, regex: /^\s*(export\s+)?type\s+(\w+)/ },
      { kind: 'interface' as const, regex: /^\s*(export\s+)?interface\s+(\w+)/ },
      { kind: 'enum' as const, regex: /^\s*(export\s+)?enum\s+(\w+)/ },
    ];

    for (const line of lines) {
      for (const pattern of patterns) {
        const match = pattern.regex.exec(line);
        if (match) {
          const name = match[2];
          if (name.length > 1) {
            types.push({ name, kind: pattern.kind });
          }
        }
      }
    }

    return types;
  }
}
