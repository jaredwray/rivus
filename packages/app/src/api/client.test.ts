import { faker } from '@faker-js/faker';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client';

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

function makeItem() {
	const now = new Date().toISOString();
	return {
		id: faker.string.uuid(),
		ownerId: faker.string.uuid(),
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

	describe('login', () => {
		it('returns the token + user on success', async () => {
			const user = makeUser();
			const response = { token: faker.string.alphanumeric(40), user };
			fetchMock.mockResolvedValueOnce(jsonResponse(response));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.login({ email: user.email, password: 'supersecret' });

			expect(result).toEqual(response);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/auth/login`);
			expect(init.method).toBe('POST');
			expect(JSON.parse(init.body as string)).toEqual({
				email: user.email,
				password: 'supersecret',
			});
		});

		it('throws a clear ApiError on invalid credentials (401)', async () => {
			fetchMock.mockResolvedValueOnce(
				jsonResponse(
					{ error: 'Unauthorized', message: 'Invalid email or password', statusCode: 401 },
					{ status: 401 },
				),
			);

			const client = createApiClient(BASE, fetchMock);
			const error = await client
				.login({ email: 'a@b.com', password: 'badpassword' })
				.catch((e) => e);

			expect(error).toBeInstanceOf(ApiError);
			expect(error.status).toBe(401);
			expect(error.message).toBe('Invalid email or password');
		});

		it('falls back to a generic message when the error body has none', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(undefined, { status: 500 }));

			const client = createApiClient(BASE, fetchMock);
			const error = await client
				.login({ email: 'a@b.com', password: 'badpassword' })
				.catch((e) => e);

			expect(error).toBeInstanceOf(ApiError);
			expect(error.status).toBe(500);
			expect(error.message).toContain('failed with status 500');
		});

		it('rejects locally-invalid input before hitting the network', async () => {
			const client = createApiClient(BASE, fetchMock);
			await expect(client.login({ email: 'not-an-email', password: 'short' })).rejects.toThrow();
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('register', () => {
		it('returns the token + user on success', async () => {
			const user = makeUser();
			const response = { token: faker.string.alphanumeric(40), user };
			fetchMock.mockResolvedValueOnce(jsonResponse(response, { status: 201 }));

			const client = createApiClient(BASE, fetchMock);
			const result = await client.register({
				email: user.email,
				password: 'supersecret',
				name: user.name,
			});

			expect(result).toEqual(response);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${BASE}/v1/auth/register`);
			expect(init.method).toBe('POST');
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
});
