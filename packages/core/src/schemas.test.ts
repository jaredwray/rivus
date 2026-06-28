import { faker } from '@faker-js/faker';
import { describe, expect, it } from 'vitest';
import {
	acceptInviteSchema,
	accountBusinessSchema,
	accountStatusSchema,
	createCustomerSchema,
	createFaqSchema,
	createItemSchema,
	createJobSchema,
	createNotificationSchema,
	inviteMemberSchema,
	jobConflictQuerySchema,
	jobListQuerySchema,
	jobStatusSchema,
	loginSchema,
	notificationReadStateSchema,
	notificationTypeSchema,
	paginationQuerySchema,
	signupSchema,
	updateAccountSchema,
	updateCustomerSchema,
	updateFaqSchema,
	updateItemSchema,
	updateJobSchema,
	updateMemberRoleSchema,
	verifyCodeSchema,
} from './schemas';

const FUTURE_ISO = '2026-06-24T21:00:00.000Z';

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

describe('createNotificationSchema', () => {
	it('applies defaults for type, body, and link', () => {
		expect(createNotificationSchema.parse({ title: 'Heads up' })).toEqual({
			type: 'system',
			title: 'Heads up',
			body: '',
			linkHref: '',
		});
	});

	it('keeps a supplied type, body, and link', () => {
		expect(
			createNotificationSchema.parse({
				type: 'job_assigned',
				title: 'New job',
				body: 'Water heater install',
				linkHref: '/schedule',
			}),
		).toMatchObject({ type: 'job_assigned', linkHref: '/schedule' });
	});

	it('requires a title', () => {
		const result = createNotificationSchema.safeParse({ body: 'orphan' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe('Title is required.');
	});

	it('rejects an unknown type', () => {
		expect(() => createNotificationSchema.parse({ title: 'x', type: 'spam' })).toThrow();
	});
});

describe('notificationReadStateSchema', () => {
	it('accepts the two read states', () => {
		expect(notificationReadStateSchema.parse('unread')).toBe('unread');
		expect(notificationReadStateSchema.parse('read')).toBe('read');
	});

	it('rejects anything else with a plain-language message', () => {
		const result = notificationReadStateSchema.safeParse('seen');
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe('Read state must be either unread or read.');
	});
});

describe('notificationTypeSchema', () => {
	it('rejects an unknown category', () => {
		expect(() => notificationTypeSchema.parse('promo')).toThrow();
	});
});

describe('createFaqSchema', () => {
	it('applies defaults for category and status', () => {
		expect(
			createFaqSchema.parse({ question: 'Do you offer free estimates?', answer: 'Yes, always.' }),
		).toMatchObject({ category: '', status: 'published' });
	});

	it('requires both a question and an answer', () => {
		expect(() => createFaqSchema.parse({ question: 'Anyone home?' })).toThrow();
		expect(() => createFaqSchema.parse({ answer: 'No question here.' })).toThrow();
	});

	it('prompts in plain language when the question is blank', () => {
		const result = createFaqSchema.safeParse({ question: '   ', answer: 'A' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe('Question is required.');
	});

	it('rejects an unknown status', () => {
		expect(() =>
			createFaqSchema.parse({ question: 'Q?', answer: 'A.', status: 'archived' }),
		).toThrow();
	});
});

describe('updateFaqSchema', () => {
	it('accepts a partial update', () => {
		expect(updateFaqSchema.parse({ status: 'draft' })).toEqual({ status: 'draft' });
	});

	it('rejects an empty update', () => {
		expect(() => updateFaqSchema.parse({})).toThrow();
	});
});

describe('createCustomerSchema', () => {
	it('applies defaults for every optional field', () => {
		expect(createCustomerSchema.parse({ name: 'Grace Kim' })).toEqual({
			name: 'Grace Kim',
			email: '',
			phone: '',
			address: '',
			lifetimeValue: 0,
			balance: 0,
			notes: '',
		});
	});

	it('accepts and normalizes a fully specified record', () => {
		const parsed = createCustomerSchema.parse({
			name: 'Priya Anand',
			email: '  Priya@Example.COM ',
			phone: '(206) 555-0119',
			address: 'Capitol Hill',
			lifetimeValue: 526_000,
			balance: 54_000,
			notes: 'Billing flag',
		});
		expect(parsed.email).toBe('priya@example.com');
		expect(parsed).toMatchObject({ balance: 54_000 });
	});

	it('rejects negative money', () => {
		expect(() => createCustomerSchema.parse({ name: 'X', balance: -1 })).toThrow();
	});

	it('rejects non-integer money', () => {
		expect(() => createCustomerSchema.parse({ name: 'X', lifetimeValue: 1.5 })).toThrow();
	});

	it('accepts a blank email but rejects a malformed one in plain language', () => {
		expect(createCustomerSchema.parse({ name: 'X', email: '' }).email).toBe('');
		const result = createCustomerSchema.safeParse({ name: 'X', email: 'not-an-email' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe('Enter a valid email address.');
	});
});

describe('updateCustomerSchema', () => {
	it('accepts a partial update of one field', () => {
		expect(updateCustomerSchema.parse({ balance: 5_000 })).toEqual({ balance: 5_000 });
	});

	it('rejects an empty update', () => {
		expect(() => updateCustomerSchema.parse({})).toThrow();
	});

	it('rejects a negative balance', () => {
		expect(() => updateCustomerSchema.parse({ balance: -5 })).toThrow();
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

describe('jobStatusSchema', () => {
	it('accepts every lifecycle state', () => {
		for (const status of ['scheduled', 'confirmed', 'in_progress', 'completed', 'canceled']) {
			expect(jobStatusSchema.parse(status)).toBe(status);
		}
	});

	it('rejects an unknown status', () => {
		const result = jobStatusSchema.safeParse('done');
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe('Choose a valid job status.');
	});
});

describe('createJobSchema', () => {
	it('fills defaults from just a title and start time', () => {
		expect(createJobSchema.parse({ title: 'Water heater install', startAt: FUTURE_ISO })).toEqual({
			title: 'Water heater install',
			customerId: '',
			assignedUserId: '',
			startAt: FUTURE_ISO,
			durationMinutes: 60,
			status: 'scheduled',
			address: '',
			notes: '',
			estimatedValue: 0,
		});
	});

	it('accepts a full job record', () => {
		const parsed = createJobSchema.parse({
			title: 'Drain cleaning',
			customerId: 'cust_1',
			assignedUserId: 'user_1',
			startAt: FUTURE_ISO,
			durationMinutes: 90,
			status: 'confirmed',
			address: 'Queen Anne, Seattle',
			notes: 'Bring the auger',
			estimatedValue: 18_000,
		});
		expect(parsed).toMatchObject({
			title: 'Drain cleaning',
			customerId: 'cust_1',
			assignedUserId: 'user_1',
			durationMinutes: 90,
			status: 'confirmed',
			estimatedValue: 18_000,
		});
	});

	it('requires a title', () => {
		const result = createJobSchema.safeParse({ startAt: FUTURE_ISO });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe('Service is required.');
	});

	it('requires a start time', () => {
		expect(() => createJobSchema.parse({ title: 'No when' })).toThrow();
	});

	it('rejects a non-UTC or malformed start time', () => {
		for (const startAt of ['2026-06-24T21:00:00+02:00', 'tomorrow', '']) {
			expect(createJobSchema.safeParse({ title: 'X', startAt }).success).toBe(false);
		}
	});

	it('rejects a fractional, zero, or too-long duration', () => {
		for (const durationMinutes of [1.5, 0, 1441]) {
			expect(
				createJobSchema.safeParse({ title: 'X', startAt: FUTURE_ISO, durationMinutes }).success,
			).toBe(false);
		}
	});

	it('rejects a negative estimated value', () => {
		expect(
			createJobSchema.safeParse({ title: 'X', startAt: FUTURE_ISO, estimatedValue: -1 }).success,
		).toBe(false);
	});

	it('rejects an invalid status', () => {
		expect(
			createJobSchema.safeParse({ title: 'X', startAt: FUTURE_ISO, status: 'pending' }).success,
		).toBe(false);
	});
});

describe('updateJobSchema', () => {
	it('accepts a partial update of one field', () => {
		expect(updateJobSchema.parse({ status: 'completed' })).toEqual({ status: 'completed' });
	});

	it('accepts rescheduling by start time alone', () => {
		expect(updateJobSchema.parse({ startAt: FUTURE_ISO })).toEqual({ startAt: FUTURE_ISO });
	});

	it('rejects an empty update', () => {
		expect(() => updateJobSchema.parse({})).toThrow();
	});

	it('rejects an invalid field even within a partial update', () => {
		expect(updateJobSchema.safeParse({ durationMinutes: 0 }).success).toBe(false);
	});
});

describe('jobListQuerySchema', () => {
	it('applies pagination defaults and omits absent filters', () => {
		expect(jobListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
	});

	it('coerces pagination and keeps the supplied filters', () => {
		const parsed = jobListQuerySchema.parse({
			page: '2',
			pageSize: '50',
			from: '2026-06-22T00:00:00.000Z',
			to: '2026-06-29T00:00:00.000Z',
			assignedUserId: 'user_1',
			status: 'scheduled',
			customerId: 'cust_1',
		});
		expect(parsed).toMatchObject({
			page: 2,
			pageSize: 50,
			from: '2026-06-22T00:00:00.000Z',
			assignedUserId: 'user_1',
			status: 'scheduled',
		});
	});

	it('rejects a malformed date bound', () => {
		expect(jobListQuerySchema.safeParse({ from: 'last week' }).success).toBe(false);
	});
});

describe('jobConflictQuerySchema', () => {
	it('requires an assignee', () => {
		const result = jobConflictQuerySchema.safeParse({ startAt: FUTURE_ISO });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe('Assignee is required.');
	});

	it('requires a start time', () => {
		expect(jobConflictQuerySchema.safeParse({ assignedUserId: 'user_1' }).success).toBe(false);
	});

	it('coerces the duration from its string form and defaults it', () => {
		expect(
			jobConflictQuerySchema.parse({
				assignedUserId: 'user_1',
				startAt: FUTURE_ISO,
				durationMinutes: '90',
			}),
		).toMatchObject({ durationMinutes: 90 });
		expect(
			jobConflictQuerySchema.parse({ assignedUserId: 'user_1', startAt: FUTURE_ISO }),
		).toMatchObject({ durationMinutes: 60 });
	});

	it('carries an optional excludeJobId', () => {
		const parsed = jobConflictQuerySchema.parse({
			assignedUserId: 'user_1',
			startAt: FUTURE_ISO,
			excludeJobId: 'job_1',
		});
		expect(parsed.excludeJobId).toBe('job_1');
	});
});
