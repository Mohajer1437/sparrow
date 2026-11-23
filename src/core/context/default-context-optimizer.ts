import { ContextOptimizer } from '../../contracts/context-optimizer';
import { ContextObject, ContextFile } from '../../domain/context';
import { ProjectRule } from '../../domain/rule';
import { KnowledgeItem } from '../../domain/knowledge';
import { ProjectMemoryEntry } from '../../domain/memory';
import { 
  ContextOptimizationResult, 
  OptimizationOptions, 
  ContextItem,
  ContextItemPriority
} from '../../domain/context-optimization';

export class DefaultContextOptimizer implements ContextOptimizer {
  private readonly defaultMaxChars = 8000;

  async optimize(context: ContextObject, options?: OptimizationOptions): Promise<ContextOptimizationResult> {
    const maxChars = options?.maxContextChars ?? this.defaultMaxChars;
    const affectedFiles = new Set(options?.affectedFiles || []);

    const items: ContextItem[] = [];

    // RULE_01: Preserve Critical Knowledge (Rules are CRITICAL)
    context.rules.forEach((rule, idx) => {
      items.push({
        id: rule.id || `rule-${idx}`,
        source: 'rules',
        content: JSON.stringify(rule),
        size: JSON.stringify(rule).length,
        priority: 'CRITICAL',
        category: 'RULE'
      });
    });

    // RULE_02: Priority Based Selection (Knowledge is HIGH)
    context.knowledge.forEach((k, idx) => {
      items.push({
        id: k.id || `knowledge-${idx}`,
        source: 'knowledge',
        content: JSON.stringify(k),
        size: JSON.stringify(k).length,
        priority: 'HIGH',
        category: 'ARCHITECTURE'
      });
    });

    // RULE_05: Relevance Filtering (Affected files are HIGH, others MEDIUM)
    context.files.forEach((file) => {
      const isAffected = affectedFiles.has(file.path);
      items.push({
        id: file.path,
        source: 'files',
        content: JSON.stringify(file),
        size: JSON.stringify(file).length,
        priority: isAffected ? 'HIGH' : 'MEDIUM',
        category: 'FILE_CONTENT'
      });
    });

    // Memories are LOW priority
    context.memories.forEach((m, idx) => {
      items.push({
        id: m.key || `memory-${idx}`,
        source: 'memories',
        content: JSON.stringify(m),
        size: JSON.stringify(m).length,
        priority: 'LOW',
        category: 'HISTORY'
      });
    });

    const originalSize = items.reduce((sum, item) => sum + item.size, 0);

    // RULE_04: Duplicate Removal
    const uniqueItems = this.removeDuplicates(items);

    // RULE_03: Size Budgeting & Priority Based Selection
    const priorityOrder: ContextItemPriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    uniqueItems.sort((a, b) => priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority));

    const selectedItems: ContextItem[] = [];
    const removedItems: string[] = [];
    let currentSize = 0;

    for (const item of uniqueItems) {
      if (currentSize + item.size <= maxChars) {
        selectedItems.push(item);
        currentSize += item.size;
      } else {
        removedItems.push(item.id);
      }
    }

    // Rebuild ContextObject
    const optimizedContext: ContextObject = {
      taskIntent: context.taskIntent,
      rules: Object.freeze(selectedItems.filter(i => i.category === 'RULE').map(i => JSON.parse(i.content) as ProjectRule)),
      knowledge: Object.freeze(selectedItems.filter(i => i.category === 'ARCHITECTURE').map(i => JSON.parse(i.content) as KnowledgeItem)),
      files: Object.freeze(selectedItems.filter(i => i.category === 'FILE_CONTENT').map(i => JSON.parse(i.content) as ContextFile)),
      memories: Object.freeze(selectedItems.filter(i => i.category === 'HISTORY').map(i => JSON.parse(i.content) as ProjectMemoryEntry)),
      metadata: context.metadata
    };

    const optimizedSize = selectedItems.reduce((sum, item) => sum + item.size, 0);

    return Object.freeze({
      optimizedContext,
      originalSize,
      optimizedSize,
      removedItems: Object.freeze(removedItems),
      compressedItems: Object.freeze([]),
      selectedItems: Object.freeze(selectedItems.map(i => i.id)),
      optimizationReason: removedItems.length > 0 
        ? `Context exceeded ${maxChars} chars, removed ${removedItems.length} low-priority items.` 
        : 'Context within limits, no removal needed.'
    });
  }

  private removeDuplicates(items: ContextItem[]): ContextItem[] {
    const seen = new Set<string>();
    return items.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }
}
