import * as ts from 'typescript';

/**
 * D.4: Structural Signature extracted from TypeScript AST
 */
export interface StructuralSignature {
  exports: Array<{
    name: string;
    kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable';
  }>;
  imports: Array<{
    modulePath: string;
    names: string[];
  }>;
  topLevelStatements: number;
}

/**
 * D.4: Result of structural comparison
 */
export interface StructuralComparisonResult {
  isSemanticRewrite: boolean;
  similarityScore: number; // 0-1, where 1 = identical
  removedExports: string[];
  addedExports: string[];
  removedImports: string[];
  addedImports: string[];
  reason?: string;
}

/**
 * D.4: TypeScript AST-based Structural Analyzer
 * Extracts signatures from TypeScript/TSX files and compares them.
 * Compatible with TypeScript 5.x API (uses canHaveModifiers/getModifiers).
 */
export class StructuralAnalyzer {
  /**
   * Extract structural signature from TypeScript content
   */
  extractSignature(content: string, fileName: string = 'file.ts'): StructuralSignature {
    const sourceFile = ts.createSourceFile(
      fileName,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    const exports: StructuralSignature['exports'] = [];
    const imports: StructuralSignature['imports'] = [];
    let topLevelStatements = 0;

    // Traverse top-level statements
    ts.forEachChild(sourceFile, (node) => {
      topLevelStatements++;

      // Extract exports (TS5 compatible)
      if (ts.isExportDeclaration(node) || 
          ts.isExportAssignment(node) ||
          this.hasExportKeyword(node)) {
        this.extractExportedDeclaration(node, exports);
      }

      // Extract imports (including side-effect and namespace imports)
      if (ts.isImportDeclaration(node)) {
        const modulePath = this.getModulePath(node);
        if (modulePath) {
          imports.push({ modulePath, names: this.getImportedNames(node) });
        }
      }

      // Re-exports also create a dependency edge on another module
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        const modulePath = ts.isStringLiteral(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : '';
        if (modulePath) {
          imports.push({ modulePath, names: this.getExportedNamesFromReExport(node) });
        }
      }
    });

    return { exports, imports, topLevelStatements };
  }

  /**
   * Compare two signatures and detect semantic rewrites
   */
  compareSignatures(
    oldSig: StructuralSignature,
    newSig: StructuralSignature
  ): StructuralComparisonResult {
    const oldExportNames = new Set(oldSig.exports.map(e => e.name));
    const newExportNames = new Set(newSig.exports.map(e => e.name));

    const removedExports = Array.from(oldExportNames).filter(n => !newExportNames.has(n));
    const addedExports = Array.from(newExportNames).filter(n => !oldExportNames.has(n));

    const oldImportModules = new Set(oldSig.imports.map(i => i.modulePath));
    const newImportModules = new Set(newSig.imports.map(i => i.modulePath));

    const removedImports = Array.from(oldImportModules).filter(m => !newImportModules.has(m));
    const addedImports = Array.from(newImportModules).filter(m => !oldImportModules.has(m));

    // Compute similarity score
    const totalExports = new Set([...oldExportNames, ...newExportNames]).size;
    const commonExports = new Set([...oldExportNames].filter(n => newExportNames.has(n))).size;
    const exportSimilarity = totalExports > 0 ? commonExports / totalExports : 1;

    const totalImports = new Set([...oldImportModules, ...newImportModules]).size;
    const commonImports = new Set([...oldImportModules].filter(m => newImportModules.has(m))).size;
    const importSimilarity = totalImports > 0 ? commonImports / totalImports : 1;

    const similarityScore = (exportSimilarity * 0.7) + (importSimilarity * 0.3);

    // Detect semantic rewrite
    const exportChangeRatio = totalExports > 0 ? (removedExports.length + addedExports.length) / totalExports : 0;
    const importChangeRatio = totalImports > 0 ? (removedImports.length + addedImports.length) / totalImports : 0;

    const isSemanticRewrite = exportChangeRatio > 0.5 || importChangeRatio > 0.5;

    let reason: string | undefined;
    if (isSemanticRewrite) {
      reason = `Semantic rewrite detected: ${removedExports.length} exports removed, ${addedExports.length} added; ${removedImports.length} imports removed, ${addedImports.length} added (similarity: ${(similarityScore * 100).toFixed(1)}%)`;
    }

    return {
      isSemanticRewrite,
      similarityScore,
      removedExports,
      addedExports,
      removedImports,
      addedImports,
      reason,
    };
  }

  /**
   * Check if content is a TypeScript file (by extension)
   */
  isTypeScriptFile(path: string): boolean {
    return path.endsWith('.ts') || path.endsWith('.tsx');
  }

  /**
   * TS5 compatible: check if node has export keyword
   */
  private hasExportKeyword(node: ts.Node): boolean {
    if (!ts.canHaveModifiers(node)) return false;
    const modifiers = ts.getModifiers(node);
    if (!modifiers) return false;
    for (const mod of modifiers) {
      if (mod.kind === ts.SyntaxKind.ExportKeyword) return true;
    }
    return false;
  }

  private extractExportedDeclaration(
    node: ts.Node,
    exports: StructuralSignature['exports']
  ): void {
    if (ts.isFunctionDeclaration(node) && node.name) {
      exports.push({ name: node.name.text, kind: 'function' });
    } else if (ts.isClassDeclaration(node) && node.name) {
      exports.push({ name: node.name.text, kind: 'class' });
    } else if (ts.isInterfaceDeclaration(node) && node.name) {
      exports.push({ name: node.name.text, kind: 'interface' });
    } else if (ts.isTypeAliasDeclaration(node) && node.name) {
      exports.push({ name: node.name.text, kind: 'type' });
    } else if (ts.isEnumDeclaration(node) && node.name) {
      exports.push({ name: node.name.text, kind: 'enum' });
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          exports.push({ name: decl.name.text, kind: 'variable' });
        }
      }
    }
  }

  private getModulePath(node: ts.ImportDeclaration): string {
    if (ts.isStringLiteral(node.moduleSpecifier)) {
      return node.moduleSpecifier.text;
    }
    return '';
  }

  private getImportedNames(node: ts.ImportDeclaration): string[] {
    const names: string[] = [];
    if (node.importClause) {
      if (node.importClause.name) {
        names.push(node.importClause.name.text);
      }
      if (node.importClause.namedBindings) {
        if (ts.isNamedImports(node.importClause.namedBindings)) {
          for (const element of node.importClause.namedBindings.elements) {
            names.push(element.name.text);
          }
        } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
          names.push(node.importClause.namedBindings.name.text);
        }
      }
    }
    return names;
  }

  private getExportedNamesFromReExport(node: ts.ExportDeclaration): string[] {
    const names: string[] = [];
    if (node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        names.push(element.name.text);
      }
    }
    return names;
  }
}
