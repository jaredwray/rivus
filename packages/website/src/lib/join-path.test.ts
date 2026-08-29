import { describe, expect, it } from 'vitest';
import { joinSlugFromPath, rewriteJoinRequestUrl } from './join-path';

describe('joinSlugFromPath', () => {
	it('reads the account slug from the public join URL', () => {
		expect(joinSlugFromPath('/customers/join/cascade-plumbing')).toBe('cascade-plumbing');
		expect(joinSlugFromPath('/customers/join/cascade-plumbing/')).toBe('cascade-plumbing');
	});

	it('rejects the template itself and extra segments', () => {
		expect(joinSlugFromPath('/customers/join')).toBeUndefined();
		expect(joinSlugFromPath('/customers/join/')).toBeUndefined();
		expect(joinSlugFromPath('/customers/join/a/b')).toBeUndefined();
		expect(joinSlugFromPath('/about')).toBeUndefined();
	});
});

describe('rewriteJoinRequestUrl', () => {
	it('collapses a per-business join path onto the static template', () => {
		expect(rewriteJoinRequestUrl('/customers/join/cascade-plumbing')).toBe('/customers/join');
		expect(rewriteJoinRequestUrl('/customers/join/cascade-plumbing?email=a@b.com')).toBe(
			'/customers/join?email=a@b.com',
		);
	});

	it('leaves the template and unrelated paths alone', () => {
		expect(rewriteJoinRequestUrl('/customers/join')).toBe('/customers/join');
		expect(rewriteJoinRequestUrl('/about')).toBe('/about');
	});
});

describe('joinSlugFromPath', () => {
	it('reads the account slug from the public join URL', () => {
		expect(joinSlugFromPath('/customers/join/cascade-plumbing')).toBe('cascade-plumbing');
		expect(joinSlugFromPath('/customers/join/cascade-plumbing/')).toBe('cascade-plumbing');
	});

	it('rejects the template itself and extra segments', () => {
		expect(joinSlugFromPath('/customers/join')).toBeUndefined();
		expect(joinSlugFromPath('/customers/join/')).toBeUndefined();
		expect(joinSlugFromPath('/customers/join/a/b')).toBeUndefined();
		expect(joinSlugFromPath('/about')).toBeUndefined();
	});
});
