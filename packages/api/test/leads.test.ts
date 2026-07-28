import { faker } from '@faker-js/faker';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SALES_NOTIFICATIONS_ADDRESS } from '../src/services/email';
import { authHeader, buildTestApp, RecordingMailer, signupOwner } from './helpers';

function recordingMailer(app: FastifyInstance): RecordingMailer {
	const mailer = app.deps.mailer;
	if (!(mailer instanceof RecordingMailer)) {
		throw new Error('test app must use a RecordingMailer');
	}
	return mailer;
}

const STAFF_EMAIL = 'ops@rivus.ai';

function submitDemoLead(app: FastifyInstance, payload: Record<string, unknown>) {
	return app.inject({ method: 'POST', url: '/v1/leads/demo', payload });
}

describe('POST /v1/leads/demo (public)', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	it('accepts a minimal request without auth and answers an opaque receipt', async () => {
		const response = await submitDemoLead(app, {
			name: 'Dana Fox',
			email: 'Dana@Example.com',
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toEqual({ status: 'received' });
	});

	it('stores the full context (normalized email, defaults applied)', async () => {
		await submitDemoLead(app, {
			name: 'Dana Fox',
			email: ' Dana@Example.com ',
			business: 'Fox Plumbing',
			phone: '(555) 123-4567',
			trade: 'Plumber',
		});

		const staffToken = (await signupOwner(app, { email: STAFF_EMAIL })).token;
		const listed = await app.inject({
			method: 'GET',
			url: '/v1/leads/demo',
			headers: authHeader(staffToken),
		});
		const [lead] = listed.json().data;
		expect(lead).toMatchObject({
			name: 'Dana Fox',
			email: 'dana@example.com',
			business: 'Fox Plumbing',
			phone: '(555) 123-4567',
			trade: 'Plumber',
			source: 'website-demo',
		});
		expect(lead.id).toBeTruthy();
		expect(lead.createdAt).toBeTruthy();
	});

	it('rejects a missing email with a friendly message', async () => {
		const response = await submitDemoLead(app, { name: 'Dana Fox' });

		expect(response.statusCode).toBe(400);
		expect(response.json().message).toBe('Email address is required.');
	});

	it('rejects an unknown source instead of storing free text', async () => {
		const response = await submitDemoLead(app, {
			name: 'Dana Fox',
			email: 'dana@example.com',
			source: 'billboard',
		});

		expect(response.statusCode).toBe(400);
	});

	it('coalesces a retried submission instead of double-booking the sales queue', async () => {
		await submitDemoLead(app, { name: 'Dana Fox', email: 'dana@example.com' });
		const retry = await submitDemoLead(app, {
			name: 'Dana Fox',
			email: 'Dana@Example.com',
			phone: '555-0100',
		});
		expect(retry.statusCode).toBe(201);

		const staffToken = (await signupOwner(app, { email: STAFF_EMAIL })).token;
		const listed = await app.inject({
			method: 'GET',
			url: '/v1/leads/demo',
			headers: authHeader(staffToken),
		});
		const body = listed.json();
		expect(body.meta.total).toBe(1);
		// The retry's fresher details win.
		expect(body.data[0]).toMatchObject({ email: 'dana@example.com', phone: '555-0100' });
	});

	it('keeps leads for the same email separate across sources', async () => {
		await submitDemoLead(app, { name: 'Dana Fox', email: 'dana@example.com' });
		await submitDemoLead(app, {
			name: 'Dana Fox',
			email: 'dana@example.com',
			source: 'apps-waitlist',
		});

		const staffToken = (await signupOwner(app, { email: STAFF_EMAIL })).token;
		const listed = await app.inject({
			method: 'GET',
			url: '/v1/leads/demo',
			headers: authHeader(staffToken),
		});
		expect(listed.json().meta.total).toBe(2);
	});

	it('notifies the sales inbox with the stored lead', async () => {
		await submitDemoLead(app, {
			name: 'Dana Fox',
			email: 'dana@example.com',
			business: 'Fox Plumbing',
		});

		const mailer = recordingMailer(app);
		expect(mailer.demoLeadEmails).toHaveLength(1);
		expect(mailer.demoLeadEmails[0]?.to).toBe(SALES_NOTIFICATIONS_ADDRESS);
		expect(mailer.demoLeadEmails[0]?.lead).toMatchObject({
			name: 'Dana Fox',
			email: 'dana@example.com',
			business: 'Fox Plumbing',
		});
	});

	it('still stores the lead and answers 201 when the notification email fails', async () => {
		recordingMailer(app).failNextDemoLeadEmail = true;

		const response = await submitDemoLead(app, { name: 'Dana Fox', email: 'dana@example.com' });
		expect(response.statusCode).toBe(201);

		const staffToken = (await signupOwner(app, { email: STAFF_EMAIL })).token;
		const listed = await app.inject({
			method: 'GET',
			url: '/v1/leads/demo',
			headers: authHeader(staffToken),
		});
		expect(listed.json().meta.total).toBe(1);
	});
});

describe('GET /v1/leads/demo (staff only)', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	it('requires auth', async () => {
		const response = await app.inject({ method: 'GET', url: '/v1/leads/demo' });
		expect(response.statusCode).toBe(401);
	});

	it('rejects a signed-in non-staff owner with 403', async () => {
		const owner = await signupOwner(app);
		const response = await app.inject({
			method: 'GET',
			url: '/v1/leads/demo',
			headers: authHeader(owner.token),
		});
		expect(response.statusCode).toBe(403);
	});

	it('pages leads newest-first for staff', async () => {
		for (let index = 0; index < 3; index++) {
			await submitDemoLead(app, {
				name: `Lead ${index}`,
				email: faker.internet.email().toLowerCase(),
			});
		}
		const staffToken = (await signupOwner(app, { email: STAFF_EMAIL })).token;

		const firstPage = await app.inject({
			method: 'GET',
			url: '/v1/leads/demo?page=1&pageSize=2',
			headers: authHeader(staffToken),
		});
		expect(firstPage.statusCode).toBe(200);
		const body = firstPage.json();
		expect(body.meta.total).toBe(3);
		expect(body.data.map((lead: { name: string }) => lead.name)).toEqual(['Lead 2', 'Lead 1']);

		const secondPage = await app.inject({
			method: 'GET',
			url: '/v1/leads/demo?page=2&pageSize=2',
			headers: authHeader(staffToken),
		});
		expect(secondPage.json().data.map((lead: { name: string }) => lead.name)).toEqual(['Lead 0']);
	});
});
