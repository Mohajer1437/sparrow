import { Message } from '../domain/message';

export interface SessionState {
  readonly id: string;
  readonly task: string;
  readonly startedAt: Date;
  readonly endedAt?: Date;
  readonly summary?: string;
  readonly modifiedFiles: ReadonlyArray<string>;
}

export interface Session {
  // Task & Session Lifecycle (existing, preserved)
  start(task: string): Promise<SessionState>;
  end(sessionId: string, summary: string, modifiedFiles: ReadonlyArray<string>): Promise<void>;
  getState(sessionId: string): Promise<SessionState | undefined>;

  // Conversation History Management (added in S5.1)
  appendMessage(sessionId: string, message: Message): Promise<void>;
  getHistory(sessionId: string): Promise<ReadonlyArray<Readonly<Message>>>;
  clearHistory(sessionId: string): Promise<void>;
}
