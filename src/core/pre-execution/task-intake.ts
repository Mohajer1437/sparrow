/**
 * G.1: DefaultTaskIntake — Intent Normalization
 * 
 * Normalizes raw user prompts into structured TaskIntent using
 * deterministic rules (regex, keyword matching).
 * 
 * Phase 1: Deterministic only. LLM integration can be added later.
 */

import { TaskIntake } from '../../contracts/task-intake';
import {
  IntentNormalizationRequest,
  IntentNormalizationResult,
  TaskIntent,
  IntentType,
  TaskMode,
  InformationItem,
  InformationStatus,
} from '../../domain/pre-execution/intent';

/** Regex for file paths with common extensions, excluding wildcard globs (*.ts) */
const FILE_PATH_REGEX = /(?:^|[\s"'`(\[])(?![\*.])([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|json|md|css|scss))\b/gi;

/** Keywords for intent type classification */
const INTENT_KEYWORDS: ReadonlyMap<IntentType, ReadonlyArray<string>> = new Map<IntentType, ReadonlyArray<string>>([
  ['BUG_FIX', Object.freeze(['fix', 'bug', 'error', 'issue', 'broken', 'fail', 'crash', 'not working', 'wrong'])],
  ['FEATURE', Object.freeze(['add', 'create', 'implement', 'build', 'new', 'make', 'develop'])],
  ['REFACTOR', Object.freeze(['refactor', 'restructure', 'cleanup', 'clean up', 'reorganize', 'simplify'])],
  ['INVESTIGATION', Object.freeze(['investigate', 'analyze', 'understand', 'why', 'how', 'what', 'explain'])],
  ['CONFIGURATION', Object.freeze(['config', 'setting', 'environment', 'enable', 'disable', 'setup', 'configure'])],
  ['TEST', Object.freeze(['test', 'spec', 'coverage', 'assert', 'verify', 'validate'])],
  ['DOCUMENTATION', Object.freeze(['document', 'readme', 'comment', 'docs', 'documentation'])],
  ['DEPENDENCY', Object.freeze(['dependency', 'package', 'install', 'upgrade', 'version', 'update package'])],
  ['PERFORMANCE', Object.freeze(['performance', 'speed', 'slow', 'fast', 'optimize', 'latency'])],
]);

export class DefaultTaskIntake implements TaskIntake {
  async normalize(request: IntentNormalizationRequest): Promise<IntentNormalizationResult> {
    const rawPrompt = request.rawPrompt.trim();
    
    // 1. Classify intent type
    const type = this.classifyIntentType(rawPrompt);
    
    // 2. Determine task mode
    const mode = this.determineTaskMode(rawPrompt);
    
    // 3. Extract objective
    const objective = this.extractObjective(rawPrompt);
    
    // 4. Extract scope (file paths)
    const initialScope = this.extractScope(rawPrompt);
    
    // 5. Extract symptoms and errors
    const symptoms = this.extractSymptoms(rawPrompt);
    const knownErrors = this.extractKnownErrors(rawPrompt);
    
    // 6. Extract constraints
    const constraints = this.extractConstraints(rawPrompt);
    
    // 7. Extract success criteria
    const successCriteria = this.extractSuccessCriteria(rawPrompt);
    
    // 8. Classify information items
    const information = this.classifyInformation(rawPrompt);
    
    // 9. Build intent
    const intent: TaskIntent = Object.freeze({
      id: `intent-${Date.now()}`,
      rawPrompt,
      type,
      mode,
      objective,
      initialScope: Object.freeze(initialScope),
      symptoms: Object.freeze(symptoms),
      knownErrors: Object.freeze(knownErrors),
      constraints: Object.freeze(constraints),
      successCriteria: Object.freeze(successCriteria),
      information: Object.freeze(information),
      normalizedAt: new Date().toISOString(),
    });
    
    // 10. Detect ambiguities
    const ambiguities = this.detectAmbiguities(rawPrompt, type);
    
    // 11. Detect critical missing info
    const criticalMissingInfo = this.detectCriticalMissingInfo(rawPrompt, type, initialScope);
    
    // 12. Compute readiness score
    const readinessScore = this.computeReadinessScore(ambiguities, criticalMissingInfo);
    
    return Object.freeze({
      intent,
      ambiguities: Object.freeze(ambiguities),
      criticalMissingInfo: Object.freeze(criticalMissingInfo),
      readinessScore,
    });
  }

  /**
   * Classify the intent type based on keywords.
   */
  private classifyIntentType(prompt: string): IntentType {
    const lower = prompt.toLowerCase();
    
    // Check for explicit read-only / investigation / analysis directives first
    const isInvestigation =
      /\b(read_only|read only|do not modify|do not create|only inspect|only analyze|reconnaissance|understanding report|architecture discovery)\b/i.test(prompt) ||
      /^\s*(?:\/execute\s+)?(?:analyze|inspect|investigate|explain|explore|audit|survey|understand|review|discovery|map|detect)\b/i.test(prompt) ||
      /\b(?:perform the following analysis|technical understanding of this)\b/i.test(prompt);

    if (isInvestigation) {
      return 'INVESTIGATION';
    }

    // Check each intent type in priority order
    const priorityOrder: ReadonlyArray<IntentType> = Object.freeze([
      'BUG_FIX',
      'INVESTIGATION',
      'CONFIGURATION',
      'DEPENDENCY',
      'TEST',
      'DOCUMENTATION',
      'PERFORMANCE',
      'REFACTOR',
      'FEATURE',
    ]);
    
    for (const intentType of priorityOrder) {
      const keywords = INTENT_KEYWORDS.get(intentType);
      if (keywords) {
        for (const keyword of keywords) {
          const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`\\b${escaped}\\b`, 'i');
          if (regex.test(prompt)) {
            return intentType;
          }
        }
      }
    }
    
    // Default to FEATURE if no keywords match
    return 'FEATURE';
  }

  /**
   * Determine task mode (EASY/MEDIUM/HARD) based on complexity indicators.
   */
  private determineTaskMode(prompt: string): TaskMode {
    const wordCount = prompt.split(/\s+/).length;
    const fileRefs = this.extractScope(prompt);
    const fileCount = fileRefs.length;
    
    // Count action verbs
    const actionVerbs = /\b(create|add|modify|update|delete|implement|write|build|setup|configure|test|verify|refactor|fix)\b/gi;
    const actionCount = (prompt.match(actionVerbs) || []).length;
    
    // HARD: many files, many actions, long prompt
    if (fileCount > 3 || actionCount > 3 || wordCount > 60) {
      return 'HARD';
    }
    
    // MEDIUM: 2-3 files, moderate complexity
    if (fileCount >= 2 || actionCount >= 2 || wordCount > 25) {
      return 'MEDIUM';
    }
    
    // EASY: single file, simple operation
    return 'EASY';
  }

  /**
   * Extract the main objective from the prompt.
   * Uses the first sentence or the whole prompt if short.
   */
  private extractObjective(prompt: string): string {
    // Try to find the main action
    const sentences = prompt.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    if (sentences.length === 0) {
      return prompt;
    }
    
    // Use the first sentence as objective
    const firstSentence = sentences[0].trim();
    
    // If the first sentence is too short, combine with second
    if (firstSentence.length < 20 && sentences.length > 1) {
      return `${firstSentence}. ${sentences[1].trim()}`;
    }
    
    return firstSentence;
  }

  /**
   * Extract file paths from the prompt.
   */
  private extractScope(prompt: string): string[] {
    const paths: string[] = [];
    const seen = new Set<string>();
    
    let match;
    const regex = new RegExp(FILE_PATH_REGEX.source, 'gi');
    while ((match = regex.exec(prompt)) !== null) {
      let path = match[1] || match[0];
      if (path.startsWith('./')) path = path.substring(2);
      if (path.length < 3) continue;
      if (path.includes('*') || path.includes('://')) continue;
      // "Next.js" matches the extension regex but is not a source file.
      if (!path.includes('/') && !/\.(tsx|ts|jsx|json|md)$/i.test(path)) continue;
      if (!seen.has(path)) {
        seen.add(path);
        paths.push(path);
      }
    }
    
    return paths;
  }

  /**
   * Extract symptoms or error descriptions from the prompt.
   */
  private extractSymptoms(prompt: string): string[] {
    const symptoms: string[] = [];
    const lower = prompt.toLowerCase();
    
    // Look for error-related phrases
    const symptomPatterns = [
      /\b(error|bug|issue|problem|failure|crash)\b[:\s]+([^.!?]+)/gi,
      /\b(not working|broken|failing|crashing)\b/gi,
      /\b(shows?|displays?|returns?|throws?)\s+([^.!?]+)/gi,
    ];
    
    for (const pattern of symptomPatterns) {
      let match;
      const regex = new RegExp(pattern.source, pattern.flags);
      while ((match = regex.exec(prompt)) !== null) {
        const symptom = match[0].trim();
        if (symptom.length > 5 && !symptoms.includes(symptom)) {
          symptoms.push(symptom);
        }
      }
    }
    
    return symptoms.slice(0, 5); // Limit to 5 symptoms
  }

  /**
   * Extract known error messages from the prompt.
   */
  private extractKnownErrors(prompt: string): string[] {
    const errors: string[] = [];
    
    // Look for quoted error messages
    const quotedPattern = /["']([^"']{10,})["']/g;
    let match;
    while ((match = quotedPattern.exec(prompt)) !== null) {
      const quoted = match[1];
      if (quoted.length > 10 && quoted.length < 200) {
        errors.push(quoted);
      }
    }
    
    // Look for error codes
    const errorCodePattern = /\b(E[A-Z]{2,}\d+|[A-Z]+_ERROR|\d{3,4})\b/g;
    while ((match = errorCodePattern.exec(prompt)) !== null) {
      errors.push(match[0]);
    }
    
    return errors.slice(0, 3); // Limit to 3 errors
  }

  /**
   * Extract constraints mentioned in the prompt.
   */
  private extractConstraints(prompt: string): string[] {
    const constraints: string[] = [];
    const lower = prompt.toLowerCase();
    
    // Look for constraint keywords
    const constraintPatterns = [
      /\b(do not|don't|don t|never|must not|should not|avoid|without)\s+([^.!?]+)/gi,
      /\b(only|just|simply|exactly)\s+([^.!?]+)/gi,
      /\b(keep|maintain|preserve|retain)\s+([^.!?]+)/gi,
      /\b(use|using)\s+(existing|current|the same)\s+([^.!?]+)/gi,
    ];
    
    for (const pattern of constraintPatterns) {
      let match;
      const regex = new RegExp(pattern.source, pattern.flags);
      while ((match = regex.exec(prompt)) !== null) {
        const constraint = match[0].trim();
        if (constraint.length > 5 && !constraints.includes(constraint)) {
          constraints.push(constraint);
        }
      }
    }
    
    return constraints.slice(0, 5); // Limit to 5 constraints
  }

  /**
   * Extract success criteria from the prompt.
   */
  private extractSuccessCriteria(prompt: string): string[] {
    const criteria: string[] = [];
    
    // Look for success-related phrases
    const successPatterns = [
      /\b(should|must|expect|verify|confirm|when|after|once)\s+([^.!?]+)/gi,
      /\b(so that|in order to|to ensure)\s+([^.!?]+)/gi,
      /\b(success|successful|working|correct|properly)\s+([^.!?]+)/gi,
    ];
    
    for (const pattern of successPatterns) {
      let match;
      const regex = new RegExp(pattern.source, pattern.flags);
      while ((match = regex.exec(prompt)) !== null) {
        const criterion = match[0].trim();
        if (criterion.length > 10 && !criteria.includes(criterion)) {
          criteria.push(criterion);
        }
      }
    }
    
    return criteria.slice(0, 5); // Limit to 5 criteria
  }

  /**
   * Classify information items from the prompt.
   * Phase 1: Simple classification based on sentence structure.
   */
  private classifyInformation(prompt: string): InformationItem[] {
    const items: InformationItem[] = [];
    const sentences = prompt.split(/[.!?]+/).filter(s => s.trim().length > 10);
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i].trim();
      const lower = sentence.toLowerCase();
      
      // Determine status
      // Default to UNKNOWN unless explicitly established as FACT/ASSUMPTION/HYPOTHESIS
      let status: InformationStatus = 'UNKNOWN';
      let requiresEvidence = true;  // UNKNOWN always requires evidence
      
      if (/\b(maybe|perhaps|possibly|i think|i believe|probably|might|could be)\b/.test(lower)) {
        status = 'ASSUMPTION';
        requiresEvidence = true;
      } else if (/\b(why|how|what|where|when)\b/.test(lower)) {
        status = 'UNKNOWN';
        requiresEvidence = true;
      } else if (/\b(if|when|unless|provided)\b/.test(lower)) {
        status = 'HYPOTHESIS';
        requiresEvidence = true;
      }
      
      items.push(Object.freeze({
        id: `info-${i}`,
        content: sentence,
        status,
        source: 'user_prompt' as const,
        requiresEvidence,
      }));
    }
    
    return items.slice(0, 20); // Limit to 20 items
  }

  /**
   * Detect ambiguities in the prompt.
   */
  private detectAmbiguities(prompt: string, type: IntentType): string[] {
    const ambiguities: string[] = [];
    const lower = prompt.toLowerCase();
    
    // Vague terms
    if (/\b(some|somehow|something|some way|maybe|perhaps|possibly|around|about|roughly)\b/.test(lower)) {
      ambiguities.push('Vague terms detected: "some", "maybe", "perhaps", "around"');
    }
    
    // Missing file specifics for modification tasks
    if (type === 'BUG_FIX' || type === 'FEATURE' || type === 'REFACTOR') {
      const fileRefs = this.extractScope(prompt);
      if (fileRefs.length === 0) {
        ambiguities.push('No specific file mentioned for modification task');
      }
    }
    
    // Missing success criteria. Exact/visible acceptance text is enough to infer success.
    if (!/\b(should|must|expect|verify|confirm|when|after|once|so that|exact(?:ly)?|visible text|acceptance|report|analysis result|output requirements)\b/.test(lower)) {
      ambiguities.push('No clear success criteria mentioned');
    }
    
    // Unclear scope
    if (/\b(all|every|each|entire|whole|complete)\b/.test(lower) && type !== 'INVESTIGATION') {
      ambiguities.push('Scope may be too broad: "all", "every", "entire" detected');
    }
    
    // Multiple objectives
    const actionVerbs = /\b(create|add|modify|update|delete|implement|fix|refactor|test)\b/gi;
    const actionCount = (prompt.match(actionVerbs) || []).length;
    if (actionCount > 3 && type !== 'INVESTIGATION') {
      ambiguities.push(`Multiple objectives detected (${actionCount} action verbs) — consider splitting`);
    }
    
    return ambiguities;
  }

  /**
   * Detect critical missing information.
   */
  private detectCriticalMissingInfo(
    prompt: string,
    type: IntentType,
    scope: string[],
  ): string[] {
    const missing: string[] = [];
    
    // BUG_FIX needs error description
    if (type === 'BUG_FIX') {
      if (!/\b(error|bug|issue|fail|crash|broken|not working)\b/i.test(prompt)) {
        missing.push('BUG_FIX task requires error description or symptom');
      }
    }
    
    // FEATURE needs scope
    if (type === 'FEATURE' && scope.length === 0) {
      missing.push('FEATURE task requires target file(s) or component');
    }
    
    // REFACTOR needs scope and constraints
    if (type === 'REFACTOR' && scope.length === 0) {
      missing.push('REFACTOR task requires target file(s) or module');
    }
    
    // CONFIGURATION needs config file
    if (type === 'CONFIGURATION') {
      const hasConfigFile = scope.some(f => 
        f.includes('config') || f.includes('.env') || f.includes('tsconfig') || f.includes('package.json')
      );
      if (!hasConfigFile) {
        missing.push('CONFIGURATION task requires config file reference');
      }
    }
    
    return missing;
  }

  /**
   * Compute readiness score (0-100).
   */
  private computeReadinessScore(
    ambiguities: string[],
    criticalMissingInfo: string[],
  ): number {
    let score = 100;
    
    // Deduct for ambiguities (5 points each)
    score -= ambiguities.length * 5;
    
    // Deduct for critical missing info (20 points each)
    score -= criticalMissingInfo.length * 20;
    
    // Clamp to 0-100
    return Math.max(0, Math.min(100, score));
  }
}
