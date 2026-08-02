import type { AccountId } from '@rivus/core';
import { describe, expect, it, vi } from 'vitest';
import type { ChannelCapabilities } from '../src/services/agent/channel';
import { renderChatResponse } from '../src/services/agent/chat-renderer';
import { composeAgentResponse, renderResponseText } from '../src/services/agent/response';
import { parseZernioInbound, WHATSAPP_MESSAGE_EVENT } from '../src/services/agent/whatsapp/inbound';
import { NoopChannelProvisioner } from '../src/services/channel-provisioning';
import type { FetchLike } from '../src/services/resend-mailer';
import {
	createWhatsappProvisioner,
	createWhatsappSender,
	signZernioPayload,
	verifyZernioSignature,
	ZernioProvisioner,
	ZernioWhatsappSender,
} from '../src/services/zernio-whatsapp';

const CHAT_CAPS: ChannelCapabilities = {
	channel: 'whatsapp',
	medium: 'chat',
	supportsRichText: false,
	supportsInteractiveOptions: false,
	supportsHyperlinkButtons: false,
	maxTextLength: 4096,
	hasSubjects: false,
	threadingModel: 'session',
	isRealtimeVoice: false,
	supportsAttachments: false,
};

function replyContext(medium: 'chat' | 'email' = 'chat') {
	return {
		accountName: 'Cascade Plumbing',
		customerName: 'Dana',
		timeZone: 'America/Los_Angeles',
		signupUrl: 'https://www.rivus.ai/customers/join/cascade-plumbing?phone=%2B15559990000',
		jobTitle: 'Appointment',
		now: new Date('2026-07-03T17:00:00.000Z'),
		medium,
	} as const;
}

describe('parseZernioInbound', () => {
	it('parses a canonical inbound message event', () => {
		const event = parseZernioInbound({
			type: WHATSAPP_MESSAGE_EVENT,
			data: { to: '+15550001111', from: '+15559990000', text: 'Hi', messageId: 'wamid.1' },
		});
		expect(event?.type).toBe(WHATSAPP_MESSAGE_EVENT);
		expect(event?.type === WHATSAPP_MESSAGE_EVENT && event.data.profileName).toBe('');
	});

	it('parses a delivery-failure event', () => {
		const event = parseZernioInbound({
			type: 'whatsapp.message.failed',
			data: { from: '+15550001111', to: '+15559990000', reason: 'undeliverable' },
		});
		expect(event?.type).toBe('whatsapp.message.failed');
	});

	it('returns null for an unrecognized payload', () => {
		expect(parseZernioInbound({ type: 'nope' })).toBeNull();
		expect(parseZernioInbound(null)).toBeNull();
		expect(parseZernioInbound('garbage')).toBeNull();
	});
});

describe('ZernioWhatsappSender', () => {
	it('POSTs the message with a bearer token and resolves on 2xx', async () => {
		const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => '{"id":"m1"}',
		});
		const sender = new ZernioWhatsappSender({
			apiKey: 'zk_1',
			apiUrl: 'https://api.zernio.com',
			fetchImpl,
		});
		await sender.sendMessage({ from: '+15550001111', to: '+15559990000', text: 'Hello' });
		const [url, init] = fetchImpl.mock.calls[0] as [
			string,
			{ headers: Record<string, string>; body: string },
		];
		expect(url).toBe('https://api.zernio.com/messages');
		expect(init.headers.authorization).toBe('Bearer zk_1');
		expect(JSON.parse(init.body)).toMatchObject({ from: '+15550001111', to: '+15559990000' });
	});

	it('throws on a non-2xx response', async () => {
		const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({
			ok: false,
			status: 422,
			text: async () => 'bad number',
		});
		const sender = new ZernioWhatsappSender({
			apiKey: 'zk_1',
			apiUrl: 'https://api.zernio.com',
			fetchImpl,
		});
		await expect(sender.sendMessage({ from: '+1', to: '+2', text: 'x' })).rejects.toThrow(
			/status 422/,
		);
	});
});

describe('ZernioProvisioner', () => {
	it('does not call the provider when a number is already provisioned', async () => {
		const fetchImpl = vi.fn<FetchLike>();
		const provisioner = new ZernioProvisioner({
			apiKey: 'zk_1',
			apiUrl: 'https://api.zernio.com',
			fetchImpl,
		});
		const existing = { address: '+15550001111', providerRef: 'zwa_1' };
		const result = await provisioner.provision({
			accountId: 'a1' as AccountId,
			accountName: 'Acme',
			existing,
		});
		expect(result).toEqual(existing);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('provisions a number from the provider response', async () => {
		const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({
			ok: true,
			status: 201,
			text: async () => '{"phone_number":"+1 (555) 010-2020","id":"num_9"}',
		});
		const provisioner = new ZernioProvisioner({
			apiKey: 'zk_1',
			apiUrl: 'https://api.zernio.com',
			fetchImpl,
		});
		const result = await provisioner.provision({
			accountId: 'a1' as AccountId,
			accountName: 'Acme',
			existing: { address: '', providerRef: '' },
		});
		expect(result).toEqual({ address: '+15550102020', providerRef: 'num_9' });
	});

	it('throws when the provider rejects', async () => {
		const fetchImpl = vi
			.fn<FetchLike>()
			.mockResolvedValue({ ok: false, status: 500, text: async () => '' });
		const provisioner = new ZernioProvisioner({
			apiKey: 'zk_1',
			apiUrl: 'https://api.zernio.com',
			fetchImpl,
		});
		await expect(
			provisioner.provision({
				accountId: 'a1' as AccountId,
				accountName: 'Acme',
				existing: { address: '', providerRef: '' },
			}),
		).rejects.toThrow(/provision/);
	});
});

describe('NoopChannelProvisioner', () => {
	it('returns a deterministic +1555 number derived from the account id', async () => {
		const provisioner = new NoopChannelProvisioner();
		const first = await provisioner.provision({
			accountId: 'account-xyz' as AccountId,
			accountName: 'Acme',
			existing: { address: '', providerRef: '' },
		});
		const again = await provisioner.provision({
			accountId: 'account-xyz' as AccountId,
			accountName: 'Acme',
			existing: { address: '', providerRef: '' },
		});
		expect(first.address).toMatch(/^\+1555\d{7}$/);
		expect(again.address).toBe(first.address);
		expect(first.providerRef).toBe('noop');
	});

	it('returns the existing identifier unchanged', async () => {
		const provisioner = new NoopChannelProvisioner();
		const existing = { address: '+15550001111', providerRef: 'zwa_1' };
		expect(
			await provisioner.provision({ accountId: 'a1' as AccountId, accountName: 'Acme', existing }),
		).toEqual(existing);
	});
});

describe('createWhatsappSender / createWhatsappProvisioner', () => {
	it('return no-ops when no zernio key is configured', async () => {
		const sender = createWhatsappSender({ ZERNIO_API_URL: 'https://api.zernio.com' });
		// A no-op send resolves without a transport.
		await expect(sender.sendMessage({ from: '+1', to: '+2', text: 'x' })).resolves.toBeUndefined();
		const provisioner = createWhatsappProvisioner({ ZERNIO_API_URL: 'https://api.zernio.com' });
		const provisioned = await provisioner.provision({
			accountId: 'a1' as AccountId,
			accountName: 'Acme',
			existing: { address: '', providerRef: '' },
		});
		expect(provisioned.address).toMatch(/^\+1555\d{7}$/);
	});

	it('return zernio adapters when a key is configured', () => {
		const sender = createWhatsappSender({
			ZERNIO_API_KEY: 'zk_1',
			ZERNIO_API_URL: 'https://api.zernio.com',
		});
		expect(sender).toBeInstanceOf(ZernioWhatsappSender);
		const provisioner = createWhatsappProvisioner({
			ZERNIO_API_KEY: 'zk_1',
			ZERNIO_API_URL: 'https://api.zernio.com',
		});
		expect(provisioner).toBeInstanceOf(ZernioProvisioner);
	});
});

describe('verifyZernioSignature / signZernioPayload', () => {
	const SECRET = 'zwh_secret';
	const BODY = '{"event":"message.received"}';

	it('accepts a signature it produced and rejects a tampered body', () => {
		const signature = signZernioPayload(SECRET, BODY);
		expect(verifyZernioSignature({ secret: SECRET, signature, payload: BODY })).toBe(true);
		expect(verifyZernioSignature({ secret: SECRET, signature, payload: `${BODY} ` })).toBe(false);
	});

	it('is case-insensitive on the hex digest and tolerant of surrounding space', () => {
		const signature = signZernioPayload(SECRET, BODY).toUpperCase();
		expect(
			verifyZernioSignature({ secret: SECRET, signature: `  ${signature}  `, payload: BODY }),
		).toBe(true);
	});

	it('rejects an empty secret, empty signature, or wrong-length digest', () => {
		const signature = signZernioPayload(SECRET, BODY);
		expect(verifyZernioSignature({ secret: '', signature, payload: BODY })).toBe(false);
		expect(verifyZernioSignature({ secret: SECRET, signature: '', payload: BODY })).toBe(false);
		expect(verifyZernioSignature({ secret: SECRET, signature: 'abc123', payload: BODY })).toBe(
			false,
		);
	});

	it('rejects a signature made with a different secret', () => {
		const signature = signZernioPayload('other-secret', BODY);
		expect(verifyZernioSignature({ secret: SECRET, signature, payload: BODY })).toBe(false);
	});
});

describe('renderChatResponse', () => {
	it('flattens an options block to a numbered list', () => {
		const slots = [
			{ startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 },
			{ startAt: '2026-07-09T21:00:00.000Z', durationMinutes: 60 },
		];
		const text = renderChatResponse(
			composeAgentResponse({ kind: 'offer_slots', slots }, replyContext()),
			CHAT_CAPS,
		);
		expect(text).toContain('1.');
		expect(text).toContain('2.');
		expect(text).toContain('Reply with the number');
	});

	it('truncates to a channel length cap', () => {
		const text = renderChatResponse(
			composeAgentResponse({ kind: 'no_availability' }, replyContext()),
			{ ...CHAT_CAPS, maxTextLength: 12 },
		);
		expect(text.length).toBeLessThanOrEqual(12);
		expect(text.endsWith('…')).toBe(true);
	});

	it('leaves a message that already fits byte-for-byte alone', () => {
		const response = composeAgentResponse({ kind: 'no_availability' }, replyContext());
		expect(renderChatResponse(response, CHAT_CAPS)).toBe(renderResponseText(response));
	});

	// SMS is the tight one: 737 characters against an answer that may run to 1200.
	const SMS_LIMIT = 737;
	const LONG_ANSWER = `Our hours vary by season. ${'We are open Monday through Friday and most Saturdays, and we cover the whole metro area. '.repeat(12)}`;

	it('takes the budget out of prose so an unknown sender still gets the signup link', () => {
		const response = composeAgentResponse(
			{ kind: 'answer_question', answer: LONG_ANSWER, offeredSlots: [], customerKnown: false },
			replyContext(),
		);
		// A tail cut would drop the trailing action block and strand the contact.
		expect(renderResponseText(response).length).toBeGreaterThan(SMS_LIMIT);
		const text = renderChatResponse(response, { ...CHAT_CAPS, maxTextLength: SMS_LIMIT });
		expect(text.length).toBeLessThanOrEqual(SMS_LIMIT);
		expect(text).toContain(replyContext().signupUrl);
		expect(text).toContain('Join Cascade Plumbing as a customer');
		// The answer is shortened, not dropped.
		expect(text).toContain('Our hours vary by season.');
		expect(text).toContain('…');
	});

	it('keeps the numbered options when a long answer restates a standing offer', () => {
		const slots = [
			{ startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 },
			{ startAt: '2026-07-09T21:00:00.000Z', durationMinutes: 60 },
		];
		const text = renderChatResponse(
			composeAgentResponse(
				{ kind: 'answer_question', answer: LONG_ANSWER, offeredSlots: slots, customerKnown: true },
				replyContext(),
			),
			{ ...CHAT_CAPS, maxTextLength: SMS_LIMIT },
		);
		expect(text.length).toBeLessThanOrEqual(SMS_LIMIT);
		expect(text).toContain('1.');
		expect(text).toContain('2.');
		expect(text).toContain('Reply with the number');
	});

	it('renders the same long answer whole on an unbounded channel', () => {
		const response = composeAgentResponse(
			{ kind: 'answer_question', answer: LONG_ANSWER, offeredSlots: [], customerKnown: false },
			replyContext(),
		);
		const text = renderChatResponse(response, { ...CHAT_CAPS, maxTextLength: null });
		expect(text).toBe(renderResponseText(response));
		expect(text).toContain(LONG_ANSWER.trim());
	});
});
