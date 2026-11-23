export type ModelAvailability = 'available' | 'unavailable' | 'deprecated';

export interface ModelDescriptor {
  readonly id: string;
  readonly providerId: string;
  readonly displayName: string;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly supportsTools: boolean;
  readonly supportsVision: boolean;
  readonly supportsThinking: boolean;
  readonly isLocal: boolean;
  readonly availability: ModelAvailability;
  readonly tags: ReadonlyArray<string>;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface ModelFilter {
  readonly providerId?: string;
  readonly supportsTools?: boolean;
  readonly supportsVision?: boolean;
  readonly supportsThinking?: boolean;
  readonly isLocal?: boolean;
  readonly availability?: ModelAvailability;
  readonly tags?: ReadonlyArray<string>;
}
