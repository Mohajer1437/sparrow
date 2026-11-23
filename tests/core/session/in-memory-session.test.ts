import { InMemorySession } from '../../../src/core/session/in-memory-session';
import { SessionState } from '../../../src/contracts/session';
import { Message } from '../../../src/domain/message';

describe('InMemorySession', () => {
  let session: InMemorySession;

  beforeEach(() => {
    session = new InMemorySession();
  });

  describe('Session lifecycle', () => {
    it('should create an empty session with start()', async () => {
      const state = await session.start('Fix bug #42');

      expect(state.id).toBeDefined();
      expect(state.id.length).toBeGreaterThan(0);
      expect(state.task).toBe('Fix bug #42');
      expect(state.startedAt).toBeInstanceOf(Date);
      expect(state.endedAt).toBeUndefined();
      expect(state.summary).toBeUndefined();
      expect(state.modifiedFiles).toEqual([]);
      expect(Object.isFrozen(state.modifiedFiles)).toBe(true);
    });

    it('should generate unique ids for each session', async () => {
      const state1 = await session.start('Task 1');
      const state2 = await session.start('Task 2');
      
      expect(state1.id).not.toBe(state2.id);
    });

    it('should allow multiple sessions in the same instance', async () => {
      const state1 = await session.start('Task 1');
      const state2 = await session.start('Task 2');
      
      await session.appendMessage(state1.id, { role: 'user', content: 'Hello 1' });
      await session.appendMessage(state2.id, { role: 'user', content: 'Hello 2' });
      
      const history1 = await session.getHistory(state1.id);
      const history2 = await session.getHistory(state2.id);
      
      expect(history1.length).toBe(1);
      expect(history2.length).toBe(1);
      expect((history1[0].content as string)).toBe('Hello 1');
      expect((history2[0].content as string)).toBe('Hello 2');
    });

    it('should update state via end()', async () => {
      const state = await session.start('Task');
      await session.end(state.id, 'Completed', ['file.ts', 'other.ts']);
      
      const finalState = await session.getState(state.id);
      
      expect(finalState).toBeDefined();
      expect(finalState?.endedAt).toBeInstanceOf(Date);
      expect(finalState?.summary).toBe('Completed');
      expect(finalState?.modifiedFiles).toEqual(['file.ts', 'other.ts']);
      expect(Object.isFrozen(finalState?.modifiedFiles)).toBe(true);
    });
  });

  describe('Conversation history', () => {
    it('should start with empty history', async () => {
      const state = await session.start('Task');
      const history = await session.getHistory(state.id);
      
      expect(history).toEqual([]);
      expect(Object.isFrozen(history)).toBe(true);
    });

    it('should append user messages', async () => {
      const state = await session.start('Task');
      const userMsg: Message = { role: 'user', content: 'Hello' };
      
      await session.appendMessage(state.id, userMsg);
      const history = await session.getHistory(state.id);
      
      expect(history.length).toBe(1);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('Hello');
    });

    it('should append assistant messages', async () => {
      const state = await session.start('Task');
      const assistantMsg: Message = { role: 'assistant', content: 'Hi there!' };
      
      await session.appendMessage(state.id, assistantMsg);
      const history = await session.getHistory(state.id);
      
      expect(history.length).toBe(1);
      expect(history[0].role).toBe('assistant');
      expect(history[0].content).toBe('Hi there!');
    });

    it('should preserve insertion order', async () => {
      const state = await session.start('Task');
      
      await session.appendMessage(state.id, { role: 'user', content: '1st user' });
      await session.appendMessage(state.id, { role: 'assistant', content: '2nd assistant' });
      await session.appendMessage(state.id, { role: 'user', content: '3rd user' });
      await session.appendMessage(state.id, { role: 'assistant', content: '4th assistant' });
      
      const history = await session.getHistory(state.id);
      
      expect(history.length).toBe(4);
      expect(history[0]).toMatchObject({ role: 'user', content: '1st user' });
      expect(history[1]).toMatchObject({ role: 'assistant', content: '2nd assistant' });
      expect(history[2]).toMatchObject({ role: 'user', content: '3rd user' });
      expect(history[3]).toMatchObject({ role: 'assistant', content: '4th assistant' });
    });

    it('should handle multiple sequential appends', async () => {
      const state = await session.start('Task');
      
      for (let i = 0; i < 10; i++) {
        await session.appendMessage(state.id, { 
          role: i % 2 === 0 ? 'user' : 'assistant', 
          content: `Message ${i}` 
        });
      }
      
      const history = await session.getHistory(state.id);
      expect(history.length).toBe(10);
      
      for (let i = 0; i < 10; i++) {
        expect((history[i].content as string)).toBe(`Message ${i}`);
      }
    });

    it('should return frozen immutable arrays from getHistory', async () => {
      const state = await session.start('Task');
      await session.appendMessage(state.id, { role: 'user', content: 'test' });
      
      const history = await session.getHistory(state.id);
      
      expect(Object.isFrozen(history)).toBe(true);
      
      expect(() => {
        (history as any).push({ role: 'user', content: 'hack' });
      }).toThrow();
    });

    it('should freeze individual messages in returned history', async () => {
      const state = await session.start('Task');
      await session.appendMessage(state.id, { role: 'user', content: 'test' });
      
      const history = await session.getHistory(state.id);
      const msg = history[0] as any;
      
      expect(Object.isFrozen(msg)).toBe(true);
      
      expect(() => {
        msg.role = 'assistant';
      }).toThrow();
    });

    it('should not allow mutation via original input message reference', async () => {
      const state = await session.start('Task');
      const inputMessage: Message = { role: 'user', content: 'Original' };
      
      await session.appendMessage(state.id, inputMessage);
      
      // Mutating input after append should not affect stored history
      (inputMessage as any).content = 'Mutated';
      (inputMessage as any).role = 'assistant';
      
      const history = await session.getHistory(state.id);
      expect(history[0].content).toBe('Original');
      expect(history[0].role).toBe('user');
    });

    it('should clear history while keeping session state', async () => {
      const state = await session.start('Task');
      await session.appendMessage(state.id, { role: 'user', content: 'Hello' });
      await session.appendMessage(state.id, { role: 'assistant', content: 'Hi' });
      
      expect((await session.getHistory(state.id)).length).toBe(2);
      
      await session.clearHistory(state.id);
      
      const cleared = await session.getHistory(state.id);
      expect(cleared.length).toBe(0);
      expect(Object.isFrozen(cleared)).toBe(true);
      
      // Session state should remain
      const finalState = await session.getState(state.id);
      expect(finalState?.task).toBe('Task');
    });
  });

  describe('Error handling', () => {
    it('should throw when accessing history of non-existent session', async () => {
      await expect(session.getHistory('non-existent')).rejects.toThrow('Session not found');
    });

    it('should throw when appending to non-existent session', async () => {
      await expect(
        session.appendMessage('non-existent', { role: 'user', content: 'test' })
      ).rejects.toThrow('Session not found');
    });

    it('should throw when clearing history of non-existent session', async () => {
      await expect(session.clearHistory('non-existent')).rejects.toThrow('Session not found');
    });

    it('should throw when ending non-existent session', async () => {
      await expect(
        session.end('non-existent', 'summary', [])
      ).rejects.toThrow('Session not found');
    });
  });

  describe('Multi-part message support', () => {
    it('should handle messages with multi-part content (Vision-ready)', async () => {
      const state = await session.start('Task');
      const visionMessage: Message = {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image' },
          { type: 'text', text: ' (with details)' }
        ]
      };
      
      await session.appendMessage(state.id, visionMessage);
      const history = await session.getHistory(state.id);
      
      expect(history.length).toBe(1);
      expect(Array.isArray(history[0].content)).toBe(true);
      expect((history[0].content as any[])[0].text).toBe('Describe this image');
      
      // Multi-part content should also be frozen
      expect(Object.isFrozen(history[0].content)).toBe(true);
    });
  });
});
