import { describe, expect, it } from 'vitest';
import { agentEmailLocalPart, agentEmailTag, stripAgentEmailTag } from './agent-email';

describe('agentEmailTag', () => {
	it('is 8 lowercase hex characters', () => {
		expect(agentEmailTag('550e8400-e29b-41d4-a716-446655440000')).toMatch(/^[0-9a-f]{8}$/);
		expect(agentEmailTag('507f1f77bcf86cd799439011')).toMatch(/^[0-9a-f]{8}$/);
	});

	it('is stable for the same id', () => {
		const id = '550e8400-e29b-41d4-a716-446655440000';
		expect(agentEmailTag(id)).toBe(agentEmailTag(id));
	});

	it('distinguishes ids that differ by a single character', () => {
		expect(agentEmailTag('account-1')).not.toBe(agentEmailTag('account-2'));
	});

	it('always zero-pads to a full 8 characters', () => {
		// Whatever the id, the tag never comes out short even when the hash is small.
		for (const id of ['', 'a', 'x', 'the-account', '0000']) {
			expect(agentEmailTag(id)).toHaveLength(8);
		}
	});
});

describe('agentEmailLocalPart', () => {
	it('is the slug followed by the hex tag', () => {
		const id = '550e8400-e29b-41d4-a716-446655440000';
		expect(agentEmailLocalPart('jw-riv-inc', id)).toBe(`jw-riv-inc-${agentEmailTag(id)}`);
	});
});

describe('stripAgentEmailTag', () => {
	it('peels the trailing hex tag back to the bare slug', () => {
		expect(stripAgentEmailTag('jw-riv-inc-1a2b3c4d')).toBe('jw-riv-inc');
	});

	it('leaves a bare slug (no tag) untouched', () => {
		expect(stripAgentEmailTag('jw-riv-inc')).toBe('jw-riv-inc');
		// A trailing segment that is not exactly 8 hex chars is part of the slug.
		expect(stripAgentEmailTag('store-12345')).toBe('store-12345');
		expect(stripAgentEmailTag('shop-2')).toBe('shop-2');
	});

	it('round-trips the local part built by agentEmailLocalPart', () => {
		const slug = 'cascade-plumbing';
		const id = '507f1f77bcf86cd799439011';
		expect(stripAgentEmailTag(agentEmailLocalPart(slug, id))).toBe(slug);
	});
});
