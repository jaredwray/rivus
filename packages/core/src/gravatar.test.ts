import { createHash } from 'node:crypto';
import { faker } from '@faker-js/faker';
import { describe, expect, it } from 'vitest';
import { gravatarUrl } from './gravatar';

/** Reference MD5 via Node's `crypto`, so the dependency-free implementation is cross-checked. */
function referenceHash(email: string): string {
	return createHash('md5').update(email.trim().toLowerCase()).digest('hex');
}

describe('gravatarUrl', () => {
	it('builds a Gravatar URL keyed by the MD5 hash of the trimmed, lowercased email', () => {
		const email = '  MyEmailAddress@Example.com  ';
		expect(gravatarUrl(email)).toBe(
			`https://www.gravatar.com/avatar/${referenceHash(email)}?s=200&d=404`,
		);
	});

	it('matches the MD5 reference implementation across a range of emails', () => {
		for (let i = 0; i < 25; i++) {
			const email = faker.internet.email();
			expect(gravatarUrl(email)).toContain(referenceHash(email));
		}
	});

	it('hashes a message long enough to span multiple 64-byte MD5 chunks', () => {
		const email = `${faker.string.alpha(120)}@example.com`;
		expect(gravatarUrl(email)).toContain(referenceHash(email));
	});

	it('is case- and whitespace-insensitive, like Gravatar requires', () => {
		expect(gravatarUrl('Foo@Bar.com')).toBe(gravatarUrl('  foo@bar.com  '));
	});

	it('defaults to a 200px image and a 404 default (so callers can fall back to initials)', () => {
		const url = gravatarUrl('foo@bar.com');
		expect(url).toContain('s=200');
		expect(url).toContain('d=404');
	});

	it('accepts a custom size and default image', () => {
		const url = gravatarUrl('foo@bar.com', { size: 64, default: 'identicon' });
		expect(url).toContain('s=64');
		expect(url).toContain('d=identicon');
	});

	it('is deterministic — the same email always builds the same URL', () => {
		const email = faker.internet.email();
		expect(gravatarUrl(email)).toBe(gravatarUrl(email));
	});
});
