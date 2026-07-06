import { type AccountId, agentEmailLocalPart, type ConversationId } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryRepositories, type InMemoryRepositories } from '../src/repositories/memory';
import {
	addMember,
	authHeader,
	buildTestApp,
	buildTestAppWithRepos,
	RecordingMailer,
	type RecordingSmsSender,
	type RecordingWhatsappSender,
	signupOwner,
} from './helpers';

describe('conversation routes', () => {
	let app: FastifyInstance;
	let repos: InMemoryRepositories;
	let token: string;
	let accountId: string;

	beforeEach(async () => {
		({ app, repos } = await buildTestAppWithRepos());
		const owner = await signupOwner(app);
		token = owner.token;
		accountId = owner.account.id;
	});

	afterEach(async () => {
		await app.close();
	});

	function createConversation(extra: Record<string, unknown> = {}) {
		return app.inject({
			method: 'POST',
			url: '/v1/conversations',
			headers: authHeader(token),
			payload: { contactName: 'Dana Whitfield', channel: 'whatsapp', ...extra },
		});
	}

	/** Add a message straight through the repository (e.g. an inbound customer turn). */
	function addMessage(id: string, author: 'customer' | 'rivus' | 'agent' | 'note', body: string) {
		return repos.conversations.addMessage(accountId as AccountId, id as ConversationId, {
			author,
			body,
		});
	}

	function seedFaq(question: string, answer: string) {
		return repos.faqs.create(accountId as AccountId, {
			question,
			answer,
			category: '',
			status: 'published',
		});
	}

	it('requires authentication', async () => {
		const response = await app.inject({ method: 'GET', url: '/v1/conversations' });
		expect(response.statusCode).toBe(401);
	});

	it('creates a conversation with defaults', async () => {
		const response = await createConversation();

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			contactName: 'Dana Whitfield',
			channel: 'whatsapp',
			customerId: '',
			contactPhone: '',
			status: 'rivus_handling',
			snippet: '',
			tags: [],
			lastInvoice: '',
			pendingReply: '',
			flagReason: '',
		});
		expect(response.json().id).toBeTypeOf('string');
	});

	it('rejects a create without a contact name or channel (400)', async () => {
		expect((await createConversation({ contactName: '' })).statusCode).toBe(400);
		const noChannel = await app.inject({
			method: 'POST',
			url: '/v1/conversations',
			headers: authHeader(token),
			payload: { contactName: 'Nameless' },
		});
		expect(noChannel.statusCode).toBe(400);
	});

	it('rejects a create that links to a customer outside the account (400)', async () => {
		const response = await createConversation({ customerId: 'does-not-exist' });
		expect(response.statusCode).toBe(400);
	});

	it('links a conversation to an existing customer', async () => {
		const customer = await repos.customers.create(accountId as AccountId, {
			name: 'Priya Anand',
			email: '',
			phone: '(206) 555-0119',
			address: '',
			lifetimeValue: 0,
			balance: 0,
			notes: '',
		});
		const response = await createConversation({
			customerId: customer.id,
			contactName: 'Priya Anand',
		});
		expect(response.statusCode).toBe(201);
		expect(response.json().customerId).toBe(customer.id);
	});

	it('lists conversations newest-activity-first with pagination metadata', async () => {
		await createConversation({ contactName: 'one' });
		await createConversation({ contactName: 'two' });
		await createConversation({ contactName: 'three' });

		const response = await app.inject({
			method: 'GET',
			url: '/v1/conversations?page=1&pageSize=2',
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.data).toHaveLength(2);
		expect(body.data[0].contactName).toBe('three');
		expect(body.meta).toMatchObject({ total: 3, totalPages: 2, hasNextPage: true });
	});

	it('filters the list by status', async () => {
		await createConversation({ contactName: 'handled' });
		await createConversation({ contactName: 'flagged', status: 'needs_attention' });

		const response = await app.inject({
			method: 'GET',
			url: '/v1/conversations?status=needs_attention',
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().data).toHaveLength(1);
		expect(response.json().data[0].contactName).toBe('flagged');
	});

	it('fetches a conversation with its full transcript', async () => {
		const conversation = (await createConversation()).json();
		await addMessage(conversation.id, 'customer', 'Hi there');
		await addMessage(conversation.id, 'rivus', 'Hello!');

		const response = await app.inject({
			method: 'GET',
			url: `/v1/conversations/${conversation.id}`,
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.conversation.id).toBe(conversation.id);
		expect(body.conversation.snippet).toBe('Hello!');
		expect(body.messages.map((m: { body: string }) => m.body)).toEqual(['Hi there', 'Hello!']);
	});

	it('returns 404 for an unknown conversation', async () => {
		const response = await app.inject({
			method: 'GET',
			url: '/v1/conversations/missing',
			headers: authHeader(token),
		});
		expect(response.statusCode).toBe(404);
	});

	it('updates a conversation and rejects an empty update', async () => {
		const conversation = (await createConversation()).json();

		const updated = await app.inject({
			method: 'PATCH',
			url: `/v1/conversations/${conversation.id}`,
			headers: authHeader(token),
			payload: { tags: ['VIP'], status: 'resolved' },
		});
		expect(updated.statusCode).toBe(200);
		expect(updated.json()).toMatchObject({ tags: ['VIP'], status: 'resolved' });

		const empty = await app.inject({
			method: 'PATCH',
			url: `/v1/conversations/${conversation.id}`,
			headers: authHeader(token),
			payload: {},
		});
		expect(empty.statusCode).toBe(400);
	});

	it('rejects a patch that links to a missing customer (400)', async () => {
		const conversation = (await createConversation()).json();
		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/conversations/${conversation.id}`,
			headers: authHeader(token),
			payload: { customerId: 'nope' },
		});
		expect(response.statusCode).toBe(400);
	});

	it('deletes a conversation, after which it is gone', async () => {
		const conversation = (await createConversation()).json();
		const del = await app.inject({
			method: 'DELETE',
			url: `/v1/conversations/${conversation.id}`,
			headers: authHeader(token),
		});
		expect(del.statusCode).toBe(204);

		const get = await app.inject({
			method: 'GET',
			url: `/v1/conversations/${conversation.id}`,
			headers: authHeader(token),
		});
		expect(get.statusCode).toBe(404);
	});

	it('counts conversations that need a human for the badge', async () => {
		await createConversation({ contactName: 'a', status: 'needs_attention' });
		await createConversation({ contactName: 'b', status: 'needs_attention' });
		await createConversation({ contactName: 'c' });

		const response = await app.inject({
			method: 'GET',
			url: '/v1/conversations/needs-attention-count',
			headers: authHeader(token),
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ count: 2 });
	});

	describe('sending a team-member reply', () => {
		it('appends an agent message and clears a flagged thread', async () => {
			const conversation = (await createConversation({ status: 'needs_attention' })).json();
			await repos.conversations.setReviewState(
				accountId as AccountId,
				conversation.id as ConversationId,
				{ status: 'needs_attention', pendingReply: 'draft', flagReason: 'billing' },
			);

			const response = await app.inject({
				method: 'POST',
				url: `/v1/conversations/${conversation.id}/messages`,
				headers: authHeader(token),
				payload: { body: 'I will take this one personally.' },
			});

			expect(response.statusCode).toBe(201);
			const body = response.json();
			expect(body.messages.at(-1)).toMatchObject({
				author: 'agent',
				body: 'I will take this one personally.',
			});
			// A human handled it, so the thread is no longer waiting and the draft is cleared.
			expect(body.conversation).toMatchObject({
				status: 'rivus_handling',
				pendingReply: '',
				flagReason: '',
			});
		});

		it('rejects an empty message (400) and 404s an unknown thread', async () => {
			const conversation = (await createConversation()).json();
			const empty = await app.inject({
				method: 'POST',
				url: `/v1/conversations/${conversation.id}/messages`,
				headers: authHeader(token),
				payload: { body: '   ' },
			});
			expect(empty.statusCode).toBe(400);

			const missing = await app.inject({
				method: 'POST',
				url: '/v1/conversations/missing/messages',
				headers: authHeader(token),
				payload: { body: 'hello' },
			});
			expect(missing.statusCode).toBe(404);
		});
	});

	describe('letting Rivus reply', () => {
		it('409s when there is no customer message to answer', async () => {
			const conversation = (await createConversation()).json();
			const response = await app.inject({
				method: 'POST',
				url: `/v1/conversations/${conversation.id}/reply`,
				headers: authHeader(token),
			});
			expect(response.statusCode).toBe(409);
		});

		it('sends a grounded answer for an everyday question', async () => {
			await seedFaq('What are your business hours?', 'We are open Monday to Friday, 9 AM to 6 PM.');
			const conversation = (await createConversation()).json();
			await addMessage(conversation.id, 'customer', 'What are your hours?');

			const response = await app.inject({
				method: 'POST',
				url: `/v1/conversations/${conversation.id}/reply`,
				headers: authHeader(token),
			});

			expect(response.statusCode).toBe(200);
			const body = response.json();
			expect(body.conversation.status).toBe('rivus_handling');
			expect(body.conversation.pendingReply).toBe('');
			expect(body.messages.at(-1)).toMatchObject({ author: 'rivus' });
			expect(body.messages.at(-1).body).toContain('9 AM to 6 PM');
		});

		it('holds a billing question for human review', async () => {
			const conversation = (await createConversation()).json();
			await addMessage(conversation.id, 'customer', 'Can you explain the charge on my invoice?');

			const response = await app.inject({
				method: 'POST',
				url: `/v1/conversations/${conversation.id}/reply`,
				headers: authHeader(token),
			});

			expect(response.statusCode).toBe(200);
			const body = response.json();
			expect(body.conversation.status).toBe('needs_attention');
			expect(body.conversation.flagReason).toContain('billing dispute');
			// The draft is held, not appended to the visible transcript.
			expect(body.messages.every((m: { author: string }) => m.author !== 'rivus')).toBe(true);
		});

		it('holds a question the knowledge base cannot answer', async () => {
			const conversation = (await createConversation()).json();
			await addMessage(conversation.id, 'customer', 'Do you sell branded merchandise?');

			const response = await app.inject({
				method: 'POST',
				url: `/v1/conversations/${conversation.id}/reply`,
				headers: authHeader(token),
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().conversation.status).toBe('needs_attention');
			expect(response.json().conversation.flagReason).toContain("wasn't sure");
		});

		it('alerts other members when Rivus pauses, but not the actor', async () => {
			const teammate = await addMember(app, token, 'member', 'teammate@example.com');
			const conversation = (await createConversation({ contactName: 'Priya' })).json();
			await addMessage(conversation.id, 'customer', 'I want a refund for my last invoice.');

			await app.inject({
				method: 'POST',
				url: `/v1/conversations/${conversation.id}/reply`,
				headers: authHeader(token),
			});

			// Filter to inbox notifications so the owner's unrelated "invite accepted"
			// notice (from adding the teammate) doesn't confuse the assertion.
			const inboxNotices = async (asToken: string) => {
				const response = await app.inject({
					method: 'GET',
					url: '/v1/notifications',
					headers: authHeader(asToken),
				});
				return response
					.json()
					.data.filter((notice: { linkHref: string }) => notice.linkHref === '/inbox');
			};

			const theirs = await inboxNotices(teammate.token);
			const mine = await inboxNotices(token);
			expect(theirs).toHaveLength(1);
			expect(theirs[0]).toMatchObject({ title: 'A conversation needs you' });
			expect(mine).toHaveLength(0);
		});

		async function reply(id: string) {
			return app.inject({
				method: 'POST',
				url: `/v1/conversations/${id}/reply`,
				headers: authHeader(token),
			});
		}

		it('does not answer the same customer turn twice (idempotent)', async () => {
			await seedFaq('What are your business hours?', 'We are open Monday to Friday, 9 AM to 6 PM.');
			const conversation = (await createConversation()).json();
			await addMessage(conversation.id, 'customer', 'What are your hours?');

			expect((await reply(conversation.id)).statusCode).toBe(200);
			// The latest turn now has a Rivus answer, so a second call is a 409, not a dup.
			const second = await reply(conversation.id);
			expect(second.statusCode).toBe(409);
		});

		it('409s when the thread is already awaiting review', async () => {
			const conversation = (await createConversation()).json();
			await addMessage(conversation.id, 'customer', 'Can you refund my invoice?');
			expect((await reply(conversation.id)).statusCode).toBe(200); // holds for review
			expect((await reply(conversation.id)).statusCode).toBe(409); // already held
		});

		it('409s a thread whose latest turn is a note or agent reply, not a question', async () => {
			const noteOnly = (await createConversation()).json();
			await addMessage(noteOnly.id, 'note', 'Inbound call transcribed by Rivus');
			expect((await reply(noteOnly.id)).statusCode).toBe(409);

			const answered = (await createConversation()).json();
			await addMessage(answered.id, 'customer', 'Do you serve Bellevue?');
			await addMessage(answered.id, 'agent', 'Yes we do!');
			expect((await reply(answered.id)).statusCode).toBe(409);
		});
	});

	describe('approving a held draft', () => {
		async function flaggedConversation(pendingReply: string) {
			const conversation = (await createConversation()).json();
			await addMessage(conversation.id, 'customer', 'Question about my invoice.');
			await repos.conversations.setReviewState(
				accountId as AccountId,
				conversation.id as ConversationId,
				{ status: 'needs_attention', pendingReply, flagReason: 'billing' },
			);
			return conversation;
		}

		it('sends the held draft as-is and resumes Rivus', async () => {
			const conversation = await flaggedConversation('Here is the itemized breakdown.');
			const response = await app.inject({
				method: 'POST',
				url: `/v1/conversations/${conversation.id}/approve`,
				headers: authHeader(token),
				payload: {},
			});

			expect(response.statusCode).toBe(200);
			const body = response.json();
			expect(body.messages.at(-1)).toMatchObject({
				author: 'rivus',
				body: 'Here is the itemized breakdown.',
			});
			expect(body.conversation).toMatchObject({
				status: 'rivus_handling',
				pendingReply: '',
				flagReason: '',
			});
		});

		it('sends an edited reply instead of the draft', async () => {
			const conversation = await flaggedConversation('Original draft.');
			const response = await app.inject({
				method: 'POST',
				url: `/v1/conversations/${conversation.id}/approve`,
				headers: authHeader(token),
				payload: { body: 'My edited reply.' },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().messages.at(-1).body).toBe('My edited reply.');
		});

		it('rejects approving when there is nothing to send (400)', async () => {
			const conversation = await flaggedConversation('');
			const response = await app.inject({
				method: 'POST',
				url: `/v1/conversations/${conversation.id}/approve`,
				headers: authHeader(token),
				payload: {},
			});
			expect(response.statusCode).toBe(400);
		});

		it('409s approving a thread that is not awaiting review', async () => {
			// A normal (rivus_handling) thread has no held draft to approve; approving it
			// would otherwise inject a Rivus-authored message, bypassing /messages.
			const conversation = (await createConversation()).json();
			const response = await app.inject({
				method: 'POST',
				url: `/v1/conversations/${conversation.id}/approve`,
				headers: authHeader(token),
				payload: { body: 'sneaky' },
			});
			expect(response.statusCode).toBe(409);
		});
	});

	describe('review-state lifecycle', () => {
		it('a human reply leaves a non-flagged thread untouched', async () => {
			const conversation = (await createConversation()).json();
			const response = await app.inject({
				method: 'POST',
				url: `/v1/conversations/${conversation.id}/messages`,
				headers: authHeader(token),
				payload: { body: 'Following up here.' },
			});
			expect(response.statusCode).toBe(201);
			expect(response.json().conversation).toMatchObject({
				status: 'rivus_handling',
				pendingReply: '',
				flagReason: '',
			});
		});

		it('a status change away from needs_attention clears the held draft', async () => {
			const conversation = (await createConversation({ status: 'needs_attention' })).json();
			await repos.conversations.setReviewState(
				accountId as AccountId,
				conversation.id as ConversationId,
				{ status: 'needs_attention', pendingReply: 'a held draft', flagReason: 'billing' },
			);

			const response = await app.inject({
				method: 'PATCH',
				url: `/v1/conversations/${conversation.id}`,
				headers: authHeader(token),
				payload: { status: 'resolved' },
			});
			expect(response.statusCode).toBe(200);
			expect(response.json()).toMatchObject({
				status: 'resolved',
				pendingReply: '',
				flagReason: '',
			});
		});

		it('a note does not change the list snippet but joins the transcript', async () => {
			const conversation = (await createConversation()).json();
			await addMessage(conversation.id, 'customer', 'Hi there');
			await addMessage(conversation.id, 'rivus', 'Hello!');
			await addMessage(conversation.id, 'note', 'Rivus booked a visit');

			const detail = await app.inject({
				method: 'GET',
				url: `/v1/conversations/${conversation.id}`,
				headers: authHeader(token),
			});
			// The snippet stays the last real reply, not the note...
			expect(detail.json().conversation.snippet).toBe('Hello!');
			// ...but the note is still in the transcript.
			expect(detail.json().messages.map((m: { body: string }) => m.body)).toContain(
				'Rivus booked a visit',
			);
		});
	});

	it('does not leak conversations across accounts on any route', async () => {
		const conversation = (await createConversation()).json();
		await addMessage(conversation.id, 'customer', 'private question');
		const otherToken = (await signupOwner(app)).token;
		const headers = authHeader(otherToken);
		const url = (path: string) => `/v1/conversations/${conversation.id}${path}`;

		expect((await app.inject({ method: 'GET', url: url(''), headers })).statusCode).toBe(404);
		expect((await app.inject({ method: 'DELETE', url: url(''), headers })).statusCode).toBe(404);
		// The mutating sub-routes must be account-scoped too (valid bodies so they reach
		// the handler's own-conversation check rather than failing body validation first).
		expect(
			(await app.inject({ method: 'POST', url: url('/messages'), headers, payload: { body: 'x' } }))
				.statusCode,
		).toBe(404);
		expect((await app.inject({ method: 'POST', url: url('/reply'), headers })).statusCode).toBe(
			404,
		);
		expect(
			(await app.inject({ method: 'POST', url: url('/approve'), headers, payload: {} })).statusCode,
		).toBe(404);
	});
});

describe('conversation list isolation', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	it("does not show one account's conversations to another", async () => {
		const owner = await signupOwner(app);
		await app.inject({
			method: 'POST',
			url: '/v1/conversations',
			headers: authHeader(owner.token),
			payload: { contactName: 'Private', channel: 'sms' },
		});

		const other = await signupOwner(app);
		const response = await app.inject({
			method: 'GET',
			url: '/v1/conversations',
			headers: authHeader(other.token),
		});
		expect(response.json().data).toHaveLength(0);
	});
});

describe('inbox replies dispatch email on the email channel', () => {
	let app: FastifyInstance;
	let repos: InMemoryRepositories;
	let token: string;
	let accountId: AccountId;
	let slug: string;

	beforeEach(async () => {
		({ app, repos } = await buildTestAppWithRepos());
		const owner = await signupOwner(app);
		token = owner.token;
		accountId = owner.account.id as AccountId;
		slug = owner.account.slug;
	});

	afterEach(async () => {
		await app.close();
	});

	function outbox(instance: FastifyInstance = app): RecordingMailer {
		return instance.deps.mailer as RecordingMailer;
	}

	/** Open an email conversation paired with an agent thread, the way the webhook does. */
	async function seedEmailThread(
		options: { subject?: string; lastMessageId?: string; address?: string } = {},
	) {
		const address = options.address ?? 'dana@example.com';
		const conversation = await repos.conversations.create(accountId, {
			contactName: 'Dana Fox',
			channel: 'email',
			customerId: '',
			contactPhone: '',
			status: 'rivus_handling',
			tags: [],
			lastInvoice: '',
		});
		const thread = await repos.agentThreads.create({
			accountId,
			channel: 'email',
			contactAddress: address,
			conversationId: conversation.id,
			customerId: '',
			subject: options.subject ?? 'Water heater',
		});
		if (options.lastMessageId) {
			await repos.agentThreads.update(accountId, thread.id, {
				lastExternalMessageId: options.lastMessageId,
			});
		}
		return conversation;
	}

	it("emails a team member's reply to the customer, threaded into the conversation", async () => {
		const conversation = await seedEmailThread({
			subject: 'Water heater',
			lastMessageId: '<m1@mail.example.com>',
		});

		const response = await app.inject({
			method: 'POST',
			url: `/v1/conversations/${conversation.id}/messages`,
			headers: authHeader(token),
			payload: { body: 'Hi this is Jared. We can book you then.' },
		});

		expect(response.statusCode).toBe(201);
		// Recorded in the transcript as a human reply...
		expect(response.json().messages.at(-1)).toMatchObject({
			author: 'agent',
			body: 'Hi this is Jared. We can book you then.',
		});
		// ...and actually sent as an email from the account's own agent address.
		expect(outbox().agentEmails).toHaveLength(1);
		const sent = outbox().agentEmails[0];
		expect(sent?.to).toBe('dana@example.com');
		expect(sent?.from).toContain(`<${agentEmailLocalPart(slug, accountId)}@riv.us>`);
		expect(sent?.subject).toBe('Re: Water heater');
		expect(sent?.text).toContain('We can book you then.');
		expect(sent?.html).toContain('We can book you then.');
		// Threaded under the customer's last inbound message.
		expect(sent?.inReplyTo).toBe('<m1@mail.example.com>');
		expect(sent?.references).toEqual(['<m1@mail.example.com>']);
	});

	it('renders CRLF replies as separate paragraphs without stray carriage returns', async () => {
		const conversation = await seedEmailThread();
		// A reply typed in a Windows/native mail client arrives with CRLF endings:
		// a blank line between paragraphs, a single break within one.
		const response = await app.inject({
			method: 'POST',
			url: `/v1/conversations/${conversation.id}/messages`,
			headers: authHeader(token),
			payload: { body: 'Line one.\r\n\r\nLine two.\r\nStill line two.' },
		});

		expect(response.statusCode).toBe(201);
		const sent = outbox().agentEmails[0];
		// The blank line splits paragraphs; the single break becomes a <br> — and no
		// literal carriage return leaks into the HTML.
		expect(sent?.html).toContain('>Line one.</p>');
		expect(sent?.html).toContain('>Line two.<br>Still line two.</p>');
		expect(sent?.html).not.toContain('\r');
	});

	it('splits paragraphs even when the blank line carries trailing whitespace', async () => {
		const conversation = await seedEmailThread();
		// Some clients leave spaces/tabs on the "blank" separator line.
		const response = await app.inject({
			method: 'POST',
			url: `/v1/conversations/${conversation.id}/messages`,
			headers: authHeader(token),
			payload: { body: 'First.\r\n \r\nSecond.' },
		});

		expect(response.statusCode).toBe(201);
		const sent = outbox().agentEmails[0];
		// Rendered as two separate paragraphs, not one run-on block.
		expect(sent?.html).toContain('>First.</p>');
		expect(sent?.html).toContain('>Second.</p>');
	});

	it('emails the held draft when a flagged reply is approved', async () => {
		const conversation = await seedEmailThread();
		await repos.conversations.setReviewState(accountId, conversation.id as ConversationId, {
			status: 'needs_attention',
			pendingReply: "You're all set for Monday at 9.",
			flagReason: 'billing',
		});

		const response = await app.inject({
			method: 'POST',
			url: `/v1/conversations/${conversation.id}/approve`,
			headers: authHeader(token),
			payload: {},
		});

		expect(response.statusCode).toBe(200);
		expect(outbox().agentEmails).toHaveLength(1);
		expect(outbox().agentEmails[0]?.text).toContain('all set for Monday');
	});

	it('emails a grounded answer when a human lets Rivus reply', async () => {
		await repos.faqs.create(accountId, {
			question: 'What are your hours?',
			answer: 'We are open Monday to Friday, 9 AM to 6 PM.',
			category: '',
			status: 'published',
		});
		const conversation = await seedEmailThread();
		await repos.conversations.addMessage(accountId, conversation.id as ConversationId, {
			author: 'customer',
			body: 'What are your hours?',
		});

		const response = await app.inject({
			method: 'POST',
			url: `/v1/conversations/${conversation.id}/reply`,
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		expect(outbox().agentEmails).toHaveLength(1);
		expect(outbox().agentEmails[0]?.text).toContain('9 AM to 6 PM');
	});

	it('does not send email for a reply on a non-email channel', async () => {
		const conversation = (
			await app.inject({
				method: 'POST',
				url: '/v1/conversations',
				headers: authHeader(token),
				payload: { contactName: 'Dana Fox', channel: 'whatsapp' },
			})
		).json();

		const response = await app.inject({
			method: 'POST',
			url: `/v1/conversations/${conversation.id}/messages`,
			headers: authHeader(token),
			payload: { body: 'Following up here.' },
		});

		expect(response.statusCode).toBe(201);
		expect(outbox().agentEmails).toHaveLength(0);
	});

	it('surfaces a delivery failure and records nothing, so the reply can be retried', async () => {
		class ThrowingMailer extends RecordingMailer {
			override async sendAgentEmail(_email: Parameters<RecordingMailer['sendAgentEmail']>[0]) {
				throw new Error('Resend rejected the email (status 500)');
			}
		}
		const failingRepos = createInMemoryRepositories();
		const failingApp = await buildTestApp({ ...failingRepos, mailer: new ThrowingMailer() });
		const owner = await signupOwner(failingApp);
		const failAccountId = owner.account.id as AccountId;
		const conversation = await failingRepos.conversations.create(failAccountId, {
			contactName: 'Dana Fox',
			channel: 'email',
			customerId: '',
			contactPhone: '',
			status: 'rivus_handling',
			tags: [],
			lastInvoice: '',
		});
		await failingRepos.agentThreads.create({
			accountId: failAccountId,
			channel: 'email',
			contactAddress: 'dana@example.com',
			conversationId: conversation.id,
			customerId: '',
			subject: 'Water heater',
		});

		const response = await failingApp.inject({
			method: 'POST',
			url: `/v1/conversations/${conversation.id}/messages`,
			headers: authHeader(owner.token),
			payload: { body: 'This should not be recorded if the email fails.' },
		});

		expect(response.statusCode).toBe(500);
		// The transcript stayed empty — nothing recorded for an email that never sent.
		const messages = await failingRepos.conversations.listMessages(failAccountId, conversation.id);
		expect(messages).toEqual([]);

		await failingApp.close();
	});
});

describe('conversation reply-out over WhatsApp', () => {
	const BIZ = '+15550001111';
	const SENDER = '+15559990000';

	async function openWhatsappConversation() {
		const { app, repos } = await buildTestAppWithRepos();
		const owner = await signupOwner(app);
		const accountId = owner.account.id as AccountId;
		await repos.accounts.setChannelConfig(accountId, 'whatsapp', {
			enabled: true,
			address: BIZ,
			providerRef: 'zwa_1',
		});
		// An inbound WhatsApp message opens the conversation + agent thread.
		await app.inject({
			method: 'POST',
			url: '/v1/channels/whatsapp/inbound',
			payload: {
				type: 'whatsapp.message.received',
				data: { to: BIZ, from: SENDER, text: 'Hi', messageId: 'wamid.1', profileName: 'Dana' },
			},
		});
		const list = await app.inject({
			method: 'GET',
			url: '/v1/conversations',
			headers: authHeader(owner.token),
		});
		const convo = (list.json().data as Array<{ id: string; channel: string }>).find(
			(c) => c.channel === 'whatsapp',
		);
		const sender = app.deps.whatsappSender as RecordingWhatsappSender;
		return { app, repos, owner, accountId, convo, sender };
	}

	it('sends a human reply out over WhatsApp', async () => {
		const { app, owner, convo, sender } = await openWhatsappConversation();
		expect(convo).toBeDefined();
		const before = sender.messages.length;
		const res = await app.inject({
			method: 'POST',
			url: `/v1/conversations/${convo?.id}/messages`,
			headers: authHeader(owner.token),
			payload: { body: 'See you then!' },
		});
		expect(res.statusCode).toBe(201);
		expect(sender.messages.length).toBe(before + 1);
		expect(sender.messages.at(-1)).toMatchObject({ from: BIZ, to: SENDER, text: 'See you then!' });
		await app.close();
	});

	it('records but does not send when the channel is disabled', async () => {
		const { app, repos, owner, accountId, convo, sender } = await openWhatsappConversation();
		await repos.accounts.setChannelConfig(accountId, 'whatsapp', {
			enabled: false,
			address: BIZ,
			providerRef: 'zwa_1',
		});
		const before = sender.messages.length;
		const res = await app.inject({
			method: 'POST',
			url: `/v1/conversations/${convo?.id}/messages`,
			headers: authHeader(owner.token),
			payload: { body: 'See you then!' },
		});
		expect(res.statusCode).toBe(201);
		// Recorded in the transcript, but nothing left the building.
		expect(sender.messages.length).toBe(before);
		const detail = res.json() as { messages: Array<{ author: string; body: string }> };
		expect(detail.messages.some((m) => m.author === 'agent' && m.body === 'See you then!')).toBe(
			true,
		);
		await app.close();
	});
});

describe('conversation reply-out over SMS', () => {
	const BIZ = '+15550002222';
	const SENDER = '+15559990000';

	async function openSmsConversation() {
		const { app, repos } = await buildTestAppWithRepos();
		const owner = await signupOwner(app);
		const accountId = owner.account.id as AccountId;
		await repos.accounts.setChannelConfig(accountId, 'sms', {
			enabled: true,
			address: BIZ,
			providerRef: '15550002222',
		});
		// An inbound text opens the conversation + agent thread.
		await app.inject({
			method: 'POST',
			url: '/v1/channels/sms/plivo/inbound',
			payload: {
				From: '15559990000',
				To: '15550002222',
				Type: 'sms',
				Text: 'Hi',
				MessageUUID: 'sms-conv-1',
			},
		});
		const list = await app.inject({
			method: 'GET',
			url: '/v1/conversations',
			headers: authHeader(owner.token),
		});
		const convo = (list.json().data as Array<{ id: string; channel: string }>).find(
			(c) => c.channel === 'sms',
		);
		const sender = app.deps.smsSender as RecordingSmsSender;
		return { app, repos, owner, accountId, convo, sender };
	}

	it('sends a human reply out over SMS', async () => {
		const { app, owner, convo, sender } = await openSmsConversation();
		expect(convo).toBeDefined();
		const before = sender.messages.length;
		const res = await app.inject({
			method: 'POST',
			url: `/v1/conversations/${convo?.id}/messages`,
			headers: authHeader(owner.token),
			payload: { body: 'See you then!' },
		});
		expect(res.statusCode).toBe(201);
		expect(sender.messages.length).toBe(before + 1);
		expect(sender.messages.at(-1)).toMatchObject({ from: BIZ, to: SENDER, text: 'See you then!' });
		await app.close();
	});

	it('records but does not send when texting is disabled', async () => {
		const { app, repos, owner, accountId, convo, sender } = await openSmsConversation();
		await repos.accounts.setChannelConfig(accountId, 'sms', {
			enabled: false,
			address: BIZ,
			providerRef: '15550002222',
		});
		const before = sender.messages.length;
		const res = await app.inject({
			method: 'POST',
			url: `/v1/conversations/${convo?.id}/messages`,
			headers: authHeader(owner.token),
			payload: { body: 'See you then!' },
		});
		expect(res.statusCode).toBe(201);
		expect(sender.messages.length).toBe(before);
		const detail = res.json() as { messages: Array<{ author: string; body: string }> };
		expect(detail.messages.some((m) => m.author === 'agent' && m.body === 'See you then!')).toBe(
			true,
		);
		await app.close();
	});
});
