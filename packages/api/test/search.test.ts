import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, signupOwner } from './helpers';

describe('search', () => {
	let app: FastifyInstance;
	let token: string;

	beforeEach(async () => {
		app = await buildTestApp();
		token = (await signupOwner(app)).token;
	});

	afterEach(async () => {
		await app.close();
	});

	function createCustomer(payload: Record<string, unknown>) {
		return app.inject({
			method: 'POST',
			url: '/v1/customers',
			headers: authHeader(token),
			payload,
		});
	}

	function createJob(payload: Record<string, unknown>) {
		return app.inject({
			method: 'POST',
			url: '/v1/jobs',
			headers: authHeader(token),
			payload,
		});
	}

	function search(query: string, asToken = token) {
		return app.inject({
			method: 'GET',
			url: `/v1/search?${query}`,
			headers: authHeader(asToken),
		});
	}

	it('requires authentication', async () => {
		const response = await app.inject({ method: 'GET', url: '/v1/search?q=anything' });
		expect(response.statusCode).toBe(401);
	});

	it('rejects a missing or blank term (400)', async () => {
		expect((await search('')).statusCode).toBe(400);
		expect((await search('q=')).statusCode).toBe(400);
		expect((await search('q=%20%20')).statusCode).toBe(400);
	});

	it('matches customers across name, email, phone, address and notes', async () => {
		await createCustomer({ name: 'Grace Kim' });
		await createCustomer({ name: 'Other', email: 'grace@example.com' });
		await createCustomer({ name: 'Phoned', phone: '(206) 555-0199' });
		await createCustomer({ name: 'Located', address: '12 Grace Avenue' });
		await createCustomer({ name: 'Noted', notes: 'ask for grace' });
		await createCustomer({ name: 'Unrelated' });

		const response = await search('q=grace');
		expect(response.statusCode).toBe(200);
		const names = (response.json().customers as { name: string }[]).map((c) => c.name).sort();
		expect(names).toEqual(['Grace Kim', 'Located', 'Noted', 'Other']);
		expect(response.json().jobs).toEqual([]);
	});

	it('matches jobs across title, address and notes (and is case-insensitive)', async () => {
		const startAt = '2026-07-01T17:00:00.000Z';
		await createJob({ title: 'Water Heater Install', startAt });
		await createJob({ title: 'Drain clear', startAt, address: '9 Heater Lane' });
		await createJob({ title: 'Inspection', startAt, notes: 'bring the heater' });
		await createJob({ title: 'Unrelated', startAt });

		const response = await search('q=HEATER');
		expect(response.statusCode).toBe(200);
		const titles = (response.json().jobs as { title: string }[]).map((j) => j.title).sort();
		expect(titles).toEqual(['Drain clear', 'Inspection', 'Water Heater Install']);
		expect(response.json().customers).toEqual([]);
	});

	it('treats the term literally, not as a regex', async () => {
		await createCustomer({ name: 'axb' });
		await createCustomer({ name: 'a.b' });

		const response = await search('q=a.b');
		expect(response.statusCode).toBe(200);
		const names = (response.json().customers as { name: string }[]).map((c) => c.name);
		expect(names).toEqual(['a.b']);
	});

	it('caps each type at the requested limit', async () => {
		for (let i = 0; i < 5; i += 1) {
			await createCustomer({ name: `Match ${i}` });
		}
		const response = await search('q=Match&limit=2');
		expect(response.statusCode).toBe(200);
		expect(response.json().customers).toHaveLength(2);
	});

	it('rejects a limit outside 1–20 (400)', async () => {
		expect((await search('q=x&limit=0')).statusCode).toBe(400);
		expect((await search('q=x&limit=21')).statusCode).toBe(400);
	});

	it('returns empty groups when nothing matches', async () => {
		await createCustomer({ name: 'Grace Kim' });
		const response = await search('q=zzz-no-such-thing');
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ customers: [], jobs: [] });
	});

	it('does not leak another account’s records', async () => {
		await createCustomer({ name: 'Private Grace' });

		const otherToken = (await signupOwner(app)).token;
		const response = await search('q=grace', otherToken);
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ customers: [], jobs: [] });
	});
});
