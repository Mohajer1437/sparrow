export interface RuntimeRepository {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  listFiles(dirPath: string): Promise<string[]>;
  mkdir(dirPath: string): Promise<void>;
  appendFeedbackCandidates(candidates: ReadonlyArray<import('../domain/knowledge-feedback').KnowledgeCandidate>): Promise<void>;
}
