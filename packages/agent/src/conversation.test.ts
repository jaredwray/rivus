import { describe, expect, it } from 'vitest';
import { GREETING, lastUserMessage, replyTo } from './conversation';
import type { ChatMessage } from './types';

const user = (content: string): ChatMessage => ({ role: 'user', content });
const assistant = (content: string): ChatMessage => ({ role: 'assistant', content });

describe('lastUserMessage', () => {
	it('returns null when there are no messages', () => {
		expect(lastUserMessage([])).toBeNull();
	});

	it('returns null when no message is from the user', () => {
		expect(lastUserMessage([assistant('hi'), { role: 'system', content: 'be nice' }])).toBeNull();
	});

	it('returns the most recent user turn', () => {
		expect(lastUserMessage([user('first'), assistant('reply'), user('second')])).toBe('second');
	});
});

describe('replyTo', () => {
	it('greets with hello when the conversation is empty', () => {
		expect(replyTo([])).toEqual({ reply: GREETING });
		expect(GREETING.toLowerCase()).toContain('hello');
	});

	it('greets with a plain hello on the first user message', () => {
		expect(replyTo([user('hi there')])).toEqual({ reply: GREETING });
	});

	it('keeps greeting (ignoring non-user turns) until a second user turn', () => {
		expect(replyTo([assistant('seeded'), user('hi')])).toEqual({ reply: GREETING });
	});

	it('acknowledges the conversation once it continues', () => {
		const { reply } = replyTo([user('hi'), assistant(GREETING), user('still there?')]);
		expect(reply).toContain(GREETING);
		expect(reply).toContain('2 messages');
	});
});
