import { faker } from '@faker-js/faker';
import { describe, expect, it } from 'vitest';
import {
	createItemSchema,
	loginSchema,
	paginationQuerySchema,
	registerSchema,
	updateItemSchema,
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
