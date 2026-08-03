import type { AccountId, ConversationId, CreateCustomerInput, Customer } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import type { InMemoryRepositories } from '../src/repositories/memory';
import { createTesterChannel } from '../src/services/agent/tester';
import type { TesterSpeech, TesterVoiceService } from '../src/services/agent/tester-voice';
import type { AppDeps } from '../src/types';
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
async function setup(overrides: Partial<AppDeps> = {}): Promise<Harness> {
	const { app, repos } = await buildTestAppWithRepos({ config: devConfig(), ...overrides });
	const staff = await signupOwner(app, { email: STAFF_EMAIL, businessName: 'Rivus HQ' });
	return { app, repos, staff, accountId: staff.account.id as AccountId };
}

/**
 * A stand-in for the OpenAI speech service: records what it was asked to say and
 * what it was given to hear, so the routes can be driven end to end without a
 * provider. `transcript` is what it claims to have heard — '' is the silence
 * case the routes must pass through rather than treat as a failure.
 */
class FakeTesterVoice implements TesterVoiceService {
	readonly spoken: string[] = [];
	readonly heard: Uint8Array[] = [];
	transcript = 'My water heater is leaking';
	/** When set, the next call of either kind rejects (the provider-down path). */
	failNext = false;

	constructor(readonly enabled: boolean = true) {}

	async speak(text: string): Promise<TesterSpeech> {
		this.failIfAsked();
		this.spoken.push(text);
		return { audio: Buffer.from(`spoken:${text}`).toString('base64'), mediaType: 'audio/mpeg' };
	}

	async transcribe(audio: Uint8Array): Promise<string> {
		this.failIfAsked();
		this.heard.push(audio);
		return this.transcript;
	}

	private failIfAsked(): void {
		if (this.failNext) {
			this.failNext = false;
			throw new Error('speech provider is down (test)');
		}
	}
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
	/** Voice only: whether the simulated call keeps listening or hangs up. */
	call?: 'listen' | 'ended';
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
				`${BASE}/voice`,
				`${BASE}/sessions/{id}/speech`,
				`${BASE}/sessions/{id}/transcribe`,
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

	it('normalizes a customer’s free-text phone for every phone-shaped channel', async () => {
		const built = await setup();
		app = built.app;
		const customer = await addCustomer(built.repos, built.accountId, { phone: CUSTOMER_PHONE });
		for (const channel of ['sms', 'whatsapp', 'phone'] as const) {
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

		const notAChannel = await app.inject({
			method: 'POST',
			url: `${BASE}/sessions`,
			headers: authHeader(built.staff.token),
			// The agent answers on four channels; the fax machine is not one of them.
			payload: { channel: 'fax', contactAddress: CUSTOMER_E164 },
		});
		expect(notAChannel.statusCode).toBe(400);
		expect(notAChannel.json().message).toContain('email, sms, whatsapp, or phone');
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
		// A chat channel carries no subject or HTML — and no call to leave open or
		// hang up, so it reports no call flow at all.
		expect(offer.delivery.subject).toBeUndefined();
		expect(offer.delivery.html).toBeUndefined();
		expect(offer.call).toBeUndefined();
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

	it('serves a phone session like any other — it lists, and the detail route has it', async () => {
		const built = await setup();
		app = built.app;
		// A call is a first-class session now: the same thread + conversation pair,
		// opened on the caller's raw number.
		const session = await openSession(app, built.staff.token, {
			channel: 'phone',
			contactAddress: '(555) 123-4567',
		});
		expect(session).toMatchObject({
			channel: 'phone',
			contactAddress: CUSTOMER_E164,
			state: 'new',
			// A call has no subject to thread under.
			subject: '',
		});
		const detail = await app.inject({
			method: 'GET',
			url: `${BASE}/sessions/${session.id}`,
			headers: authHeader(built.staff.token),
		});
		expect(detail.statusCode).toBe(200);
		expect(detail.json<{ session: TesterSession }>().session.id).toBe(session.id);
		const listed = await app.inject({
			method: 'GET',
			url: `${BASE}/sessions`,
			headers: authHeader(built.staff.token),
		});
		expect(listed.json<{ data: TesterSession[] }>().data.map((item) => item.id)).toEqual([
			session.id,
		]);
	});

	it('runs a spoken scheduling call, normalizing the pick and ending the call on the booking', async () => {
		const built = await setup();
		app = built.app;
		const customer = await addCustomer(built.repos, built.accountId, { phone: CUSTOMER_PHONE });
		const session = await openSession(app, built.staff.token, {
			channel: 'phone',
			customerId: customer.id,
		});

		const asked = await sendAs(
			app,
			built.staff.token,
			session.id,
			'My water heater is leaking, when can someone come out?',
		);
		expect(asked.statusCode).toBe(200);
		const offer = asked.json<TesterTurn>();
		expect(offer.outcome).toBe('offer_slots');
		// The call stays open, and the times arrive as the spoken menu — not the
		// numbered list the chat channels render.
		expect(offer.call).toBe('listen');
		expect(offer.delivery.text).toContain('Option 1');
		expect(offer.session.state).toBe('slots_offered');
		expect(offer.messages.map((message) => message.author)).toEqual(['customer', 'rivus']);

		// Said aloud, a menu pick comes back in words; the shared voice core is what
		// turns it into the "1" the engine parses.
		const picked = await sendAs(app, built.staff.token, session.id, 'option one');
		expect(picked.statusCode).toBe(200);
		const booked = picked.json<TesterTurn>();
		expect(booked.outcome).toBe('book');
		expect(booked.call).toBe('ended');
		expect(booked.session.state).toBe('booked');
		expect(booked.session.bookedJobId).not.toBe('');
		// The delivery is what the caller HEARS — the confirmation plus the sign-off
		// the call ends on…
		expect(booked.delivery.text.endsWith('Thanks for calling. Goodbye!')).toBe(true);
		// …while the transcript keeps only the utterance the agent composed.
		const spoken = booked.messages.filter((message) => message.author === 'rivus').at(-1);
		expect(spoken?.body).not.toContain('Goodbye!');
		expect(booked.messages.some((message) => message.body === 'option 1')).toBe(true);

		// The booking is a real job on the account's calendar.
		const { jobs, total } = await built.repos.jobs.list({
			accountId: built.accountId,
			page: 1,
			pageSize: 10,
		});
		expect(total).toBe(1);
		expect(jobs[0]?.id).toBe(booked.session.bookedJobId);
		expect(jobs[0]?.customerId).toBe(customer.id);

		// A simulated call reaches nobody: no text, no WhatsApp message, no email.
		expect((app.deps.smsSender as RecordingSmsSender).messages).toHaveLength(0);
		expect((app.deps.whatsappSender as RecordingWhatsappSender).messages).toHaveLength(0);
		expect((app.deps.mailer as RecordingMailer).agentEmails).toHaveLength(0);
	});

	it('sends an unknown caller to signup with a spoken link, then ends the call', async () => {
		const built = await setup();
		app = built.app;
		const session = await openSession(app, built.staff.token, {
			channel: 'phone',
			contactAddress: CUSTOMER_E164,
		});
		const response = await sendAs(app, built.staff.token, session.id, 'Can I book something?');
		expect(response.statusCode).toBe(200);
		const turn = response.json<TesterTurn>();
		expect(turn.outcome).toBe('send_signup_link');
		expect(turn.call).toBe('ended');
		expect(turn.session.state).toBe('awaiting_signup');
		// Nobody dictates a protocol: the voice renderer reads the address out.
		expect(turn.delivery.text).toContain(
			`/customers/join/${encodeURIComponent(built.staff.account.slug)}`,
		);
		expect(turn.delivery.text).not.toContain('https://');
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

	it('stays retryable when the transcript delete fails: the session survives to be deleted again', async () => {
		const built = await setup();
		app = built.app;
		const session = await openSession(app, built.staff.token, {
			channel: 'email',
			contactAddress: CUSTOMER_EMAIL,
		});
		// The transcript store fails once; the thread — the session's identity —
		// must survive it, or the orphaned conversation could never be deleted
		// through the tester again.
		const remove = built.repos.conversations.delete.bind(built.repos.conversations);
		built.repos.conversations.delete = async () => {
			built.repos.conversations.delete = remove;
			throw new Error('conversation store is down (test)');
		};
		const failed = await app.inject({
			method: 'DELETE',
			url: `${BASE}/sessions/${session.id}`,
			headers: authHeader(built.staff.token),
		});
		expect(failed.statusCode).toBe(500);
		const stillThere = await app.inject({
			method: 'GET',
			url: `${BASE}/sessions/${session.id}`,
			headers: authHeader(built.staff.token),
		});
		expect(stillThere.statusCode).toBe(200);

		// The store recovered: the retry removes both halves.
		const retried = await app.inject({
			method: 'DELETE',
			url: `${BASE}/sessions/${session.id}`,
			headers: authHeader(built.staff.token),
		});
		expect(retried.statusCode).toBe(204);
		expect(
			await built.repos.agentThreads.findByContact(built.accountId, 'email', CUSTOMER_EMAIL),
		).toBeNull();
		expect(
			await built.repos.conversations.findById(
				built.accountId,
				session.conversationId as ConversationId,
			),
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

describe('GET /v1/admin/agent-tester/voice', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('reports speech as available when the deployment has a provider', async () => {
		const built = await setup({ testerVoice: new FakeTesterVoice() });
		app = built.app;
		const response = await app.inject({
			method: 'GET',
			url: `${BASE}/voice`,
			headers: authHeader(built.staff.token),
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ enabled: true });
	});

	it('reports it unavailable without a key, so the app keeps its own fallback', async () => {
		// The default test app has no OpenAI key — exactly an unconfigured deployment.
		const built = await setup();
		app = built.app;
		const response = await app.inject({
			method: 'GET',
			url: `${BASE}/voice`,
			headers: authHeader(built.staff.token),
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ enabled: false });
	});

	it('is gated like the rest of the tester (401 / 403)', async () => {
		const built = await setup({ testerVoice: new FakeTesterVoice() });
		app = built.app;
		expect((await app.inject({ method: 'GET', url: `${BASE}/voice` })).statusCode).toBe(401);
		const civilian = await signupOwner(app, { email: 'owner@acme.test' });
		const forbidden = await app.inject({
			method: 'GET',
			url: `${BASE}/voice`,
			headers: authHeader(civilian.token),
		});
		expect(forbidden.statusCode).toBe(403);
	});
});

describe('POST /v1/admin/agent-tester/sessions/:id/speech', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	/** A phone session plus the fake speech service the route will call. */
	async function callSetup(voice: FakeTesterVoice = new FakeTesterVoice()) {
		const built = await setup({ testerVoice: voice });
		const session = await openSession(built.app, built.staff.token, {
			channel: 'phone',
			contactAddress: CUSTOMER_E164,
		});
		return { ...built, session, voice };
	}

	function speak(instance: FastifyInstance, token: string, id: string, text: string) {
		return instance.inject({
			method: 'POST',
			url: `${BASE}/sessions/${id}/speech`,
			headers: authHeader(token),
			payload: { text },
		});
	}

	it('synthesizes the line the caller would hear and hands back playable audio', async () => {
		const built = await callSetup();
		app = built.app;
		const line = 'You’re all set for Tuesday at 9am. Thanks for calling. Goodbye!';

		const response = await speak(app, built.staff.token, built.session.id, line);

		expect(response.statusCode).toBe(200);
		const body = response.json<{ audio: string; mediaType: string }>();
		expect(body.mediaType).toBe('audio/mpeg');
		expect(Buffer.from(body.audio, 'base64').toString()).toBe(`spoken:${line}`);
		// The whole spoken line goes through untouched — sign-off included, since
		// that is what the caller actually hears.
		expect(built.voice.spoken).toEqual([line]);
	});

	it('refuses an empty line before reaching the provider', async () => {
		const built = await callSetup();
		app = built.app;
		expect((await speak(app, built.staff.token, built.session.id, '   ')).statusCode).toBe(400);
		expect(
			(await speak(app, built.staff.token, built.session.id, 'x'.repeat(4001))).statusCode,
		).toBe(400);
		expect(built.voice.spoken).toEqual([]);
	});

	it('404s an unknown session and never crosses accounts', async () => {
		const built = await callSetup();
		app = built.app;
		const other = await signupOwner(app, { email: 'other-staff@rivus.ai' });
		expect((await speak(app, built.staff.token, 'no-such-session', 'Hello?')).statusCode).toBe(404);
		expect((await speak(app, other.token, built.session.id, 'Hello?')).statusCode).toBe(404);
	});

	it('says which key is missing when the deployment has no speech (503)', async () => {
		const built = await callSetup(new FakeTesterVoice(false));
		app = built.app;
		const response = await speak(app, built.staff.token, built.session.id, 'Hello?');
		expect(response.statusCode).toBe(503);
		expect(response.json<{ message: string }>().message).toContain('OPENAI_API_KEY');
	});

	it('answers 502 when the provider fails — the tester itself is fine', async () => {
		const built = await callSetup();
		app = built.app;
		built.voice.failNext = true;
		const response = await speak(app, built.staff.token, built.session.id, 'Hello?');
		expect(response.statusCode).toBe(502);
		expect(response.json<{ message: string }>().message).toContain('Could not speak that line');
	});

	it('is gated like the rest of the tester (401 / 403)', async () => {
		const built = await callSetup();
		app = built.app;
		const anonymous = await app.inject({
			method: 'POST',
			url: `${BASE}/sessions/${built.session.id}/speech`,
			payload: { text: 'Hello?' },
		});
		expect(anonymous.statusCode).toBe(401);
		const civilian = await signupOwner(app, { email: 'owner@acme.test' });
		expect((await speak(app, civilian.token, built.session.id, 'Hello?')).statusCode).toBe(403);
	});
});

describe('POST /v1/admin/agent-tester/sessions/:id/transcribe', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	// The first bytes of a WebM container — what Chrome's recorder produces, and
	// what the route must hand through untouched for the format to be readable.
	const UTTERANCE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03]);

	async function callSetup(voice: FakeTesterVoice = new FakeTesterVoice()) {
		const built = await setup({ testerVoice: voice });
		const session = await openSession(built.app, built.staff.token, {
			channel: 'phone',
			contactAddress: CUSTOMER_E164,
		});
		return { ...built, session, voice };
	}

	function transcribe(instance: FastifyInstance, token: string, id: string, audio: string) {
		return instance.inject({
			method: 'POST',
			url: `${BASE}/sessions/${id}/transcribe`,
			headers: authHeader(token),
			payload: { audio },
		});
	}

	it('decodes the recording and reports what the caller said', async () => {
		const built = await callSetup();
		app = built.app;

		const response = await transcribe(
			app,
			built.staff.token,
			built.session.id,
			UTTERANCE.toString('base64'),
		);

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ text: 'My water heater is leaking' });
		// The provider gets the raw bytes back, since it reads the container from them.
		expect(built.voice.heard).toHaveLength(1);
		expect(Buffer.from(built.voice.heard[0] ?? new Uint8Array()).equals(UTTERANCE)).toBe(true);
	});

	it('passes silence through as an empty transcript, not an error', async () => {
		const voice = new FakeTesterVoice();
		voice.transcript = '';
		const built = await callSetup(voice);
		app = built.app;
		const response = await transcribe(
			app,
			built.staff.token,
			built.session.id,
			UTTERANCE.toString('base64'),
		);
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ text: '' });
	});

	it('refuses a body that carries no audio at all', async () => {
		const built = await callSetup();
		app = built.app;
		// An absent recording is caught by the schema; one that decodes to nothing
		// (all padding, or nothing base64 survives) by the route.
		expect((await transcribe(app, built.staff.token, built.session.id, '')).statusCode).toBe(400);
		expect((await transcribe(app, built.staff.token, built.session.id, '!!!!')).statusCode).toBe(
			400,
		);
		expect(built.voice.heard).toEqual([]);
	});

	it('refuses a recording past the utterance cap', async () => {
		const built = await callSetup();
		app = built.app;
		const response = await transcribe(
			app,
			built.staff.token,
			built.session.id,
			'A'.repeat(8 * 1024 * 1024 + 1),
		);
		expect(response.statusCode).toBe(400);
		expect(built.voice.heard).toEqual([]);
	});

	it('404s an unknown session and never crosses accounts', async () => {
		const built = await callSetup();
		app = built.app;
		const other = await signupOwner(app, { email: 'other-staff@rivus.ai' });
		const audio = UTTERANCE.toString('base64');
		expect((await transcribe(app, built.staff.token, 'no-such-session', audio)).statusCode).toBe(
			404,
		);
		expect((await transcribe(app, other.token, built.session.id, audio)).statusCode).toBe(404);
	});

	it('says which key is missing when the deployment has no speech (503)', async () => {
		const built = await callSetup(new FakeTesterVoice(false));
		app = built.app;
		const response = await transcribe(
			app,
			built.staff.token,
			built.session.id,
			UTTERANCE.toString('base64'),
		);
		expect(response.statusCode).toBe(503);
		expect(response.json<{ message: string }>().message).toContain('OPENAI_API_KEY');
	});

	it('answers 502 when the provider fails — the tester itself is fine', async () => {
		const built = await callSetup();
		app = built.app;
		built.voice.failNext = true;
		const response = await transcribe(
			app,
			built.staff.token,
			built.session.id,
			UTTERANCE.toString('base64'),
		);
		expect(response.statusCode).toBe(502);
		expect(response.json<{ message: string }>().message).toContain('Could not make out');
	});

	it('is gated like the rest of the tester (401 / 403)', async () => {
		const built = await callSetup();
		app = built.app;
		const audio = UTTERANCE.toString('base64');
		const anonymous = await app.inject({
			method: 'POST',
			url: `${BASE}/sessions/${built.session.id}/transcribe`,
			payload: { audio },
		});
		expect(anonymous.statusCode).toBe(401);
		const civilian = await signupOwner(app, { email: 'owner@acme.test' });
		expect((await transcribe(app, civilian.token, built.session.id, audio)).statusCode).toBe(403);
	});

	it('feeds the normal turn endpoint, so a spoken turn writes the same transcript', async () => {
		const built = await callSetup();
		app = built.app;
		const heard = await transcribe(
			app,
			built.staff.token,
			built.session.id,
			UTTERANCE.toString('base64'),
		);
		const { text } = heard.json<{ text: string }>();

		// The one thing that must stay true of voice mode: it is only an input to
		// the send path every typed turn already takes, so the transcript records
		// the spoken words exactly as it records typed ones.
		const turn = (await sendAs(app, built.staff.token, built.session.id, text)).json<TesterTurn>();
		expect(turn.messages.map((message) => message.author)).toEqual(['customer', 'rivus']);
		expect(turn.messages[0]?.body).toBe('My water heater is leaking');
		// And it is still a call: the turn reports where it left one.
		expect(turn.call).toBeDefined();
	});
});
