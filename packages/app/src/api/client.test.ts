import { faker } from '@faker-js/faker';
import type { AccountId, CustomerId, FaqId, JobId } from '@rivus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, ValidationError } from './client';

/** Build a `Response`-like object the client's `text()`/`ok` logic understands. */
function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
	const status = init.status ?? 200;
	return {
		ok: status >= 200 && status < 300,
		status,
		text: async () => (body === undefined ? '' : JSON.stringify(body)),
	} as Response;
}

const BASE = 'http://api.test';

function makeUser() {
	const now = new Date().toISOString();
	return {
		id: faker.string.uuid(),
		email: faker.internet.email().toLowerCase(),
		name: faker.person.fullName(),
		createdAt: now,
		updatedAt: now,
	};
}

function makeAccount() {
	const now = new Date().toISOString();
	return {
		id: faker.string.uuid(),
		name: faker.company.name(),
		slug: faker.lorem.slug(),
		phone: '',
		address: '',
		website: '',
		timezone: 'UTC',
		status: 'active' as const,
		canceledAt: null,
		createdAt: now,
		updatedAt: now,
	};
}

function makeAuthResponse(role: 'owner' | 'manager' | 'member' = 'owner') {
	return { token: faker.string.alphanumeric(40), user: makeUser(), account: makeAccount(), role };
}

function makeCodeSent(email: string) {
	return { status: 'code_sent' as const, email };
}

function makeItem() {
	const now = new Date().toISOString();
	return {
		id: faker.string.uuid(),
		accountId: faker.string.uuid(),
		name: faker.commerce.productName(),
		description: faker.commerce.productDescription(),
		status: 'active' as const,
		createdAt: now,
		updatedAt: now,
	};
}

function makeFaq() {
	const now = new Date().toISOString();
	return {
		id: faker.string.uuid(),
		accountId: faker.string.uuid(),
		question: `${faker.lorem.sentence().replace(/\.$/, '')}?`,
		answer: faker.lorem.paragraph(),
		category: faker.helpers.arrayElement(['Pricing', 'Scheduling', '']),
		status: 'published' as const,
		createdAt: now,
		updatedAt: now,
	};
}

function makeCustomer() {
	const now = new Date().toISOString();
	return {
		id: faker.string.uuid(),
		accountId: faker.string.uuid(),
		name: faker.person.fullName(),
		email: faker.internet.email().toLowerCase(),
		phone: faker.phone.number(),
		address: faker.location.streetAddress(),
		lifetimeValue: faker.number.int({ min: 0, max: 1_000_000 }),
		balance: faker.number.int({ min: 0, max: 100_000 }),
		notes: faker.lorem.sentence(),
		createdAt: now,
		updatedAt: now,
	};
}

function makeJob() {
	const now = new Date().toISOString();
	return {
		id: faker.string.uuid(),
		accountId: faker.string.uuid(),
		customerId: faker.string.uuid(),
		assignedUserId: faker.string.uuid(),
		title: faker.helpers.arrayElement([
			'Water heater install',
			'Drain cleaning',
			'Leak inspection',
		]),
		status: 'scheduled' as const,
		startAt: '2026-06-24T17:00:00.000Z',
		durationMinutes: 60,
		address: faker.location.streetAddress(),
		notes: faker.lorem.sentence(),
		estimatedValue: faker.number.int({ min: 0, max: 500_000 }),
		createdAt: now,
		updatedAt: now,
	};
}

function jobPage(jobs: ReturnType<typeof makeJob>[]) {
	return {
		data: jobs,
		meta: {
			page: 1,
			pageSize: 20,
			total: jobs.length,
			totalPages: 1,
			hasNextPage: false,
			hasPreviousPage: false,
		},
	};
}

describe('createApiClient', () => {
	let fetchMock: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

	beforeEach(() => {
		fetchMock = vi.fn<typeof globalThis.fetch>();
	});

	it('exposes a normalized base URL (no trailing slash)', () => {
		const client = createApiClient(`${BASE}///`, fetchMock);
		expect(client.baseUrl).toBe(BASE);
	});

	describe('health', () => {
		it('returns the parsed health payload when the API is up', async () => {
			const payload = { status: 'ok', uptime: 12.5, timestamp: new Date().toISOString() };
			fetchMock.mockResolvedValueOnce(jsonResponse(payload));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.health();

			expect(result).toEqual(payload);
			expect(fetchMock).toHaveBeenCalledWith(`${BASE}/health`, { method: 'GET' });
		});

		it('throws an ApiError when the service is unavailable', async () => {
			fetchMock.mockResolvedValueOnce(
				jsonResponse(
					{ error: 'ServiceUnavailable', message: 'down for maintenance', statusCode: 503 },
					{ status: 503 },
				),
			);

			const client = createApiClient(BASE, fetchMock);
			const error = await client.health().catch((e) => e);
			expect(error).toBeInstanceOf(ApiError);
			expect(error).toMatchObject({ status: 503, message: 'down for maintenance' });
		});
	});

	describe('signup', () => {
		it('begins signup and returns the code-sent acknowledgement', async () => {
			const email = faker.internet.email().toLowerCase();
			fetchMock.mockResolvedValueOnce(jsonResponse(makeCodeSent(email), { status: 202 }));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.signup({
				email,
				name: 'Marcus Thompson',
				business: { businessName: 'Cascade Plumbing' },
			});

			expect(result).toEqual({ status: 'code_sent', email });
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/auth/signup`);
			expect(init.method).toBe('POST');
			const body = JSON.parse(init.body as string);
			expect(body.business.businessName).toBe('Cascade Plumbing');
			expect(body).not.toHaveProperty('password');
		});

		it('rejects locally-invalid signup input before hitting the network', async () => {
			const client = createApiClient(BASE, fetchMock);
			await expect(
				client.signup({
					email: 'not-an-email',
					name: 'X',
					business: { businessName: '' },
				}),
			).rejects.toThrow();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('surfaces a friendly ValidationError for a bad field, not a raw JSON dump', async () => {
			const client = createApiClient(BASE, fetchMock);
			const error = await client
				.signup({
					email: 'owner@business.com',
					name: 'Marcus Thompson',
					business: { businessName: 'Acme', website: 'not a url' },
				})
				.catch((caught) => caught);

			expect(error).toBeInstanceOf(ValidationError);
			expect(error.message).toBe('Enter a valid website URL, like https://example.com.');
			// Regression: the old path let `ZodError.message` — a pretty-printed JSON
			// array — land in the UI verbatim. A friendly message is a single line.
			expect(error.message).not.toContain('[');
			expect(error.issues[0]?.path).toEqual(['business', 'website']);
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('login', () => {
		it('requests a code and returns the acknowledgement', async () => {
			const email = faker.internet.email().toLowerCase();
			fetchMock.mockResolvedValueOnce(jsonResponse(makeCodeSent(email), { status: 202 }));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.login({ email });

			expect(result).toEqual({ status: 'code_sent', email });
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/auth/login`);
			expect(init.method).toBe('POST');
			expect(JSON.parse(init.body as string)).toEqual({ email });
		});

		it('falls back to a generic message when the error body has none', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(undefined, { status: 500 }));

			const client = createApiClient(BASE, fetchMock);
			const error = await client.login({ email: 'a@b.com' }).catch((e) => e);

			expect(error).toBeInstanceOf(ApiError);
			expect(error.status).toBe(500);
			expect(error.message).toContain('failed with status 500');
		});

		it('rejects locally-invalid input before hitting the network', async () => {
			const client = createApiClient(BASE, fetchMock);
			await expect(client.login({ email: 'not-an-email' })).rejects.toThrow();
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('verifyCode', () => {
		it('exchanges a code for the session', async () => {
			const response = makeAuthResponse('owner');
			fetchMock.mockResolvedValueOnce(jsonResponse(response, { status: 200 }));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.verifyCode({ email: response.user.email, code: '123456' });

			expect(result).toEqual(response);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/auth/verify`);
			expect(JSON.parse(init.body as string)).toEqual({
				email: response.user.email,
				code: '123456',
			});
		});

		it('throws a clear ApiError on an invalid code (401)', async () => {
			fetchMock.mockResolvedValueOnce(
				jsonResponse(
					{ error: 'Unauthorized', message: 'Invalid or expired code', statusCode: 401 },
					{ status: 401 },
				),
			);

			const client = createApiClient(BASE, fetchMock);
			const error = await client.verifyCode({ email: 'a@b.com', code: '000000' }).catch((e) => e);

			expect(error).toBeInstanceOf(ApiError);
			expect(error.status).toBe(401);
			expect(error.message).toBe('Invalid or expired code');
		});

		it('rejects a malformed code before hitting the network', async () => {
			const client = createApiClient(BASE, fetchMock);
			await expect(client.verifyCode({ email: 'a@b.com', code: '12' })).rejects.toThrow();
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('acceptInvite', () => {
		it('joins an account with just the token and returns the session', async () => {
			const response = makeAuthResponse('member');
			fetchMock.mockResolvedValueOnce(jsonResponse(response, { status: 201 }));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.acceptInvite({ token: 'invite-tok' });

			expect(result).toEqual(response);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/auth/accept-invite`);
			const body = JSON.parse(init.body as string);
			expect(body.token).toBe('invite-tok');
			expect(body).not.toHaveProperty('password');
		});
	});

	describe('me', () => {
		it('returns the current session and sends the bearer token', async () => {
			const session = { user: makeUser(), account: makeAccount(), role: 'owner' as const };
			fetchMock.mockResolvedValueOnce(jsonResponse(session));

			const client = createApiClient(BASE, fetchMock);
			const token = faker.string.alphanumeric(32);
			const result = await client.me(token);

			expect(result).toEqual(session);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/auth/me`);
			expect(init.headers).toMatchObject({ Authorization: `Bearer ${token}` });
		});
	});

	describe('listMembers', () => {
		it('returns members and pending invites with the bearer token', async () => {
			const now = new Date().toISOString();
			const payload = {
				members: [
					{
						userId: faker.string.uuid(),
						email: faker.internet.email().toLowerCase(),
						name: faker.person.fullName(),
						role: 'owner' as const,
						joinedAt: now,
					},
				],
				invites: [],
			};
			fetchMock.mockResolvedValueOnce(jsonResponse(payload));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.listMembers('tok');

			expect(result.members).toHaveLength(1);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/members`);
			expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
		});
	});

	describe('inviteMember', () => {
		it('posts an invite with the bearer token', async () => {
			const now = new Date().toISOString();
			const invite = {
				id: faker.string.uuid(),
				email: 'newhire@example.com',
				name: 'New Hire',
				role: 'member' as const,
				status: 'pending' as const,
				token: 'invite-token',
				createdAt: now,
			};
			fetchMock.mockResolvedValueOnce(jsonResponse(invite, { status: 201 }));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.inviteMember('owner-token', {
				email: invite.email,
				name: invite.name,
				role: 'member',
			});

			expect(result).toEqual(invite);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/members/invites`);
			expect(init.headers).toMatchObject({
				Authorization: 'Bearer owner-token',
				'Content-Type': 'application/json',
			});
		});

		it('rejects an invalid invite before hitting the network', async () => {
			const client = createApiClient(BASE, fetchMock);
			await expect(
				client.inviteMember('tok', { email: 'not-an-email', name: 'X', role: 'member' }),
			).rejects.toThrow();
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('updateAccount', () => {
		it('PATCHes the account with the bearer token and returns it', async () => {
			const account = makeAccount();
			fetchMock.mockResolvedValueOnce(jsonResponse({ ...account, name: 'Renamed Co' }));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.updateAccount('owner-token', { businessName: 'Renamed Co' });

			expect(result.name).toBe('Renamed Co');
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/account`);
			expect(init.method).toBe('PATCH');
			expect(JSON.parse(init.body as string)).toEqual({ businessName: 'Renamed Co' });
			expect(init.headers).toMatchObject({ Authorization: 'Bearer owner-token' });
		});

		it('rejects an empty update before hitting the network', async () => {
			const client = createApiClient(BASE, fetchMock);
			await expect(client.updateAccount('tok', {})).rejects.toThrow();
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('cancelAccount', () => {
		it('POSTs to the cancel endpoint and returns the canceled account', async () => {
			const account = {
				...makeAccount(),
				status: 'canceled' as const,
				canceledAt: new Date().toISOString(),
			};
			fetchMock.mockResolvedValueOnce(jsonResponse(account));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.cancelAccount('owner-token');

			expect(result.status).toBe('canceled');
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/account/cancel`);
			expect(init.method).toBe('POST');
			expect(init.headers).toMatchObject({ Authorization: 'Bearer owner-token' });
		});
	});

	describe('getBilling', () => {
		it('GETs the billing summary with the bearer token', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ plan: 'free', status: 'active', seats: 3 }));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.getBilling('owner-token');

			expect(result).toEqual({ plan: 'free', status: 'active', seats: 3 });
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/billing`);
			expect(init.headers).toMatchObject({ Authorization: 'Bearer owner-token' });
		});
	});

	describe('listItems', () => {
		it('returns parsed items and sends the bearer auth header', async () => {
			const items = [makeItem(), makeItem()];
			const response = {
				data: items,
				meta: {
					page: 1,
					pageSize: 20,
					total: items.length,
					totalPages: 1,
					hasNextPage: false,
					hasPreviousPage: false,
				},
			};
			fetchMock.mockResolvedValueOnce(jsonResponse(response));

			const client = createApiClient(BASE, fetchMock);
			const token = faker.string.alphanumeric(32);
			const result = await client.listItems(token);

			expect(result.data).toEqual(items);
			expect(result.meta.total).toBe(items.length);

			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/items?page=1&pageSize=20`);
			expect(init.headers).toMatchObject({ Authorization: `Bearer ${token}` });
		});

		it('forwards custom pagination query params', async () => {
			const response = {
				data: [],
				meta: {
					page: 3,
					pageSize: 50,
					total: 0,
					totalPages: 0,
					hasNextPage: false,
					hasPreviousPage: false,
				},
			};
			fetchMock.mockResolvedValueOnce(jsonResponse(response));

			const client = createApiClient(BASE, fetchMock);
			await client.listItems('token', { page: 3, pageSize: 50 });

			const [url] = fetchMock.mock.calls[0] as [string];
			expect(url).toBe(`${BASE}/v1/items?page=3&pageSize=50`);
		});

		it('handles an empty result set', async () => {
			const response = {
				data: [],
				meta: {
					page: 1,
					pageSize: 20,
					total: 0,
					totalPages: 0,
					hasNextPage: false,
					hasPreviousPage: false,
				},
			};
			fetchMock.mockResolvedValueOnce(jsonResponse(response));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.listItems('token');
			expect(result.data).toEqual([]);
		});
	});

	describe('listFaqs', () => {
		it('returns parsed FAQs and sends the bearer auth header', async () => {
			const faqs = [makeFaq(), makeFaq()];
			const response = {
				data: faqs,
				meta: {
					page: 1,
					pageSize: 20,
					total: faqs.length,
					totalPages: 1,
					hasNextPage: false,
					hasPreviousPage: false,
				},
			};
			fetchMock.mockResolvedValueOnce(jsonResponse(response));

			const client = createApiClient(BASE, fetchMock);
			const token = faker.string.alphanumeric(32);
			const result = await client.listFaqs(token);

			expect(result.data).toEqual(faqs);
			expect(result.meta.total).toBe(faqs.length);

			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/faqs?page=1&pageSize=20`);
			expect(init.headers).toMatchObject({ Authorization: `Bearer ${token}` });
		});

		it('forwards custom pagination query params', async () => {
			const response = {
				data: [],
				meta: {
					page: 2,
					pageSize: 100,
					total: 0,
					totalPages: 0,
					hasNextPage: false,
					hasPreviousPage: false,
				},
			};
			fetchMock.mockResolvedValueOnce(jsonResponse(response));

			const client = createApiClient(BASE, fetchMock);
			await client.listFaqs('token', { page: 2, pageSize: 100 });

			const [url] = fetchMock.mock.calls[0] as [string];
			expect(url).toBe(`${BASE}/v1/faqs?page=2&pageSize=100`);
		});
	});

	describe('createFaq', () => {
		it('posts an FAQ with the bearer token and returns it', async () => {
			const faq = makeFaq();
			fetchMock.mockResolvedValueOnce(jsonResponse(faq, { status: 201 }));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.createFaq('owner-token', {
				question: faq.question,
				answer: faq.answer,
				category: faq.category,
				status: 'published',
			});

			expect(result).toEqual(faq);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/faqs`);
			expect(init.method).toBe('POST');
			expect(init.headers).toMatchObject({
				Authorization: 'Bearer owner-token',
				'Content-Type': 'application/json',
			});
			expect(JSON.parse(init.body as string)).toMatchObject({
				question: faq.question,
				answer: faq.answer,
			});
		});

		it('rejects an FAQ with no question/answer before hitting the network', async () => {
			const client = createApiClient(BASE, fetchMock);
			await expect(
				client.createFaq('tok', { question: '', answer: '', category: '', status: 'published' }),
			).rejects.toThrow();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('accepts just a question and answer, filling category/status defaults', async () => {
			const faq = makeFaq();
			fetchMock.mockResolvedValueOnce(jsonResponse(faq, { status: 201 }));

			const client = createApiClient(BASE, fetchMock);
			// category/status omitted — the schema defaults them, so the client must not
			// require them at the type level and must send the defaulted values.
			await client.createFaq('tok', { question: faq.question, answer: faq.answer });

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(JSON.parse(init.body as string)).toMatchObject({
				question: faq.question,
				answer: faq.answer,
				category: '',
				status: 'published',
			});
		});
	});

	describe('findSimilarFaq', () => {
		it('posts the question and returns the parsed match + merged suggestion', async () => {
			const match = makeFaq();
			fetchMock.mockResolvedValueOnce(
				jsonResponse({
					match,
					reason: 'Same pricing question.',
					merged: { question: 'Merged?', answer: 'Merged answer.' },
				}),
			);

			const client = createApiClient(BASE, fetchMock);
			const result = await client.findSimilarFaq('owner-token', {
				question: 'What does a call cost?',
				answer: 'It is $89.',
			});

			expect(result.match).toEqual(match);
			expect(result.reason).toBe('Same pricing question.');
			expect(result.merged).toEqual({ question: 'Merged?', answer: 'Merged answer.' });
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/faqs/similar`);
			expect(init.method).toBe('POST');
			expect(init.headers).toMatchObject({
				Authorization: 'Bearer owner-token',
				'Content-Type': 'application/json',
			});
			expect(JSON.parse(init.body as string)).toMatchObject({ question: 'What does a call cost?' });
		});

		it('parses a "no duplicate" response', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ match: null, reason: '', merged: null }));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.findSimilarFaq('tok', { question: 'Anything new?' });

			expect(result.match).toBeNull();
			expect(result.merged).toBeNull();
		});

		it('defaults a missing answer to an empty string', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ match: null, reason: '', merged: null }));

			const client = createApiClient(BASE, fetchMock);
			await client.findSimilarFaq('tok', { question: 'Just a question?' });

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(JSON.parse(init.body as string)).toMatchObject({
				question: 'Just a question?',
				answer: '',
			});
		});

		it('rejects an empty question before hitting the network', async () => {
			const client = createApiClient(BASE, fetchMock);
			await expect(client.findSimilarFaq('tok', { question: '' })).rejects.toThrow();
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('updateFaq', () => {
		it('PATCHes the FAQ with the bearer token and returns it', async () => {
			const faq = { ...makeFaq(), status: 'draft' as const };
			fetchMock.mockResolvedValueOnce(jsonResponse(faq));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.updateFaq('owner-token', faq.id as FaqId, { status: 'draft' });

			expect(result.status).toBe('draft');
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/faqs/${faq.id}`);
			expect(init.method).toBe('PATCH');
			expect(JSON.parse(init.body as string)).toEqual({ status: 'draft' });
			expect(init.headers).toMatchObject({ Authorization: 'Bearer owner-token' });
		});

		it('url-encodes the FAQ id', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(makeFaq()));

			const client = createApiClient(BASE, fetchMock);
			await client.updateFaq('tok', 'a/b c' as FaqId, { category: 'Pricing' });

			const [url] = fetchMock.mock.calls[0] as [string];
			expect(url).toBe(`${BASE}/v1/faqs/a%2Fb%20c`);
		});

		it('rejects an empty update before hitting the network', async () => {
			const client = createApiClient(BASE, fetchMock);
			await expect(client.updateFaq('tok', 'id' as FaqId, {})).rejects.toThrow();
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('deleteFaq', () => {
		it('DELETEs the FAQ with the bearer token and resolves on 204', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(undefined, { status: 204 }));

			const client = createApiClient(BASE, fetchMock);
			await expect(client.deleteFaq('owner-token', 'faq-1' as FaqId)).resolves.toBeUndefined();

			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/faqs/faq-1`);
			expect(init.method).toBe('DELETE');
			expect(init.headers).toMatchObject({ Authorization: 'Bearer owner-token' });
		});

		it('throws an ApiError when the FAQ is gone (404)', async () => {
			fetchMock.mockResolvedValueOnce(
				jsonResponse(
					{ error: 'Not Found', message: 'FAQ not found', statusCode: 404 },
					{ status: 404 },
				),
			);

			const client = createApiClient(BASE, fetchMock);
			const error = await client.deleteFaq('tok', 'missing' as never).catch((e) => e);
			expect(error).toBeInstanceOf(ApiError);
			expect(error.status).toBe(404);
		});
	});

	describe('listCustomers', () => {
		it('returns parsed customers and sends the bearer auth header', async () => {
			const customers = [makeCustomer(), makeCustomer()];
			const response = {
				data: customers,
				meta: {
					page: 1,
					pageSize: 20,
					total: customers.length,
					totalPages: 1,
					hasNextPage: false,
					hasPreviousPage: false,
				},
			};
			fetchMock.mockResolvedValueOnce(jsonResponse(response));

			const client = createApiClient(BASE, fetchMock);
			const token = faker.string.alphanumeric(32);
			const result = await client.listCustomers(token);

			expect(result.data).toEqual(customers);
			expect(result.meta.total).toBe(customers.length);

			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/customers?page=1&pageSize=20`);
			expect(init.headers).toMatchObject({ Authorization: `Bearer ${token}` });
		});

		it('forwards custom pagination query params', async () => {
			const response = {
				data: [],
				meta: {
					page: 2,
					pageSize: 100,
					total: 0,
					totalPages: 0,
					hasNextPage: false,
					hasPreviousPage: false,
				},
			};
			fetchMock.mockResolvedValueOnce(jsonResponse(response));

			const client = createApiClient(BASE, fetchMock);
			await client.listCustomers('token', { page: 2, pageSize: 100 });

			const [url] = fetchMock.mock.calls[0] as [string];
			expect(url).toBe(`${BASE}/v1/customers?page=2&pageSize=100`);
		});
	});

	describe('createCustomer', () => {
		it('posts a customer with the bearer token and returns it', async () => {
			const customer = makeCustomer();
			fetchMock.mockResolvedValueOnce(jsonResponse(customer, { status: 201 }));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.createCustomer('owner-token', {
				name: customer.name,
				email: customer.email,
				lifetimeValue: customer.lifetimeValue,
				balance: customer.balance,
			});

			expect(result).toEqual(customer);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/customers`);
			expect(init.method).toBe('POST');
			expect(init.headers).toMatchObject({
				Authorization: 'Bearer owner-token',
				'Content-Type': 'application/json',
			});
			expect(JSON.parse(init.body as string)).toMatchObject({ name: customer.name });
		});

		it('accepts just a name, filling every other default', async () => {
			const customer = makeCustomer();
			fetchMock.mockResolvedValueOnce(jsonResponse(customer, { status: 201 }));

			const client = createApiClient(BASE, fetchMock);
			// Only `name` is supplied — the schema defaults the rest, so the client must
			// not require them at the type level and must send the defaulted values.
			await client.createCustomer('tok', { name: 'Grace Kim' });

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(JSON.parse(init.body as string)).toMatchObject({
				name: 'Grace Kim',
				email: '',
				phone: '',
				address: '',
				lifetimeValue: 0,
				balance: 0,
				notes: '',
			});
		});

		it('rejects a customer with no name before hitting the network', async () => {
			const client = createApiClient(BASE, fetchMock);
			await expect(client.createCustomer('tok', { name: '' })).rejects.toThrow(ValidationError);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('rejects a negative balance before hitting the network', async () => {
			const client = createApiClient(BASE, fetchMock);
			await expect(client.createCustomer('tok', { name: 'Bad', balance: -1 })).rejects.toThrow(
				ValidationError,
			);
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('getCustomer', () => {
		it('fetches a customer by id and url-encodes it', async () => {
			const customer = makeCustomer();
			fetchMock.mockResolvedValueOnce(jsonResponse(customer));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.getCustomer('tok', 'a/b c' as CustomerId);

			expect(result).toEqual(customer);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/customers/a%2Fb%20c`);
			expect(init.method).toBe('GET');
			expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
		});
	});

	describe('updateCustomer', () => {
		it('PATCHes the customer with the bearer token and returns it', async () => {
			const customer = { ...makeCustomer(), balance: 12_500 };
			fetchMock.mockResolvedValueOnce(jsonResponse(customer));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.updateCustomer('owner-token', customer.id as CustomerId, {
				balance: 12_500,
			});

			expect(result.balance).toBe(12_500);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/customers/${customer.id}`);
			expect(init.method).toBe('PATCH');
			expect(JSON.parse(init.body as string)).toEqual({ balance: 12_500 });
			expect(init.headers).toMatchObject({ Authorization: 'Bearer owner-token' });
		});

		it('rejects an empty update before hitting the network', async () => {
			const client = createApiClient(BASE, fetchMock);
			await expect(client.updateCustomer('tok', 'id' as CustomerId, {})).rejects.toThrow();
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('deleteCustomer', () => {
		it('DELETEs the customer with the bearer token and resolves on 204', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(undefined, { status: 204 }));

			const client = createApiClient(BASE, fetchMock);
			await expect(
				client.deleteCustomer('owner-token', 'cust-1' as CustomerId),
			).resolves.toBeUndefined();

			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/customers/cust-1`);
			expect(init.method).toBe('DELETE');
			expect(init.headers).toMatchObject({ Authorization: 'Bearer owner-token' });
		});

		it('throws an ApiError when the customer is gone (404)', async () => {
			fetchMock.mockResolvedValueOnce(
				jsonResponse(
					{ error: 'Not Found', message: 'Customer not found', statusCode: 404 },
					{ status: 404 },
				),
			);

			const client = createApiClient(BASE, fetchMock);
			const error = await client.deleteCustomer('tok', 'missing' as CustomerId).catch((e) => e);
			expect(error).toBeInstanceOf(ApiError);
			expect(error.status).toBe(404);
		});
	});

	describe('listJobs', () => {
		it('returns parsed jobs and sends the bearer auth header (no filters)', async () => {
			const jobs = [makeJob(), makeJob()];
			fetchMock.mockResolvedValueOnce(jsonResponse(jobPage(jobs)));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.listJobs('tok');

			expect(result.data).toEqual(jobs);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/jobs?page=1&pageSize=20`);
			expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
		});

		it('appends every supplied calendar filter to the query', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(jobPage([])));

			const client = createApiClient(BASE, fetchMock);
			await client.listJobs('tok', {
				page: 2,
				pageSize: 100,
				from: '2026-06-22T00:00:00.000Z',
				to: '2026-06-29T00:00:00.000Z',
				assignedUserId: 'user-1',
				status: 'confirmed',
				customerId: 'cust-1',
			});

			const [url] = fetchMock.mock.calls[0] as [string];
			const params = new URL(url).searchParams;
			expect(params.get('page')).toBe('2');
			expect(params.get('pageSize')).toBe('100');
			expect(params.get('from')).toBe('2026-06-22T00:00:00.000Z');
			expect(params.get('to')).toBe('2026-06-29T00:00:00.000Z');
			expect(params.get('assignedUserId')).toBe('user-1');
			expect(params.get('status')).toBe('confirmed');
			expect(params.get('customerId')).toBe('cust-1');
		});

		it('rejects a malformed date filter before hitting the network', async () => {
			const client = createApiClient(BASE, fetchMock);
			await expect(client.listJobs('tok', { from: 'whenever' })).rejects.toThrow(ValidationError);
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('createJob', () => {
		it('posts a job and returns it', async () => {
			const job = makeJob();
			fetchMock.mockResolvedValueOnce(jsonResponse(job, { status: 201 }));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.createJob('owner-token', {
				title: job.title,
				startAt: job.startAt,
				customerId: job.customerId,
				estimatedValue: job.estimatedValue,
			});

			expect(result).toEqual(job);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/jobs`);
			expect(init.method).toBe('POST');
			expect(init.headers).toMatchObject({
				Authorization: 'Bearer owner-token',
				'Content-Type': 'application/json',
			});
			expect(JSON.parse(init.body as string)).toMatchObject({ title: job.title });
		});

		it('accepts just a title and start time, filling every other default', async () => {
			const job = makeJob();
			fetchMock.mockResolvedValueOnce(jsonResponse(job, { status: 201 }));

			const client = createApiClient(BASE, fetchMock);
			await client.createJob('tok', { title: 'Faucet', startAt: '2026-06-24T17:00:00.000Z' });

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(JSON.parse(init.body as string)).toMatchObject({
				title: 'Faucet',
				customerId: '',
				assignedUserId: '',
				durationMinutes: 60,
				status: 'scheduled',
				estimatedValue: 0,
			});
		});

		it('rejects a job with no title before hitting the network', async () => {
			const client = createApiClient(BASE, fetchMock);
			await expect(
				client.createJob('tok', { title: '', startAt: '2026-06-24T17:00:00.000Z' }),
			).rejects.toThrow(ValidationError);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('rejects a non-UTC start time before hitting the network', async () => {
			const client = createApiClient(BASE, fetchMock);
			await expect(
				client.createJob('tok', { title: 'X', startAt: '2026-06-24T17:00:00+02:00' }),
			).rejects.toThrow(ValidationError);
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('getJob', () => {
		it('fetches a job by id and url-encodes it', async () => {
			const job = makeJob();
			fetchMock.mockResolvedValueOnce(jsonResponse(job));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.getJob('tok', 'a/b c' as JobId);

			expect(result).toEqual(job);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/jobs/a%2Fb%20c`);
			expect(init.method).toBe('GET');
		});
	});

	describe('updateJob', () => {
		it('PATCHes the job (e.g. a reschedule) and returns it', async () => {
			const job = { ...makeJob(), startAt: '2026-06-25T18:00:00.000Z' };
			fetchMock.mockResolvedValueOnce(jsonResponse(job));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.updateJob('owner-token', job.id as JobId, {
				startAt: '2026-06-25T18:00:00.000Z',
				status: 'confirmed',
			});

			expect(result.startAt).toBe('2026-06-25T18:00:00.000Z');
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/jobs/${job.id}`);
			expect(init.method).toBe('PATCH');
			expect(JSON.parse(init.body as string)).toEqual({
				startAt: '2026-06-25T18:00:00.000Z',
				status: 'confirmed',
			});
		});

		it('rejects an empty update before hitting the network', async () => {
			const client = createApiClient(BASE, fetchMock);
			await expect(client.updateJob('tok', 'id' as JobId, {})).rejects.toThrow();
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('deleteJob', () => {
		it('DELETEs the job and resolves on 204', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(undefined, { status: 204 }));

			const client = createApiClient(BASE, fetchMock);
			await expect(client.deleteJob('owner-token', 'job-1' as JobId)).resolves.toBeUndefined();

			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/jobs/job-1`);
			expect(init.method).toBe('DELETE');
		});
	});

	describe('getJobConflicts', () => {
		it('builds the conflict query and returns overlapping jobs', async () => {
			const overlap = makeJob();
			fetchMock.mockResolvedValueOnce(jsonResponse({ conflicts: [overlap] }));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.getJobConflicts('tok', {
				assignedUserId: 'user-1',
				startAt: '2026-06-24T17:00:00.000Z',
				durationMinutes: 90,
				excludeJobId: 'job-9',
			});

			expect(result.conflicts).toEqual([overlap]);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			const params = new URL(url).searchParams;
			expect(params.get('assignedUserId')).toBe('user-1');
			expect(params.get('startAt')).toBe('2026-06-24T17:00:00.000Z');
			expect(params.get('durationMinutes')).toBe('90');
			expect(params.get('excludeJobId')).toBe('job-9');
			expect(init.method).toBe('GET');
			expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
		});

		it('defaults the duration and omits excludeJobId when absent', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ conflicts: [] }));

			const client = createApiClient(BASE, fetchMock);
			await client.getJobConflicts('tok', {
				assignedUserId: 'user-1',
				startAt: '2026-06-24T17:00:00.000Z',
			});

			const [url] = fetchMock.mock.calls[0] as [string];
			const params = new URL(url).searchParams;
			expect(params.get('durationMinutes')).toBe('60');
			expect(params.has('excludeJobId')).toBe(false);
		});

		it('rejects a conflict check with no assignee before hitting the network', async () => {
			const client = createApiClient(BASE, fetchMock);
			await expect(
				client.getJobConflicts('tok', {
					assignedUserId: '',
					startAt: '2026-06-24T17:00:00.000Z',
				}),
			).rejects.toThrow(ValidationError);
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('listCompanies', () => {
		function companyPage(accounts: ReturnType<typeof makeAccount>[]) {
			return {
				data: accounts,
				meta: {
					page: 1,
					pageSize: 20,
					total: accounts.length,
					totalPages: 1,
					hasNextPage: false,
					hasPreviousPage: false,
				},
			};
		}

		it('returns parsed companies and sends the bearer auth header', async () => {
			const accounts = [makeAccount(), makeAccount()];
			fetchMock.mockResolvedValueOnce(jsonResponse(companyPage(accounts)));

			const client = createApiClient(BASE, fetchMock);
			const token = faker.string.alphanumeric(32);
			const result = await client.listCompanies(token);

			expect(result.data).toEqual(accounts);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/admin/companies?page=1&pageSize=20`);
			expect(init.headers).toMatchObject({ Authorization: `Bearer ${token}` });
		});

		it('forwards a trimmed search term and custom pagination', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(companyPage([])));

			const client = createApiClient(BASE, fetchMock);
			await client.listCompanies('token', { search: '  Acme  ', page: 2, pageSize: 5 });

			const [url] = fetchMock.mock.calls[0] as [string];
			expect(url).toBe(`${BASE}/v1/admin/companies?page=2&pageSize=5&search=Acme`);
		});

		it('omits the search param when the term is blank', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(companyPage([])));

			const client = createApiClient(BASE, fetchMock);
			await client.listCompanies('token', { search: '   ' });

			const [url] = fetchMock.mock.calls[0] as [string];
			expect(url).toBe(`${BASE}/v1/admin/companies?page=1&pageSize=20`);
		});
	});

	describe('switchCompany', () => {
		it('posts to the switch endpoint and returns the new session', async () => {
			const auth = makeAuthResponse('owner');
			fetchMock.mockResolvedValueOnce(jsonResponse(auth));

			const client = createApiClient(BASE, fetchMock);
			const accountId = auth.account.id as AccountId;
			const result = await client.switchCompany('staff-token', accountId);

			expect(result.account.id).toBe(auth.account.id);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/admin/companies/${accountId}/switch`);
			expect(init.method).toBe('POST');
			expect(init.headers).toMatchObject({ Authorization: 'Bearer staff-token' });
		});

		it('url-encodes the company id', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(makeAuthResponse()));

			const client = createApiClient(BASE, fetchMock);
			await client.switchCompany('staff-token', 'a/b c' as AccountId);

			const [url] = fetchMock.mock.calls[0] as [string];
			expect(url).toBe(`${BASE}/v1/admin/companies/a%2Fb%20c/switch`);
		});
	});

	describe('network failures', () => {
		it('propagates a rejected fetch (e.g. connection refused)', async () => {
			fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

			const client = createApiClient(BASE, fetchMock);
			await expect(client.health()).rejects.toThrow('Network request failed');
		});

		it('throws when a successful response body is not valid JSON', async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: async () => 'not json at all',
			} as Response);

			const client = createApiClient(BASE, fetchMock);
			// Schema parsing fails because the body is a bare string, not the health shape.
			await expect(client.health()).rejects.toThrow();
		});

		it('parses a non-JSON error body into the generic message + raw details', async () => {
			fetchMock.mockResolvedValueOnce({
				ok: false,
				status: 502,
				text: async () => 'Bad Gateway',
			} as Response);

			const client = createApiClient(BASE, fetchMock);
			const error = await client.health().catch((e) => e);
			expect(error).toBeInstanceOf(ApiError);
			expect(error.status).toBe(502);
			expect(error.details).toBe('Bad Gateway');
		});
	});

	it('uses the global fetch by default when none is provided', () => {
		const client = createApiClient(BASE);
		expect(client.baseUrl).toBe(BASE);
	});

	describe('cookie (credentials) mode', () => {
		it('sends credentials and omits the bearer header when no token is given', async () => {
			const session = { user: makeUser(), account: makeAccount(), role: 'owner' as const };
			fetchMock.mockResolvedValueOnce(jsonResponse(session));

			const client = createApiClient(BASE, fetchMock, { withCredentials: true });
			const result = await client.me();

			expect(result).toEqual(session);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/auth/me`);
			expect(init.credentials).toBe('include');
			// In cookie mode the request authenticates via the cookie, not a header.
			expect(init.headers).not.toHaveProperty('Authorization');
		});

		it('posts to the logout endpoint with credentials', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'signed_out' }));

			const client = createApiClient(BASE, fetchMock, { withCredentials: true });
			await client.logout();

			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/auth/logout`);
			expect(init.method).toBe('POST');
			expect(init.credentials).toBe('include');
		});

		it('does not set credentials in the default (native bearer) mode', async () => {
			fetchMock.mockResolvedValueOnce(
				jsonResponse({ status: 'ok', uptime: 1, timestamp: new Date().toISOString() }),
			);

			const client = createApiClient(BASE, fetchMock);
			await client.health();

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(init.credentials).toBeUndefined();
		});
	});
});
