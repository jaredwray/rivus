import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addMember, authHeader, buildTestApp, signupOwner } from './helpers';

// A fixed UTC week so date math in assertions stays deterministic.
const MON = '2026-06-22T16:00:00.000Z';
const WED = '2026-06-24T17:00:00.000Z';
const TUE_NEXT = '2026-06-30T17:00:00.000Z';

describe('jobs', () => {
	let app: FastifyInstance;
	let token: string;
	let ownerUserId: string;

	beforeEach(async () => {
		app = await buildTestApp();
		const owner = await signupOwner(app);
		token = owner.token;
		ownerUserId = owner.user.id;
	});

	afterEach(async () => {
		await app.close();
	});

	async function createJob(extra: Record<string, unknown> = {}) {
		return app.inject({
			method: 'POST',
			url: '/v1/jobs',
			headers: authHeader(token),
			payload: { title: 'Water heater install', startAt: WED, ...extra },
		});
	}

	async function createCustomer(name = 'Dana Whitfield') {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/customers',
			headers: authHeader(token),
			payload: { name },
		});
		return response.json().id as string;
	}

	it('requires authentication', async () => {
		const response = await app.inject({ method: 'GET', url: '/v1/jobs' });
		expect(response.statusCode).toBe(401);
	});

	it('schedules a job with defaults', async () => {
		const response = await createJob();

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			title: 'Water heater install',
			customerId: '',
			assignedUserId: '',
			startAt: WED,
			durationMinutes: 60,
			status: 'scheduled',
			address: '',
			notes: '',
			estimatedValue: 0,
		});
		expect(response.json().id).toBeTypeOf('string');
	});

	it('schedules a fully specified job linked to a customer and assignee', async () => {
		const customerId = await createCustomer();
		const response = await createJob({
			title: 'Drain cleaning',
			customerId,
			assignedUserId: ownerUserId,
			durationMinutes: 90,
			status: 'confirmed',
			address: 'Queen Anne, Seattle',
			notes: 'Bring the auger',
			estimatedValue: 18_000,
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			title: 'Drain cleaning',
			customerId,
			assignedUserId: ownerUserId,
			durationMinutes: 90,
			status: 'confirmed',
			estimatedValue: 18_000,
		});
	});

	it('rejects a create with no title (400)', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/jobs',
			headers: authHeader(token),
			payload: { startAt: WED },
		});
		expect(response.statusCode).toBe(400);
	});

	it('rejects a create with no start time (400)', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/jobs',
			headers: authHeader(token),
			payload: { title: 'When?' },
		});
		expect(response.statusCode).toBe(400);
	});

	it('rejects a non-UTC or malformed start time (400)', async () => {
		for (const startAt of ['2026-06-24T21:00:00+02:00', 'tomorrow']) {
			const response = await createJob({ startAt });
			expect(response.statusCode).toBe(400);
		}
	});

	it('rejects an out-of-range duration and negative value (400)', async () => {
		expect((await createJob({ durationMinutes: 0 })).statusCode).toBe(400);
		expect((await createJob({ durationMinutes: 1441 })).statusCode).toBe(400);
		expect((await createJob({ estimatedValue: -1 })).statusCode).toBe(400);
	});

	it('rejects a job that references a customer outside the account (400)', async () => {
		const response = await createJob({ customerId: 'does-not-exist' });
		expect(response.statusCode).toBe(400);
		expect(response.json().message).toMatch(/customer/i);
	});

	it('rejects a job assigned to a non-member (400)', async () => {
		const response = await createJob({ assignedUserId: 'not-a-member' });
		expect(response.statusCode).toBe(400);
		expect(response.json().message).toMatch(/team member/i);
	});

	it('lists jobs earliest-first with pagination metadata', async () => {
		await createJob({ title: 'b', startAt: WED });
		await createJob({ title: 'a', startAt: MON });
		await createJob({ title: 'c', startAt: TUE_NEXT });

		const response = await app.inject({
			method: 'GET',
			url: '/v1/jobs?page=1&pageSize=2',
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.data).toHaveLength(2);
		expect(body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, hasNextPage: true });
		// Earliest start (Monday) comes first.
		expect(body.data[0].title).toBe('a');
		expect(body.data[1].title).toBe('b');
	});

	it('orders jobs that share a start time deterministically by creation', async () => {
		await createJob({ title: 'first', startAt: WED });
		await createJob({ title: 'second', startAt: WED });

		const body = (
			await app.inject({ method: 'GET', url: '/v1/jobs', headers: authHeader(token) })
		).json();
		expect(body.data.map((job: { title: string }) => job.title)).toEqual(['first', 'second']);
	});

	it('filters jobs to a start-time window', async () => {
		await createJob({ title: 'before', startAt: MON });
		await createJob({ title: 'inside', startAt: WED });
		await createJob({ title: 'after', startAt: TUE_NEXT });

		const response = await app.inject({
			method: 'GET',
			url: '/v1/jobs?from=2026-06-23T00:00:00.000Z&to=2026-06-26T00:00:00.000Z',
			headers: authHeader(token),
		});
		const body = response.json();
		expect(body.data).toHaveLength(1);
		expect(body.data[0].title).toBe('inside');
	});

	it('filters jobs by assignee, status, and customer', async () => {
		const customerId = await createCustomer();
		await createJob({
			title: 'mine',
			assignedUserId: ownerUserId,
			status: 'confirmed',
			customerId,
		});
		await createJob({ title: 'unassigned' });

		const byAssignee = (
			await app.inject({
				method: 'GET',
				url: `/v1/jobs?assignedUserId=${ownerUserId}`,
				headers: authHeader(token),
			})
		).json();
		expect(byAssignee.data.map((j: { title: string }) => j.title)).toEqual(['mine']);

		const byStatus = (
			await app.inject({
				method: 'GET',
				url: '/v1/jobs?status=confirmed',
				headers: authHeader(token),
			})
		).json();
		expect(byStatus.data.map((j: { title: string }) => j.title)).toEqual(['mine']);

		const byCustomer = (
			await app.inject({
				method: 'GET',
				url: `/v1/jobs?customerId=${customerId}`,
				headers: authHeader(token),
			})
		).json();
		expect(byCustomer.data.map((j: { title: string }) => j.title)).toEqual(['mine']);
	});

	it('rejects a malformed list date bound (400)', async () => {
		const response = await app.inject({
			method: 'GET',
			url: '/v1/jobs?from=not-a-date',
			headers: authHeader(token),
		});
		expect(response.statusCode).toBe(400);
	});

	it('fetches a single job by id, 404 for unknown', async () => {
		const id = (await createJob()).json().id;
		expect(
			(await app.inject({ method: 'GET', url: `/v1/jobs/${id}`, headers: authHeader(token) }))
				.statusCode,
		).toBe(200);
		expect(
			(
				await app.inject({
					method: 'GET',
					url: '/v1/jobs/does-not-exist',
					headers: authHeader(token),
				})
			).statusCode,
		).toBe(404);
	});

	it('updates and reschedules a job', async () => {
		const id = (await createJob({ status: 'scheduled' })).json().id;

		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/jobs/${id}`,
			headers: authHeader(token),
			payload: { status: 'completed', startAt: MON },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({ status: 'completed', startAt: MON });
	});

	it('rejects an empty update (400)', async () => {
		const id = (await createJob()).json().id;
		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/jobs/${id}`,
			headers: authHeader(token),
			payload: {},
		});
		expect(response.statusCode).toBe(400);
	});

	it('rejects an update that points at a missing reference (400)', async () => {
		const id = (await createJob()).json().id;
		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/jobs/${id}`,
			headers: authHeader(token),
			payload: { assignedUserId: 'ghost' },
		});
		expect(response.statusCode).toBe(400);
	});

	it('returns 404 updating an unknown job', async () => {
		const response = await app.inject({
			method: 'PATCH',
			url: '/v1/jobs/does-not-exist',
			headers: authHeader(token),
			payload: { status: 'completed' },
		});
		expect(response.statusCode).toBe(404);
	});

	it('deletes a job, after which it is gone', async () => {
		const id = (await createJob()).json().id;
		expect(
			(await app.inject({ method: 'DELETE', url: `/v1/jobs/${id}`, headers: authHeader(token) }))
				.statusCode,
		).toBe(204);
		expect(
			(await app.inject({ method: 'GET', url: `/v1/jobs/${id}`, headers: authHeader(token) }))
				.statusCode,
		).toBe(404);
	});

	it('returns 404 deleting an unknown job', async () => {
		const response = await app.inject({
			method: 'DELETE',
			url: '/v1/jobs/does-not-exist',
			headers: authHeader(token),
		});
		expect(response.statusCode).toBe(404);
	});

	it('does not leak jobs across accounts', async () => {
		const id = (await createJob()).json().id;
		const otherToken = (await signupOwner(app)).token;

		expect(
			(await app.inject({ method: 'GET', url: `/v1/jobs/${id}`, headers: authHeader(otherToken) }))
				.statusCode,
		).toBe(404);
		expect(
			(
				await app.inject({
					method: 'PATCH',
					url: `/v1/jobs/${id}`,
					headers: authHeader(otherToken),
					payload: { status: 'completed' },
				})
			).statusCode,
		).toBe(404);
		expect(
			(
				await app.inject({
					method: 'DELETE',
					url: `/v1/jobs/${id}`,
					headers: authHeader(otherToken),
				})
			).statusCode,
		).toBe(404);
	});

	describe('conflicts (double-booking)', () => {
		function conflicts(params: Record<string, string>) {
			const query = new URLSearchParams(params).toString();
			return app.inject({
				method: 'GET',
				url: `/v1/jobs/conflicts?${query}`,
				headers: authHeader(token),
			});
		}

		it('flags a job that overlaps an existing booking for the same assignee', async () => {
			// 17:00–18:00 for the owner.
			await createJob({ assignedUserId: ownerUserId, startAt: WED, durationMinutes: 60 });

			const response = await conflicts({
				assignedUserId: ownerUserId,
				startAt: '2026-06-24T17:30:00.000Z',
				durationMinutes: '60',
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().conflicts).toHaveLength(1);
		});

		it('treats back-to-back jobs (touching edges) as no conflict', async () => {
			await createJob({ assignedUserId: ownerUserId, startAt: WED, durationMinutes: 60 });

			const response = await conflicts({
				assignedUserId: ownerUserId,
				startAt: '2026-06-24T18:00:00.000Z',
				durationMinutes: '60',
			});
			expect(response.json().conflicts).toHaveLength(0);
		});

		it('does not flag a different assignee', async () => {
			const teammate = await addMember(app, token, 'member', 'tech@example.com');
			await createJob({ assignedUserId: ownerUserId, startAt: WED, durationMinutes: 60 });

			const response = await conflicts({
				assignedUserId: teammate.userId,
				startAt: WED,
				durationMinutes: '60',
			});
			expect(response.json().conflicts).toHaveLength(0);
		});

		it('ignores canceled jobs', async () => {
			const id = (
				await createJob({ assignedUserId: ownerUserId, startAt: WED, durationMinutes: 60 })
			).json().id;
			await app.inject({
				method: 'PATCH',
				url: `/v1/jobs/${id}`,
				headers: authHeader(token),
				payload: { status: 'canceled' },
			});

			const response = await conflicts({
				assignedUserId: ownerUserId,
				startAt: WED,
				durationMinutes: '60',
			});
			expect(response.json().conflicts).toHaveLength(0);
		});

		it('excludes the job being edited from its own check', async () => {
			const id = (
				await createJob({ assignedUserId: ownerUserId, startAt: WED, durationMinutes: 60 })
			).json().id;

			const withoutExclude = await conflicts({
				assignedUserId: ownerUserId,
				startAt: WED,
				durationMinutes: '60',
			});
			expect(withoutExclude.json().conflicts).toHaveLength(1);

			const withExclude = await conflicts({
				assignedUserId: ownerUserId,
				startAt: WED,
				durationMinutes: '60',
				excludeJobId: id,
			});
			expect(withExclude.json().conflicts).toHaveLength(0);
		});

		it('requires an assignee and a start time (400)', async () => {
			expect((await conflicts({ startAt: WED })).statusCode).toBe(400);
			expect((await conflicts({ assignedUserId: ownerUserId })).statusCode).toBe(400);
		});
	});
});
