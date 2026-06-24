import { faker } from '@faker-js/faker';
import { describe, expect, it } from 'vitest';
import {
	acceptInviteSchema,
	accountBusinessSchema,
	createItemSchema,
	inviteMemberSchema,
	loginSchema,
	paginationQuerySchema,
	registerSchema,
	signupSchema,
	updateItemSchema,
	updateMemberRoleSchema,
} from './schemas';

describe('registerSchema', () => {
	it('accepts a valid registration and normalizes the email and name', () => {
		const parsed = registerSchema.parse({
			email: '  Foo@Example.COM ',
			password: 'supersecret',
			name: '  Ada Lovelace  ',
		});
		expect(parsed.email).toBe('foo@example.com');
		expect(parsed.name).toBe('Ada Lovelace');
	});

	it('rejects an invalid email', () => {
		expect(() =>
			registerSchema.parse({ email: 'not-an-email', password: 'supersecret', name: 'A' }),
		).toThrow();
	});

	it('rejects a non-string email (preprocess passthrough)', () => {
		expect(() =>
			registerSchema.parse({ email: 12345, password: 'supersecret', name: 'A' }),
		).toThrow();
	});

	it('rejects a short password', () => {
		expect(() =>
			registerSchema.parse({ email: faker.internet.email(), password: 'short', name: 'A' }),
		).toThrow();
	});

	it('rejects a blank name', () => {
		expect(() =>
			registerSchema.parse({
				email: faker.internet.email(),
				password: 'supersecret',
				name: '   ',
			}),
		).toThrow();
	});
});

describe('loginSchema', () => {
	it('accepts valid credentials and lowercases the email', () => {
		const email = faker.internet.email();
		const parsed = loginSchema.parse({ email, password: 'supersecret' });
		expect(parsed.email).toBe(email.trim().toLowerCase());
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
	it('combines owner credentials with nested business info', () => {
		const parsed = signupSchema.parse({
			email: 'OWNER@Example.com',
			password: 'supersecret123',
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
				password: 'supersecret123',
				name: 'Marcus',
			}),
		).toThrow();
	});
});

describe('inviteMemberSchema', () => {
	it('accepts manager and team_member roles', () => {
		for (const role of ['manager', 'team_member'] as const) {
			expect(
				inviteMemberSchema.parse({ email: faker.internet.email(), name: 'Pat', role }).role,
			).toBe(role);
		}
	});

	it('rejects inviting someone as owner', () => {
		expect(() =>
			inviteMemberSchema.parse({ email: faker.internet.email(), name: 'Pat', role: 'owner' }),
		).toThrow();
	});
});

describe('acceptInviteSchema', () => {
	it('requires a token and a valid password', () => {
		expect(acceptInviteSchema.parse({ token: 'abc', password: 'supersecret123' })).toEqual({
			token: 'abc',
			password: 'supersecret123',
		});
		expect(() => acceptInviteSchema.parse({ token: '', password: 'supersecret123' })).toThrow();
		expect(() => acceptInviteSchema.parse({ token: 'abc', password: 'short' })).toThrow();
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
