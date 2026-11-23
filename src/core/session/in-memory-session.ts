import { Session, SessionState } from '../../contracts/session';
import { Message } from '../../domain/message';
import { randomUUID } from 'crypto';

interface InternalSession {
  state: SessionState;
  history: ReadonlyArray<Readonly<Message>>;
}

export class InMemorySession implements Session {
  private readonly sessions = new Map<string, InternalSession>();

  async start(task: string): Promise<SessionState> {
    const id = randomUUID();
    const state: SessionState = {
      id,
      task,
      startedAt: new Date(),
      modifiedFiles: Object.freeze([] as string[])
    };

    this.sessions.set(id, {
      state: Object.freeze({ ...state }),
      history: Object.freeze([])
    });

    return state;
  }

  async end(sessionId: string, summary: string, modifiedFiles: ReadonlyArray<string>): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.state = Object.freeze({
      ...session.state,
      endedAt: new Date(),
      summary,
      modifiedFiles: Object.freeze([...modifiedFiles])
    });
  }

  async getState(sessionId: string): Promise<SessionState | undefined> {
    return this.sessions.get(sessionId)?.state;
  }

  async appendMessage(sessionId: string, message: Message): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const frozenMessage = this.deepFreezeMessage(message);
    session.history = Object.freeze([...session.history, frozenMessage]);
  }

  async getHistory(sessionId: string): Promise<ReadonlyArray<Readonly<Message>>> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return Object.freeze([...session.history]);
  }

  async clearHistory(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.history = Object.freeze([]);
  }

  private deepFreezeMessage(message: Message): Readonly<Message> {
    const frozen: any = {
      role: message.role,
    };

    if (typeof message.content === 'string') {
      frozen.content = message.content;
    } else {
      frozen.content = Object.freeze(
        message.content.map(part => Object.freeze({ ...part }))
      );
    }

    if (message.tool_calls) {
      frozen.tool_calls = Object.freeze(
        message.tool_calls.map(tc => Object.freeze({ ...tc }))
      );
    }

    if (message.tool_call_id !== undefined) {
      frozen.tool_call_id = message.tool_call_id;
    }

    if (message.name !== undefined) {
      frozen.name = message.name;
    }

    return Object.freeze(frozen);
  }
}
