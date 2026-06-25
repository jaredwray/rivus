import { faker } from '@faker-js/faker';
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
