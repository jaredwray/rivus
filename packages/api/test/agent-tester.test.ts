import type { AccountId, ConversationId, CreateCustomerInput, Customer } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import type { InMemoryRepositories } from '../src/repositories/memory';
import { createTesterChannel } from '../src/services/agent/tester';
import {
	authHeader,
	buildTestApp,
	buildTestAppWithRepos,
	type RecordingMailer,
	type RecordingSmsSender,
	type RecordingWhatsappSender,
	type SignedUpUser,
	signupOwner,
} from './helpers';

const BASE = '/v1/admin/agent-tester';
const STAFF_EMAIL = 'tester@rivus.ai';
const CUSTOMER_EMAIL = 'dana@example.com';
const CUSTOMER_PHONE = '(555) 123-4567';
const CUSTOMER_E164 = '+15551234567';

/**
 * The config the tester routes are registered under: NODE_ENV stays `test` (so
 * the production boot gates don't fire) while RIVUS_ENV marks this as the
 * development environment — exactly how the seeder's tests enable their route.
 */
function devConfig() {
	return loadConfig({
		NODE_ENV: 'test',
		JWT_SECRET: 'test-secret-value-1234',
		RIVUS_ENV: 'development',
	} as NodeJS.ProcessEnv);
}

interface Harness {
	app: FastifyInstance;
	repos: InMemoryRepositories;
	staff: SignedUpUser;
	accountId: AccountId;
}

/** A dev-mode app with a signed-in Rivus staff owner (the only caller these routes allow). */
async function setup(): Promise<Harness> {
	const { app, repos } = await buildTestAppWithRepos({ config: devConfig() });
	const staff = await signupOwner(app, { email: STAFF_EMAIL, businessName: 'Rivus HQ' });
	return { app, repos, staff, accountId: staff.account.id as AccountId };
}

function addCustomer(
	repos: InMemoryRepositories,
	accountId: AccountId,
	overrides: Partial<CreateCustomerInput> = {},
): Promise<Customer> {
	return repos.customers.create(accountId, {
		name: 'Dana Fox',
		email: '',
		phone: '',
		address: '12 Pine St',
		lifetimeValue: 0,
		balance: 0,
		notes: '',
		...overrides,
	});
}

interface TesterSession {
	id: string;
	channel: string;
	contactAddress: string;
	contactName: string;
	customerId: string;
	state: string;
	conversationId: string;
	snippet: string;
	subject: string;
	bookedJobId: string;
	lastMessageAt: string;
	createdAt: string;
	updatedAt: string;
}

interface TesterTurn {
	outcome: string;
	delivery: { text: string; subject?: string; html?: string };
	session: TesterSession;
	messages: Array<{ author: string; body: string }>;
}

/** Open a session, asserting it was created (the flows below all start here). */
async function openSession(
	app: FastifyInstance,
	token: string,
	payload: Record<string, unknown>,
): Promise<TesterSession> {
	const response = await app.inject({
		method: 'POST',
		url: `${BASE}/sessions`,
		headers: authHeader(token),
		payload,
	});
	expect(response.statusCode).toBe(201);
	return response.json<TesterSession>();
}

/** Send one message as the simulated customer. */
function sendAs(app: FastifyInstance, token: string, sessionId: string, text: string) {
	return app.inject({
		method: 'POST',
		url: `${BASE}/sessions/${sessionId}/messages`,
		headers: authHeader(token),
		payload: { text },
	});
}

describe('agent tester — registration gate', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('does not exist outside development, even for staff (404)', async () => {
		// The default test app runs with NODE_ENV=test and no RIVUS_ENV.
		app = await buildTestApp();
		const staff = await signupOwner(app, { email: STAFF_EMAIL, businessName: 'Rivus HQ' });
		const listed = await app.inject({
			method: 'GET',
			url: `${BASE}/sessions`,
			headers: authHeader(staff.token),
		});
		expect(listed.statusCode).toBe(404);
		const created = await app.inject({
			method: 'POST',
			url: `${BASE}/sessions`,
			headers: authHeader(staff.token),
			payload: { channel: 'email', contactAddress: CUSTOMER_EMAIL },
		});
		expect(created.statusCode).toBe(404);
	});

	it('rejects an unauthenticated caller (401)', async () => {
		const built = await setup();
		app = built.app;
		const response = await app.inject({ method: 'GET', url: `${BASE}/sessions` });
		expect(response.statusCode).toBe(401);
	});

	it('rejects a signed-in owner who is not Rivus staff (403)', async () => {
		const built = await setup();
		app = built.app;
		const civilian = await signupOwner(app, { email: 'owner@acme.test' });
		const response = await app.inject({
			method: 'GET',
			url: `${BASE}/sessions`,
			headers: authHeader(civilian.token),
		});
		expect(response.statusCode).toBe(403);
	});

	it('documents the routes in the OpenAPI spec where they are registered', async () => {
		const built = await setup();
		app = built.app;
		const spec = app.swagger() as { paths: Record<string, unknown> };
		expect(Object.keys(spec.paths)).toEqual(
			expect.arrayContaining([
				`${BASE}/sessions`,
				`${BASE}/sessions/{id}`,
				`${BASE}/sessions/{id}/messages`,
			]),
		);
	});
});

describe('POST /v1/admin/agent-tester/sessions', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('opens an email session on a customer’s address on file', async () => {
		const built = await setup();
		app = built.app;
		const customer = await addCustomer(built.repos, built.accountId, {
			email: 'Dana@Example.com',
			phone: CUSTOMER_PHONE,
		});
		const session = await openSession(app, built.staff.token, {
			channel: 'email',
			customerId: customer.id,
			subject: 'Water heater',
		});
		expect(session).toMatchObject({
			channel: 'email',
			contactAddress: CUSTOMER_EMAIL,
			contactName: 'Dana Fox',
			customerId: customer.id,
			state: 'new',
			subject: 'Water heater',
			bookedJobId: '',
			snippet: '',
		});
		// The session *is* a real agent thread plus its inbox conversation.
		const thread = await built.repos.agentThreads.findByContact(
			built.accountId,
			'email',
			CUSTOMER_EMAIL,
		);
		expect(thread?.id).toBe(session.id);
		const conversation = await built.repos.conversations.findById(
			built.accountId,
			session.conversationId as ConversationId,
		);
		expect(conversation).toMatchObject({
			channel: 'email',
			customerId: customer.id,
			contactName: 'Dana Fox',
			contactPhone: CUSTOMER_PHONE,
			status: 'rivus_handling',
		});
	});

	it('normalizes a customer’s free-text phone for sms and whatsapp', async () => {
		const built = await setup();
		app = built.app;
		const customer = await addCustomer(built.repos, built.accountId, { phone: CUSTOMER_PHONE });
		for (const channel of ['sms', 'whatsapp'] as const) {
			const session = await openSession(app, built.staff.token, {
				channel,
				customerId: customer.id,
				// A subject is meaningless off email, so it is dropped.
				subject: 'ignored',
			});
			expect(session).toMatchObject({
				channel,
				contactAddress: CUSTOMER_E164,
				customerId: customer.id,
				subject: '',
			});
		}
	});

	it('opens a session from a raw address for someone who is not a customer', async () => {
		const built = await setup();
		app = built.app;
		const session = await openSession(app, built.staff.token, {
			channel: 'email',
			contactAddress: '  Stranger@Example.COM ',
		});
		expect(session).toMatchObject({
			contactAddress: 'stranger@example.com',
			// No CRM record, and no name given — the address stands in for both.
			customerId: '',
			contactName: 'stranger@example.com',
		});
	});

	it('links a raw address that belongs to a customer, and honors a given name', async () => {
		const built = await setup();
		app = built.app;
		const customer = await addCustomer(built.repos, built.accountId, { phone: CUSTOMER_PHONE });
		const session = await openSession(app, built.staff.token, {
			channel: 'whatsapp',
			contactAddress: '555.123.4567',
			contactName: '  Dana on WhatsApp  ',
		});
		expect(session).toMatchObject({
			contactAddress: CUSTOMER_E164,
			customerId: customer.id,
			contactName: 'Dana on WhatsApp',
		});
	});

	it('requires exactly one identifier', async () => {
		const built = await setup();
		app = built.app;
		const customer = await addCustomer(built.repos, built.accountId, { email: CUSTOMER_EMAIL });
		for (const payload of [
			{ channel: 'email' },
			{ channel: 'email', customerId: customer.id, contactAddress: CUSTOMER_EMAIL },
		]) {
			const response = await app.inject({
				method: 'POST',
				url: `${BASE}/sessions`,
				headers: authHeader(built.staff.token),
				payload,
			});
			expect(response.statusCode).toBe(400);
			expect(response.json().message).toContain('exactly one');
		}
	});

	it('refuses a contact with no usable address on the chosen channel', async () => {
		const built = await setup();
		app = built.app;
		const emailOnly = await addCustomer(built.repos, built.accountId, { email: CUSTOMER_EMAIL });
		const phoneless = await app.inject({
			method: 'POST',
			url: `${BASE}/sessions`,
			headers: authHeader(built.staff.token),
			payload: { channel: 'sms', customerId: emailOnly.id },
		});
		expect(phoneless.statusCode).toBe(400);
		expect(phoneless.json().message).toContain('phone number');

		const phoneOnly = await addCustomer(built.repos, built.accountId, { phone: CUSTOMER_PHONE });
		const emailless = await app.inject({
			method: 'POST',
			url: `${BASE}/sessions`,
			headers: authHeader(built.staff.token),
			payload: { channel: 'email', customerId: phoneOnly.id },
		});
		expect(emailless.statusCode).toBe(400);
		expect(emailless.json().message).toBe('This customer has no email address on file.');

		// A stored phone nobody can dial is no better than none at all.
		const unreachable = await addCustomer(built.repos, built.accountId, { phone: '12345' });
		const unnormalizable = await app.inject({
			method: 'POST',
			url: `${BASE}/sessions`,
			headers: authHeader(built.staff.token),
			payload: { channel: 'whatsapp', customerId: unreachable.id },
		});
		expect(unnormalizable.statusCode).toBe(400);
	});

	it('refuses a raw address the channel can’t address', async () => {
		const built = await setup();
		app = built.app;
		const badEmail = await app.inject({
			method: 'POST',
			url: `${BASE}/sessions`,
			headers: authHeader(built.staff.token),
			payload: { channel: 'email', contactAddress: 'not-an-address' },
		});
		expect(badEmail.statusCode).toBe(400);
		expect(badEmail.json().message).toBe('Enter a valid email address.');

		const badPhone = await app.inject({
			method: 'POST',
			url: `${BASE}/sessions`,
			headers: authHeader(built.staff.token),
			payload: { channel: 'sms', contactAddress: 'call me maybe' },
		});
		expect(badPhone.statusCode).toBe(400);
		expect(badPhone.json().message).toContain('phone number');
	});

	it('404s an unknown customer, and 400s an unknown channel', async () => {
		const built = await setup();
		app = built.app;
		const unknown = await app.inject({
			method: 'POST',
			url: `${BASE}/sessions`,
			headers: authHeader(built.staff.token),
			payload: { channel: 'email', customerId: 'no-such-customer' },
		});
		expect(unknown.statusCode).toBe(404);

		const phone = await app.inject({
			method: 'POST',
			url: `${BASE}/sessions`,
			headers: authHeader(built.staff.token),
			// `phone` is a real conversation channel, but it has no transport to capture.
			payload: { channel: 'phone', contactAddress: CUSTOMER_E164 },
		});
		expect(phone.statusCode).toBe(400);
	});

	it('conflicts on a second session for the same contact, leaving no orphan conversation', async () => {
		const built = await setup();
		app = built.app;
		await openSession(app, built.staff.token, {
			channel: 'email',
			contactAddress: CUSTOMER_EMAIL,
		});
		const before = await built.repos.conversations.list({
			accountId: built.accountId,
			page: 1,
			pageSize: 50,
		});
		const duplicate = await app.inject({
			method: 'POST',
			url: `${BASE}/sessions`,
			headers: authHeader(built.staff.token),
			payload: { channel: 'email', contactAddress: CUSTOMER_EMAIL },
		});
		expect(duplicate.statusCode).toBe(409);
		expect(duplicate.json().message).toContain('already exists on email');
		// The conversation this losing request opened was rolled back.
		const after = await built.repos.conversations.list({
			accountId: built.accountId,
			page: 1,
			pageSize: 50,
		});
		expect(after.total).toBe(before.total);

		// The same contact on another channel is a different session, though.
		const sms = await openSession(app, built.staff.token, {
			channel: 'sms',
			contactAddress: CUSTOMER_E164,
		});
		expect(sms.channel).toBe('sms');
	});

	it('cleans up the conversation when the thread create fails for any other reason', async () => {
		const built = await setup();
		app = built.app;
		const before = await built.repos.conversations.list({
			accountId: built.accountId,
			page: 1,
			pageSize: 50,
		});
		// A store failure that is NOT the duplicate-session conflict.
		const create = built.repos.agentThreads.create.bind(built.repos.agentThreads);
		built.repos.agentThreads.create = async () => {
			built.repos.agentThreads.create = create;
			throw new Error('agent-thread store is down (test)');
		};
		const failed = await app.inject({
			method: 'POST',
			url: `${BASE}/sessions`,
			headers: authHeader(built.staff.token),
			payload: { channel: 'email', contactAddress: CUSTOMER_EMAIL },
		});
		expect(failed.statusCode).toBe(500);
		// The conversation the failing request opened was rolled back with it.
		const after = await built.repos.conversations.list({
			accountId: built.accountId,
			page: 1,
			pageSize: 50,
		});
		expect(after.total).toBe(before.total);
		// The store recovered, so the same contact opens a session cleanly after.
		const session = await openSession(app, built.staff.token, {
			channel: 'email',
			contactAddress: CUSTOMER_EMAIL,
		});
		expect(session.contactAddress).toBe(CUSTOMER_EMAIL);
	});
});

describe('POST /v1/admin/agent-tester/sessions/:id/messages', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('runs a real scheduling exchange over sms, right through to a booked job', async () => {
		const built = await setup();
		app = built.app;
		const customer = await addCustomer(built.repos, built.accountId, { phone: CUSTOMER_PHONE });
		const session = await openSession(app, built.staff.token, {
			channel: 'sms',
			customerId: customer.id,
		});

		const asked = await sendAs(
			app,
			built.staff.token,
			session.id,
			'Can I get someone out to fix my water heater next week?',
		);
		expect(asked.statusCode).toBe(200);
		const offer = asked.json<TesterTurn>();
		expect(offer.outcome).toBe('offer_slots');
		expect(offer.delivery.text).toContain('1.');
		// A chat channel carries no subject or HTML.
		expect(offer.delivery.subject).toBeUndefined();
		expect(offer.delivery.html).toBeUndefined();
		expect(offer.session.state).toBe('slots_offered');
		expect(offer.messages.map((message) => message.author)).toEqual(['customer', 'rivus']);
		expect(offer.messages[0]?.body).toContain('water heater');
		expect(offer.session.snippet).not.toBe('');

		const picked = await sendAs(app, built.staff.token, session.id, '1');
		expect(picked.statusCode).toBe(200);
		const booked = picked.json<TesterTurn>();
		expect(booked.outcome).toBe('book');
		expect(booked.session.state).toBe('booked');
		expect(booked.session.bookedJobId).not.toBe('');
		expect(booked.delivery.text).not.toBe('');
		// The booking is a real job on the account's calendar…
		const { jobs, total } = await built.repos.jobs.list({
			accountId: built.accountId,
			page: 1,
			pageSize: 10,
		});
		expect(total).toBe(1);
		expect(jobs[0]?.id).toBe(booked.session.bookedJobId);
		expect(jobs[0]?.customerId).toBe(customer.id);
		// …and the transcript gained the inline note the team sees in the inbox.
		expect(
			booked.messages.some(
				(message) => message.author === 'note' && message.body.includes('Rivus booked'),
			),
		).toBe(true);

		// Nothing was actually delivered: the app's own transports saw zero sends.
		expect((app.deps.smsSender as RecordingSmsSender).messages).toHaveLength(0);
		expect((app.deps.whatsappSender as RecordingWhatsappSender).messages).toHaveLength(0);
		expect((app.deps.mailer as RecordingMailer).agentEmails).toHaveLength(0);
	});

	it('offers times over whatsapp without touching the real sender', async () => {
		const built = await setup();
		app = built.app;
		const customer = await addCustomer(built.repos, built.accountId, { phone: CUSTOMER_PHONE });
		const session = await openSession(app, built.staff.token, {
			channel: 'whatsapp',
			customerId: customer.id,
		});
		const response = await sendAs(app, built.staff.token, session.id, 'When are you free?');
		const turn = response.json<TesterTurn>();
		expect(turn.outcome).toBe('offer_slots');
		expect(turn.delivery.text).toContain('1.');
		expect((app.deps.whatsappSender as RecordingWhatsappSender).messages).toHaveLength(0);
	});

	it('nudges an unknown email contact to sign up, returning the rendered email', async () => {
		const built = await setup();
		app = built.app;
		const session = await openSession(app, built.staff.token, {
			channel: 'email',
			contactAddress: 'stranger@example.com',
			subject: 'Water heater',
		});
		const response = await sendAs(
			app,
			built.staff.token,
			session.id,
			'Hi! I need someone to look at my water heater.',
		);
		expect(response.statusCode).toBe(200);
		const turn = response.json<TesterTurn>();
		expect(turn.outcome).toBe('send_signup_link');
		expect(turn.session.state).toBe('awaiting_signup');
		// Email carries the real renderer's subject and design-system HTML card.
		expect(turn.delivery.subject).toBe('Re: Water heater');
		expect(turn.delivery.html).toContain('<!doctype html>');
		expect(turn.delivery.html).toContain(
			`/customers/join/${encodeURIComponent(built.staff.account.slug)}`,
		);
		expect(turn.delivery.text).toContain('stranger%40example.com');
		expect((app.deps.mailer as RecordingMailer).agentEmails).toHaveLength(0);
	});

	it('validates the message body', async () => {
		const built = await setup();
		app = built.app;
		const session = await openSession(app, built.staff.token, {
			channel: 'sms',
			contactAddress: CUSTOMER_E164,
		});
		for (const text of ['   ', 'x'.repeat(4001)]) {
			const response = await sendAs(app, built.staff.token, session.id, text);
			expect(response.statusCode).toBe(400);
		}
	});

	it('404s an unknown session and never crosses accounts', async () => {
		const built = await setup();
		app = built.app;
		const mine = await openSession(app, built.staff.token, {
			channel: 'sms',
			contactAddress: CUSTOMER_E164,
		});
		const other = await signupOwner(app, { email: 'other-staff@rivus.ai' });

		for (const [token, id] of [
			[built.staff.token, 'no-such-session'],
			[other.token, mine.id],
		] as const) {
			expect((await sendAs(app, token, id, 'hello?')).statusCode).toBe(404);
			const detail = await app.inject({
				method: 'GET',
				url: `${BASE}/sessions/${id}`,
				headers: authHeader(token),
			});
			expect(detail.statusCode).toBe(404);
			const deleted = await app.inject({
				method: 'DELETE',
				url: `${BASE}/sessions/${id}`,
				headers: authHeader(token),
			});
			expect(deleted.statusCode).toBe(404);
		}
	});

	it('treats a phone thread as no session at all', async () => {
		const built = await setup();
		app = built.app;
		// Voice threads exist, but there is no transport to capture, so the tester
		// can neither list nor drive them.
		const conversation = await built.repos.conversations.create(built.accountId, {
			contactName: 'Caller',
			channel: 'phone',
			customerId: '',
			contactPhone: CUSTOMER_E164,
			status: 'rivus_handling',
			tags: [],
			lastInvoice: '',
		});
		const thread = await built.repos.agentThreads.create({
			accountId: built.accountId,
			channel: 'phone',
			contactAddress: CUSTOMER_E164,
			conversationId: conversation.id,
			customerId: '',
			subject: '',
		});
		const detail = await app.inject({
			method: 'GET',
			url: `${BASE}/sessions/${thread.id}`,
			headers: authHeader(built.staff.token),
		});
		expect(detail.statusCode).toBe(404);
		expect((await sendAs(app, built.staff.token, thread.id, 'hi')).statusCode).toBe(404);
		const listed = await app.inject({
			method: 'GET',
			url: `${BASE}/sessions`,
			headers: authHeader(built.staff.token),
		});
		expect(listed.json<{ data: TesterSession[] }>().data).toEqual([]);
	});
});

describe('GET /v1/admin/agent-tester/sessions', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('lists every session most recently active first, with the joined fields', async () => {
		const built = await setup();
		app = built.app;
		const customer = await addCustomer(built.repos, built.accountId, { phone: CUSTOMER_PHONE });
		const first = await openSession(app, built.staff.token, {
			channel: 'email',
			contactAddress: CUSTOMER_EMAIL,
		});
		const second = await openSession(app, built.staff.token, {
			channel: 'sms',
			customerId: customer.id,
		});
		// Talking on the older session moves it back to the front.
		await sendAs(app, built.staff.token, first.id, 'Hello?');

		const response = await app.inject({
			method: 'GET',
			url: `${BASE}/sessions`,
			headers: authHeader(built.staff.token),
		});
		expect(response.statusCode).toBe(200);
		const { data } = response.json<{ data: TesterSession[] }>();
		expect(data.map((session) => session.id)).toEqual([first.id, second.id]);
		expect(data[0]).toMatchObject({
			channel: 'email',
			contactAddress: CUSTOMER_EMAIL,
			contactName: CUSTOMER_EMAIL,
			state: 'awaiting_signup',
		});
		expect(data[0]?.snippet).not.toBe('');
		// Another account's sessions are invisible here.
		const other = await signupOwner(app, { email: 'other-staff@rivus.ai' });
		const theirs = await app.inject({
			method: 'GET',
			url: `${BASE}/sessions`,
			headers: authHeader(other.token),
		});
		expect(theirs.json<{ data: TesterSession[] }>().data).toEqual([]);
	});

	it('serves the transcript on the detail route', async () => {
		const built = await setup();
		app = built.app;
		const session = await openSession(app, built.staff.token, {
			channel: 'sms',
			contactAddress: CUSTOMER_E164,
		});
		const fresh = await app.inject({
			method: 'GET',
			url: `${BASE}/sessions/${session.id}`,
			headers: authHeader(built.staff.token),
		});
		expect(fresh.statusCode).toBe(200);
		expect(fresh.json<{ session: TesterSession; messages: unknown[] }>()).toMatchObject({
			session: { id: session.id, state: 'new' },
			messages: [],
		});

		await sendAs(app, built.staff.token, session.id, 'Anyone there?');
		const talked = await app.inject({
			method: 'GET',
			url: `${BASE}/sessions/${session.id}`,
			headers: authHeader(built.staff.token),
		});
		const detail = talked.json<{ session: TesterSession; messages: Array<{ author: string }> }>();
		expect(detail.messages.map((message) => message.author)).toEqual(['customer', 'rivus']);
		expect(detail.session.state).toBe('awaiting_signup');
	});

	it('keeps serving a session whose conversation the team deleted', async () => {
		const built = await setup();
		app = built.app;
		const session = await openSession(app, built.staff.token, {
			channel: 'sms',
			contactAddress: CUSTOMER_E164,
		});
		await built.repos.conversations.delete(
			built.accountId,
			session.conversationId as ConversationId,
		);
		const response = await app.inject({
			method: 'GET',
			url: `${BASE}/sessions/${session.id}`,
			headers: authHeader(built.staff.token),
		});
		expect(response.statusCode).toBe(200);
		const detail = response.json<{ session: TesterSession; messages: unknown[] }>();
		// Nothing to join to, so the conversation-derived fields fall back.
		expect(detail.session).toMatchObject({ contactName: '', snippet: '' });
		expect(detail.session.lastMessageAt).toBe(detail.session.updatedAt);
		expect(detail.messages).toEqual([]);

		// The orchestrator re-links a fresh conversation on the next turn, and the
		// response reflects the re-read thread.
		const turn = (
			await sendAs(app, built.staff.token, session.id, 'Still there?')
		).json<TesterTurn>();
		expect(turn.session.conversationId).not.toBe(session.conversationId);
		expect(turn.messages.map((message) => message.author)).toEqual(['customer', 'rivus']);
	});
});

describe('DELETE /v1/admin/agent-tester/sessions/:id', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('resets the agent: thread and transcript both go, and the contact can start over', async () => {
		const built = await setup();
		app = built.app;
		const customer = await addCustomer(built.repos, built.accountId, { phone: CUSTOMER_PHONE });
		const session = await openSession(app, built.staff.token, {
			channel: 'sms',
			customerId: customer.id,
		});
		await sendAs(app, built.staff.token, session.id, 'When are you free?');
		const before = await built.repos.conversations.list({
			accountId: built.accountId,
			page: 1,
			pageSize: 50,
		});

		const deleted = await app.inject({
			method: 'DELETE',
			url: `${BASE}/sessions/${session.id}`,
			headers: authHeader(built.staff.token),
		});
		expect(deleted.statusCode).toBe(204);

		const gone = await app.inject({
			method: 'GET',
			url: `${BASE}/sessions/${session.id}`,
			headers: authHeader(built.staff.token),
		});
		expect(gone.statusCode).toBe(404);
		const after = await built.repos.conversations.list({
			accountId: built.accountId,
			page: 1,
			pageSize: 50,
		});
		expect(after.total).toBe(before.total - 1);
		expect(
			await built.repos.agentThreads.findByContact(built.accountId, 'sms', CUSTOMER_E164),
		).toBeNull();

		// Deleting twice is a 404, and the same contact can be opened fresh — with a
		// new id and none of the old state.
		const again = await app.inject({
			method: 'DELETE',
			url: `${BASE}/sessions/${session.id}`,
			headers: authHeader(built.staff.token),
		});
		expect(again.statusCode).toBe(404);
		const reopened = await openSession(app, built.staff.token, {
			channel: 'sms',
			customerId: customer.id,
		});
		expect(reopened.id).not.toBe(session.id);
		expect(reopened).toMatchObject({ state: 'new', bookedJobId: '' });
	});

	it('still deletes a session whose conversation is already gone', async () => {
		const built = await setup();
		app = built.app;
		const session = await openSession(app, built.staff.token, {
			channel: 'email',
			contactAddress: CUSTOMER_EMAIL,
		});
		await built.repos.conversations.delete(
			built.accountId,
			session.conversationId as ConversationId,
		);
		const deleted = await app.inject({
			method: 'DELETE',
			url: `${BASE}/sessions/${session.id}`,
			headers: authHeader(built.staff.token),
		});
		expect(deleted.statusCode).toBe(204);
		expect(
			await built.repos.agentThreads.findByContact(built.accountId, 'email', CUSTOMER_EMAIL),
		).toBeNull();
	});
});

describe('createTesterChannel', () => {
	it('reports an empty delivery until the agent sends something', async () => {
		const built = await setup();
		const harness = createTesterChannel(built.app.deps, 'email');
		expect(harness.deliveries).toEqual([]);
		expect(harness.lastDelivery()).toEqual({ text: '' });
		await built.app.close();
	});

	it('gives every request its own capture buffer', async () => {
		const built = await setup();
		const first = createTesterChannel(built.app.deps, 'sms');
		const second = createTesterChannel(built.app.deps, 'sms');
		first.deliveries.push({ text: 'from the first request' });
		expect(second.deliveries).toEqual([]);
		expect(second.lastDelivery()).toEqual({ text: '' });
		await built.app.close();
	});
});
