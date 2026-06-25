import { faker } from '@faker-js/faker';
import { describe, expect, it } from 'vitest';
import {
	acceptInviteSchema,
	accountBusinessSchema,
	accountStatusSchema,
	createItemSchema,
	inviteMemberSchema,
	loginSchema,
	paginationQuerySchema,
	signupSchema,
	updateAccountSchema,
	updateItemSchema,
	updateMemberRoleSchema,
	verifyCodeSchema,
} from './schemas';

describe('loginSchema', () => {
	it('accepts an email and lowercases it (passwordless — no password field)', () => {
		const email = faker.internet.email();
		const parsed = loginSchema.parse({ email });
		expect(parsed.email).toBe(email.trim().toLowerCase());
	});

	it('rejects an invalid email', () => {
		expect(() => loginSchema.parse({ email: 'not-an-email' })).toThrow();
	});

	it('explains an invalid email in plain language', () => {
		const result = loginSchema.safeParse({ email: 'not-an-email' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe('Enter a valid email address.');
	});
});

describe('verifyCodeSchema', () => {
	it('accepts a 6-digit code and normalizes the email', () => {
		const parsed = verifyCodeSchema.parse({ email: '  Foo@Example.COM ', code: '123456' });
		expect(parsed).toEqual({ email: 'foo@example.com', code: '123456' });
	});

	it('trims surrounding whitespace from a pasted code', () => {
		expect(verifyCodeSchema.parse({ email: faker.internet.email(), code: ' 000042 ' }).code).toBe(
			'000042',
		);
	});

	it('rejects codes that are not exactly six digits', () => {
		const email = faker.internet.email();
		for (const code of ['12345', '1234567', 'abcdef', '12 34 56', '']) {
			expect(() => verifyCodeSchema.parse({ email, code })).toThrow();
		}
	});
});

describe('accountBusinessSchema', () => {
	it('applies defaults for every optional business field', () => {
		expect(accountBusinessSchema.parse({ businessName: 'Cascade Plumbing' })).toEqual({
			businessName: 'Cascade Plumbing',
			phone: '',
			address: '',
			website: '',
			timezone: 'UTC',
		});
	});

	it('trims the business name and rejects a blank one', () => {
		expect(accountBusinessSchema.parse({ businessName: '  Acme  ' }).businessName).toBe('Acme');
		expect(() => accountBusinessSchema.parse({ businessName: '   ' })).toThrow();
	});

	it('accepts a valid website URL', () => {
		expect(
			accountBusinessSchema.parse({ businessName: 'Acme', website: 'https://acme.example' })
				.website,
		).toBe('https://acme.example');
	});

	it('rejects a malformed website URL', () => {
		expect(() =>
			accountBusinessSchema.parse({ businessName: 'Acme', website: 'not a url' }),
		).toThrow();
	});

	it('gives a friendly, actionable message for a bad website URL', () => {
		const result = accountBusinessSchema.safeParse({ businessName: 'Acme', website: 'not a url' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe(
			'Enter a valid website URL, like https://example.com.',
		);
	});

	it('prompts for the business name when it is blank', () => {
		const result = accountBusinessSchema.safeParse({ businessName: '   ' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe('Business name is required.');
	});

	it('keeps provided phone, address, and timezone', () => {
		const parsed = accountBusinessSchema.parse({
			businessName: 'Acme',
			phone: '+1 206 555 0100',
			address: '1 Main St, Seattle, WA',
			timezone: 'America/Los_Angeles',
		});
		expect(parsed).toMatchObject({
			phone: '+1 206 555 0100',
			address: '1 Main St, Seattle, WA',
			timezone: 'America/Los_Angeles',
		});
	});
});

describe('signupSchema', () => {
	it('combines owner identity with nested business info (no password)', () => {
		const parsed = signupSchema.parse({
			email: 'OWNER@Example.com',
			name: 'Marcus Thompson',
			business: { businessName: 'Cascade Plumbing' },
		});
		expect(parsed.email).toBe('owner@example.com');
		expect(parsed.business.timezone).toBe('UTC');
	});

	it('rejects signup without business information', () => {
		expect(() =>
			signupSchema.parse({
				email: faker.internet.email(),
				name: 'Marcus',
			}),
		).toThrow();
	});
});

describe('inviteMemberSchema', () => {
	it('accepts every known role (per-inviter limits are enforced server-side)', () => {
		for (const role of ['owner', 'manager', 'member'] as const) {
			expect(
				inviteMemberSchema.parse({ email: faker.internet.email(), name: 'Pat', role }).role,
			).toBe(role);
		}
	});

	it('rejects an unknown role', () => {
		expect(() =>
			inviteMemberSchema.parse({ email: faker.internet.email(), name: 'Pat', role: 'admin' }),
		).toThrow();
	});
});

describe('accountStatusSchema', () => {
	it('accepts active and canceled', () => {
		expect(accountStatusSchema.parse('active')).toBe('active');
		expect(accountStatusSchema.parse('canceled')).toBe('canceled');
	});

	it('rejects an unknown status', () => {
		expect(() => accountStatusSchema.parse('deleted')).toThrow();
	});
});

describe('updateAccountSchema', () => {
	it('accepts a partial update of one field', () => {
		expect(updateAccountSchema.parse({ phone: '+1 206 555 0100' })).toEqual({
			phone: '+1 206 555 0100',
		});
	});

	it('trims and keeps the business name', () => {
		expect(updateAccountSchema.parse({ businessName: '  Acme  ' }).businessName).toBe('Acme');
	});

	it('rejects an empty update', () => {
		expect(() => updateAccountSchema.parse({})).toThrow();
	});

	it('rejects a malformed website', () => {
		expect(() => updateAccountSchema.parse({ website: 'not a url' })).toThrow();
	});
});

describe('acceptInviteSchema', () => {
	it('requires only a non-empty token (passwordless)', () => {
		expect(acceptInviteSchema.parse({ token: 'abc' })).toEqual({ token: 'abc' });
		expect(() => acceptInviteSchema.parse({ token: '' })).toThrow();
	});
});

describe('updateMemberRoleSchema', () => {
	it('accepts any known role', () => {
		expect(updateMemberRoleSchema.parse({ role: 'owner' }).role).toBe('owner');
	});

	it('rejects an unknown role', () => {
		expect(() => updateMemberRoleSchema.parse({ role: 'admin' })).toThrow();
	});
});

describe('createItemSchema', () => {
	it('applies defaults for description and status', () => {
		expect(createItemSchema.parse({ name: 'My Item' })).toMatchObject({
			description: '',
			status: 'active',
		});
	});

	it('rejects an unknown status', () => {
		expect(() => createItemSchema.parse({ name: 'x', status: 'deleted' })).toThrow();
	});
});

describe('updateItemSchema', () => {
	it('accepts a partial update', () => {
		expect(updateItemSchema.parse({ status: 'archived' })).toEqual({ status: 'archived' });
	});

	it('rejects an empty update', () => {
		expect(() => updateItemSchema.parse({})).toThrow();
	});
});

describe('paginationQuerySchema', () => {
	it('coerces string query params', () => {
		expect(paginationQuerySchema.parse({ page: '2', pageSize: '50' })).toEqual({
			page: 2,
			pageSize: 50,
		});
	});

	it('applies defaults when omitted', () => {
		expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
	});

	it('rejects a pageSize over the maximum', () => {
		expect(() => paginationQuerySchema.parse({ pageSize: '500' })).toThrow();
	});
});
