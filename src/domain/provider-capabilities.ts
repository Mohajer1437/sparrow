export interface ProviderCapabilities {
  readonly supportsStreaming: boolean;
  readonly supportsVision: boolean;
  readonly supportsTools: boolean;
  readonly supportsJsonMode: boolean;
  readonly supportsReasoning: boolean;
  readonly supportsEmbeddings: boolean;
}
