export type ContextItemPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ContextItemCategory = 'RULE' | 'ARCHITECTURE' | 'PLAN' | 'FILE_CONTENT' | 'CODE_REFERENCE' | 'HISTORY' | 'OTHER';

export interface ContextItem {
  readonly id: string;
  readonly source: string;
  readonly content: string;
  readonly size: number;
  readonly priority: ContextItemPriority;
  readonly category: ContextItemCategory;
}

export interface OptimizationOptions {
  readonly maxContextChars?: number;
  readonly targetFiles?: ReadonlyArray<string>;
  readonly affectedFiles?: ReadonlyArray<string>;
}

export interface ContextOptimizationResult {
  readonly optimizedContext: import('./context').ContextObject;
  readonly originalSize: number;
  readonly optimizedSize: number;
  readonly removedItems: ReadonlyArray<string>;
  readonly compressedItems: ReadonlyArray<string>;
  readonly selectedItems: ReadonlyArray<string>;
  readonly optimizationReason: string;
}
