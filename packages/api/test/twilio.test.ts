import type { AccountId } from '@rivus/core';
import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { NoopChannelProvisioner, NoopNumberReleaser } from '../src/services/channel-provisioning';
import {
	createSmsProvisioner,
	createSmsSender,
	createWhatsappProvisioner,
	createWhatsappSender,
} from '../src/services/messaging-provider';
import { PlivoProvisioner } from '../src/services/plivo';
import type { FetchLike } from '../src/services/resend-mailer';
import { NoopSmsSender } from '../src/services/sms';
import {
	createTwilioNumberReleaser,
	createTwilioProvisioner,
	createTwilioSmsSender,
	createTwilioWhatsappSender,
	signTwilioRequest,
	TwilioNumberReleaser,
	TwilioProvisioner,
	TwilioSmsSender,
	TwilioWhatsappSender,
	twilioOwnedIdentifier,
	twilioOwnsRef,
	verifyTwilioSignature,
} from '../src/services/twilio';
import { NoopWhatsappSender } from '../src/services/whatsapp';
import { ZernioProvisioner } from '../src/services/zernio-whatsapp';

const ACCOUNT_SID = 'ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const AUTH_TOKEN = 'twilio-test-auth-token';
const API_URL = 'https://api.twilio.example';
const NUMBER_SID = 'PN0123456789abcdef0123456789abcdef';

interface RecordedCall {
	url: string;
	init: { method: string; headers: Record<string, string>; body?: string };
}

interface CannedResponse {
	ok: boolean;
	status: number;
	body: string;
}

/** A FetchLike that replays canned responses in order and records every call. */
function fakeFetch(responses: CannedResponse[]): { fetchImpl: FetchLike; calls: RecordedCall[] } {
	const calls: RecordedCall[] = [];
	const fetchImpl: FetchLike = async (url, init) => {
		calls.push({ url, init });
		const canned = responses[calls.length - 1];
		if (!canned) {
			throw new Error(`unexpected fetch #${calls.length} to ${url}`);
		}
		return { ok: canned.ok, status: canned.status, text: async () => canned.body };
	};
	return { fetchImpl, calls };
}

function testConfig(env: Record<string, string> = {}) {
	return loadConfig({
		NODE_ENV: 'test',
		JWT_SECRET: 'test-secret-value-1234',
		...env,
	} as NodeJS.ProcessEnv);
}

describe('signTwilioRequest / verifyTwilioSignature', () => {
	// Twilio's own worked example from the request-validation docs ("Explore the
	// algorithm yourself"): the query string stays exactly as requested (foo
	// before bar), the POST params are sorted and appended name+value with no
	// delimiters, HMAC-SHA1 keyed by the auth token, base64.
	const DOC_URL = 'https://example.com/myapp.php?foo=1&bar=2';
	const DOC_PARAMS = {
		CallSid: 'CA1234567890ABCDE',
		Caller: '+14158675310',
		Digits: '1234',
		From: '+14158675310',
		To: '+18005551212',
	};

	it("reproduces Twilio's published signature for the documented example", () => {
		expect(signTwilioRequest({ authToken: '12345', url: DOC_URL, params: DOC_PARAMS })).toBe(
			'L/OH5YylLD5NRKLltdqwSvS0BnU=',
		);
	});

	it('accepts the documented signature and rejects tampering', () => {
		const signature = 'L/OH5YylLD5NRKLltdqwSvS0BnU=';
		expect(
			verifyTwilioSignature({ authToken: '12345', url: DOC_URL, params: DOC_PARAMS, signature }),
		).toBe(true);
		// A changed parameter value (the body is signed, unlike Plivo's scheme).
		expect(
			verifyTwilioSignature({
				authToken: '12345',
				url: DOC_URL,
				params: { ...DOC_PARAMS, Digits: '9999' },
				signature,
			}),
		).toBe(false);
		// An added parameter.
		expect(
			verifyTwilioSignature({
				authToken: '12345',
				url: DOC_URL,
				params: { ...DOC_PARAMS, Extra: 'x' },
				signature,
			}),
		).toBe(false);
		// The wrong URL or the wrong token.
		expect(
			verifyTwilioSignature({
				authToken: '12345',
				url: 'https://elsewhere.example/hook',
				params: DOC_PARAMS,
				signature,
			}),
		).toBe(false);
		expect(
			verifyTwilioSignature({ authToken: 'other', url: DOC_URL, params: DOC_PARAMS, signature }),
		).toBe(false);
	});

	it('accepts a signature computed with or without the default port (both directions)', () => {
		const withPort = 'https://api.rivus.example:443/v1/channels/sms/twilio/inbound';
		const withoutPort = 'https://api.rivus.example/v1/channels/sms/twilio/inbound';
		const params = { From: '+15550001111', Body: 'hi' };
		const signedWithout = signTwilioRequest({ authToken: AUTH_TOKEN, url: withoutPort, params });
		const signedWith = signTwilioRequest({ authToken: AUTH_TOKEN, url: withPort, params });
		// Twilio's own back end is inconsistent about explicit default ports, so
		// the SDKs (and this verifier) accept either variant of the same URL.
		expect(
			verifyTwilioSignature({
				authToken: AUTH_TOKEN,
				url: withPort,
				params,
				signature: signedWithout,
			}),
		).toBe(true);
		expect(
			verifyTwilioSignature({
				authToken: AUTH_TOKEN,
				url: withoutPort,
				params,
				signature: signedWith,
			}),
		).toBe(true);
		// A non-default port is not rewritten — only :443/:80 get the sibling check.
		const oddPort = 'https://api.rivus.example:8443/hook';
		expect(
			verifyTwilioSignature({
				authToken: AUTH_TOKEN,
				url: oddPort,
				params,
				signature: signTwilioRequest({ authToken: AUTH_TOKEN, url: oddPort, params }),
			}),
		).toBe(true);
	});

	it('signs a repeated parameter as its distinct values, sorted, name re-attached', () => {
		// The behavior of Twilio's own SDK validators: dedupe, sort, append per value.
		const repeated = signTwilioRequest({
			authToken: AUTH_TOKEN,
			url: 'https://example.com/hook',
			params: { A: ['2', '1', '2'], B: 'x' },
		});
		const flattened = signTwilioRequest({
			authToken: AUTH_TOKEN,
			url: 'https://example.com/hookA1A2', // A1A2 appended = what the array must produce
			params: { B: 'x' },
		});
		expect(repeated).toBe(flattened);
	});

	it('rejects when the token or signature is missing', () => {
		const signature = signTwilioRequest({ authToken: AUTH_TOKEN, url: DOC_URL, params: {} });
		expect(verifyTwilioSignature({ authToken: '', url: DOC_URL, params: {}, signature })).toBe(
			false,
		);
		expect(
			verifyTwilioSignature({ authToken: AUTH_TOKEN, url: DOC_URL, params: {}, signature: '' }),
		).toBe(false);
	});

	it('verifies a non-URL string as-is (no port variants to try)', () => {
		const url = 'not-a-url';
		const signature = signTwilioRequest({ authToken: AUTH_TOKEN, url, params: {} });
		expect(verifyTwilioSignature({ authToken: AUTH_TOKEN, url, params: {}, signature })).toBe(true);
	});
});

describe('TwilioWhatsappSender', () => {
	const MESSAGE = { from: '+15550001111', to: '+15559990000', text: 'Your slot is booked.' };

	it('POSTs a form-encoded message with whatsapp:-prefixed addresses and Basic auth', async () => {
		const { fetchImpl, calls } = fakeFetch([
			{ ok: true, status: 201, body: '{"sid":"SM123","status":"queued"}' },
		]);
		const sender = new TwilioWhatsappSender({
			accountSid: ACCOUNT_SID,
			authToken: AUTH_TOKEN,
			apiUrl: API_URL,
			fetchImpl,
		});
		await sender.sendMessage(MESSAGE);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(`${API_URL}/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`);
		expect(calls[0]?.init.method).toBe('POST');
		const credentials = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');
		expect(calls[0]?.init.headers.authorization).toBe(`Basic ${credentials}`);
		expect(calls[0]?.init.headers['content-type']).toBe('application/x-www-form-urlencoded');
		const form = new URLSearchParams(calls[0]?.init.body ?? '');
		expect(form.get('From')).toBe('whatsapp:+15550001111');
		expect(form.get('To')).toBe('whatsapp:+15559990000');
		expect(form.get('Body')).toBe(MESSAGE.text);
		expect(form.has('StatusCallback')).toBe(false);
	});

	it('attaches the delivery-status callback URL when configured', async () => {
		const { fetchImpl, calls } = fakeFetch([{ ok: true, status: 201, body: '{"sid":"SM1"}' }]);
		const sender = new TwilioWhatsappSender({
			accountSid: ACCOUNT_SID,
			authToken: AUTH_TOKEN,
			apiUrl: API_URL,
			statusCallbackUrl: 'https://api.rivus.ai/v1/channels/whatsapp/twilio/inbound',
			fetchImpl,
		});
		await sender.sendMessage(MESSAGE);
		const form = new URLSearchParams(calls[0]?.init.body ?? '');
		expect(form.get('StatusCallback')).toBe(
			'https://api.rivus.ai/v1/channels/whatsapp/twilio/inbound',
		);
	});

	it('rejects with the status and response detail when Twilio refuses the send', async () => {
		const { fetchImpl } = fakeFetch([
			{
				ok: false,
				status: 400,
				body: '{"code":63016,"message":"outside the allowed window"}',
			},
		]);
		const sender = new TwilioWhatsappSender({
			accountSid: ACCOUNT_SID,
			authToken: AUTH_TOKEN,
			apiUrl: API_URL,
			fetchImpl,
		});
		await expect(sender.sendMessage(MESSAGE)).rejects.toThrow(
			/WhatsApp message \(status 400\).*outside the allowed window/,
		);
	});
});

describe('TwilioSmsSender', () => {
	const MESSAGE = { from: '+15550001111', to: '+15559990000', text: 'See you at 2pm.' };

	it('POSTs bare E.164 addresses (no channel prefix) with the SMS status callback', async () => {
		const { fetchImpl, calls } = fakeFetch([{ ok: true, status: 201, body: '{"sid":"SM2"}' }]);
		const sender = new TwilioSmsSender({
			accountSid: ACCOUNT_SID,
			authToken: AUTH_TOKEN,
			apiUrl: API_URL,
			statusCallbackUrl: 'https://api.rivus.ai/v1/channels/sms/twilio/inbound',
			fetchImpl,
		});
		await sender.sendMessage(MESSAGE);
		expect(calls[0]?.url).toBe(`${API_URL}/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`);
		const form = new URLSearchParams(calls[0]?.init.body ?? '');
		expect(form.get('From')).toBe('+15550001111');
		expect(form.get('To')).toBe('+15559990000');
		expect(form.get('Body')).toBe(MESSAGE.text);
		expect(form.get('StatusCallback')).toBe('https://api.rivus.ai/v1/channels/sms/twilio/inbound');
	});

	it('rejects with the status and response detail when Twilio refuses the send', async () => {
		const { fetchImpl } = fakeFetch([{ ok: false, status: 402, body: 'insufficient funds' }]);
		const sender = new TwilioSmsSender({
			accountSid: ACCOUNT_SID,
			authToken: AUTH_TOKEN,
			apiUrl: API_URL,
			fetchImpl,
		});
		await expect(sender.sendMessage(MESSAGE)).rejects.toThrow(
			/SMS message \(status 402\).*insufficient funds/,
		);
	});

	it('reports the bare status when the error body cannot be read', async () => {
		const fetchImpl: FetchLike = async () => ({
			ok: false,
			status: 500,
			text: async () => {
				throw new Error('stream torn down');
			},
		});
		const sender = new TwilioSmsSender({
			accountSid: ACCOUNT_SID,
			authToken: AUTH_TOKEN,
			apiUrl: API_URL,
			fetchImpl,
		});
		await expect(sender.sendMessage(MESSAGE)).rejects.toThrow(/SMS message \(status 500\)$/);
	});
});

describe('twilioOwnsRef / twilioOwnedIdentifier', () => {
	it('recognizes a Twilio-provisioned config (providerRef = PN… phone-number SID)', () => {
		expect(twilioOwnsRef(NUMBER_SID)).toBe(true);
		expect(
			twilioOwnedIdentifier({ enabled: true, address: '+14155552671', providerRef: NUMBER_SID }),
		).toEqual({ address: '+14155552671', providerRef: NUMBER_SID });
	});

	it("rejects refs Twilio does not own (Plivo's bare digits, zernio ids, dev fakes, empties)", () => {
		expect(twilioOwnsRef('14155552671')).toBe(false);
		expect(twilioOwnsRef('zwa_1')).toBe(false);
		expect(twilioOwnsRef('noop')).toBe(false);
		expect(twilioOwnsRef('')).toBe(false);
		// Truncated and over-long SIDs are not fingerprints.
		expect(twilioOwnsRef(NUMBER_SID.slice(0, -1))).toBe(false);
		expect(twilioOwnsRef(`${NUMBER_SID}0`)).toBe(false);
		expect(
			twilioOwnedIdentifier({ enabled: true, address: '+14155552671', providerRef: '14155552671' }),
		).toBeNull();
		expect(twilioOwnedIdentifier({ enabled: false, address: '', providerRef: '' })).toBeNull();
		// A ref with no address can't be shared or sent from.
		expect(
			twilioOwnedIdentifier({ enabled: true, address: '', providerRef: NUMBER_SID }),
		).toBeNull();
	});
});

describe('TwilioProvisioner', () => {
	const INPUT = {
		accountId: 'acc_1' as AccountId,
		accountName: 'Cascade Plumbing',
		existing: { address: '', providerRef: '' },
	};

	function provisioner(
		fetchImpl: FetchLike,
		options: { country?: string; smsUrl?: string; voiceUrl?: string } = {},
	) {
		return new TwilioProvisioner({
			accountSid: ACCOUNT_SID,
			authToken: AUTH_TOKEN,
			apiUrl: API_URL,
			numberCountry: options.country ?? 'us',
			smsUrl: options.smsUrl,
			voiceUrl: options.voiceUrl,
			fetchImpl,
		});
	}

	it('returns the existing identifier untouched (idempotent re-enable)', async () => {
		const { fetchImpl, calls } = fakeFetch([]);
		const existing = { address: '+15551234567', providerRef: NUMBER_SID };
		await expect(provisioner(fetchImpl).provision({ ...INPUT, existing })).resolves.toEqual(
			existing,
		);
		expect(calls).toHaveLength(0);
	});

	it('searches for a voice+SMS local number, rents it with webhooks attached, and stores the PN sid', async () => {
		const { fetchImpl, calls } = fakeFetch([
			{
				ok: true,
				status: 200,
				body: '{"available_phone_numbers":[{"phone_number":"+14155552671"}]}',
			},
			{ ok: true, status: 201, body: `{"sid":"${NUMBER_SID}","phone_number":"+14155552671"}` },
		]);
		const provisioned = await provisioner(fetchImpl, {
			smsUrl: 'https://api.rivus.ai/v1/channels/sms/twilio/inbound',
			voiceUrl: 'https://api.rivus.ai/v1/channels/voice/twilio/answer',
		}).provision(INPUT);
		expect(provisioned).toEqual({ address: '+14155552671', providerRef: NUMBER_SID });

		const searchUrl = new URL(calls[0]?.url ?? '');
		expect(searchUrl.pathname).toBe(
			`/2010-04-01/Accounts/${ACCOUNT_SID}/AvailablePhoneNumbers/US/Local.json`,
		);
		expect(searchUrl.searchParams.get('SmsEnabled')).toBe('true');
		expect(searchUrl.searchParams.get('VoiceEnabled')).toBe('true');
		expect(calls[0]?.init.method).toBe('GET');
		expect(calls[0]?.init.body).toBeUndefined();

		expect(calls[1]?.url).toBe(
			`${API_URL}/2010-04-01/Accounts/${ACCOUNT_SID}/IncomingPhoneNumbers.json`,
		);
		expect(calls[1]?.init.method).toBe('POST');
		const form = new URLSearchParams(calls[1]?.init.body ?? '');
		expect(form.get('PhoneNumber')).toBe('+14155552671');
		// The webhooks ride the same purchase call — the number is live immediately.
		expect(form.get('SmsUrl')).toBe('https://api.rivus.ai/v1/channels/sms/twilio/inbound');
		expect(form.get('SmsMethod')).toBe('POST');
		expect(form.get('VoiceUrl')).toBe('https://api.rivus.ai/v1/channels/voice/twilio/answer');
		expect(form.get('VoiceMethod')).toBe('POST');
	});

	it('omits the webhook parameters when no public URLs are configured', async () => {
		const { fetchImpl, calls } = fakeFetch([
			{
				ok: true,
				status: 200,
				body: '{"available_phone_numbers":[{"phone_number":"+14155552671"}]}',
			},
			{ ok: true, status: 201, body: `{"sid":"${NUMBER_SID}","phone_number":"+14155552671"}` },
		]);
		await provisioner(fetchImpl).provision(INPUT);
		const form = new URLSearchParams(calls[1]?.init.body ?? '');
		expect(form.has('SmsUrl')).toBe(false);
		expect(form.has('SmsMethod')).toBe(false);
		expect(form.has('VoiceUrl')).toBe(false);
		expect(form.has('VoiceMethod')).toBe(false);
	});

	it('logs the Twilio status and response body when provisioning fails', async () => {
		// A failed enable only surfaces a generic 502 to the client, so the reason
		// has to be in the logs — the Twilio error code/message from the body.
		const entries: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
		const record =
			(level: string) =>
			(obj: unknown, msg?: string): void => {
				entries.push({ level, obj: (obj ?? {}) as Record<string, unknown>, msg: msg ?? '' });
			};
		const makeLogger = (): FastifyBaseLogger =>
			({
				child: () => makeLogger(),
				info: record('info'),
				error: record('error'),
				warn: record('warn'),
				debug: record('debug'),
				fatal: record('fatal'),
				trace: record('trace'),
			}) as unknown as FastifyBaseLogger;

		const { fetchImpl } = fakeFetch([
			{ ok: false, status: 401, body: '{"code":20003,"message":"Authenticate"}' },
		]);
		await expect(
			provisioner(fetchImpl).provision({ ...INPUT, logger: makeLogger() }),
		).rejects.toThrow(/number search failed \(status 401\)/);
		const failure = entries.find(
			(entry) => entry.level === 'error' && entry.msg === 'Twilio number search failed',
		);
		expect(failure?.obj.status).toBe(401);
		expect(String(failure?.obj.body)).toContain('20003');
	});

	it('fails when the search errors or returns no numbers', async () => {
		const errored = fakeFetch([{ ok: false, status: 500, body: 'upstream sad' }]);
		await expect(provisioner(errored.fetchImpl).provision(INPUT)).rejects.toThrow(
			/number search failed \(status 500\)/,
		);
		const empty = fakeFetch([{ ok: true, status: 200, body: '{"available_phone_numbers":[]}' }]);
		await expect(provisioner(empty.fetchImpl).provision(INPUT)).rejects.toThrow(
			/no US numbers with voice\+SMS/,
		);
	});

	it('fails when the rental errors or is not confirmed', async () => {
		const search = {
			ok: true,
			status: 200,
			body: '{"available_phone_numbers":[{"phone_number":"+14155552671"}]}',
		};
		const refused = fakeFetch([search, { ok: false, status: 403, body: 'not available' }]);
		await expect(provisioner(refused.fetchImpl).provision(INPUT)).rejects.toThrow(
			/refused to rent \+14155552671 \(status 403\)/,
		);
		const unconfirmed = fakeFetch([search, { ok: true, status: 201, body: '{}' }]);
		await expect(provisioner(unconfirmed.fetchImpl).provision(INPUT)).rejects.toThrow(
			/did not confirm the rental/,
		);
	});

	it('fails when Twilio offers a number that is not valid E.164', async () => {
		const { fetchImpl } = fakeFetch([
			{
				ok: true,
				status: 200,
				body: '{"available_phone_numbers":[{"phone_number":"not-a-number"}]}',
			},
			{ ok: true, status: 201, body: `{"sid":"${NUMBER_SID}","phone_number":"not-a-number"}` },
		]);
		await expect(provisioner(fetchImpl).provision(INPUT)).rejects.toThrow(/not valid E\.164/);
	});
});

describe('TwilioNumberReleaser', () => {
	function releaser(responses: CannedResponse[]) {
		const { fetchImpl, calls } = fakeFetch(responses);
		const instance = new TwilioNumberReleaser({
			accountSid: ACCOUNT_SID,
			authToken: AUTH_TOKEN,
			apiUrl: API_URL,
			fetchImpl,
		});
		return { instance, calls };
	}

	it('DELETEs the number resource with basic auth and reports released on 204', async () => {
		const { instance, calls } = releaser([{ ok: true, status: 204, body: '' }]);
		await expect(instance.release(NUMBER_SID)).resolves.toBe('released');
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(
			`${API_URL}/2010-04-01/Accounts/${ACCOUNT_SID}/IncomingPhoneNumbers/${NUMBER_SID}.json`,
		);
		expect(calls[0]?.init.method).toBe('DELETE');
		const credentials = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');
		expect(calls[0]?.init.headers.authorization).toBe(`Basic ${credentials}`);
	});

	it('reports not_found when Twilio no longer knows the ref (already released by hand)', async () => {
		const { instance } = releaser([
			{ ok: false, status: 404, body: '{"code":20404,"message":"not found"}' },
		]);
		await expect(instance.release(NUMBER_SID)).resolves.toBe('not_found');
	});

	it('rejects with the status and body on any other refusal', async () => {
		const { instance } = releaser([
			{ ok: false, status: 401, body: '{"code":20003,"message":"Authenticate"}' },
		]);
		await expect(instance.release(NUMBER_SID)).rejects.toThrow(
			`Twilio refused to release ${NUMBER_SID} (status 401): {"code":20003,"message":"Authenticate"}`,
		);
	});
});

describe('Twilio factories', () => {
	it('degrade to no-ops without a full credential pair', () => {
		const none = testConfig();
		expect(createTwilioWhatsappSender(none)).toBeInstanceOf(NoopWhatsappSender);
		expect(createTwilioSmsSender(none)).toBeInstanceOf(NoopSmsSender);
		expect(createTwilioProvisioner(none)).toBeInstanceOf(NoopChannelProvisioner);
		expect(createTwilioNumberReleaser(none)).toBeInstanceOf(NoopNumberReleaser);

		const partial = testConfig({ TWILIO_ACCOUNT_SID: ACCOUNT_SID });
		expect(createTwilioWhatsappSender(partial)).toBeInstanceOf(NoopWhatsappSender);
		expect(createTwilioSmsSender(partial)).toBeInstanceOf(NoopSmsSender);
		expect(createTwilioProvisioner(partial)).toBeInstanceOf(NoopChannelProvisioner);
		expect(createTwilioNumberReleaser(partial)).toBeInstanceOf(NoopNumberReleaser);
	});

	it('build real adapters when both credentials are set', () => {
		const config = testConfig({
			TWILIO_ACCOUNT_SID: ACCOUNT_SID,
			TWILIO_AUTH_TOKEN: AUTH_TOKEN,
		});
		expect(createTwilioWhatsappSender(config)).toBeInstanceOf(TwilioWhatsappSender);
		expect(createTwilioSmsSender(config)).toBeInstanceOf(TwilioSmsSender);
		expect(createTwilioProvisioner(config)).toBeInstanceOf(TwilioProvisioner);
		expect(createTwilioNumberReleaser(config)).toBeInstanceOf(TwilioNumberReleaser);
	});
});

describe('provider selection and outbound routing', () => {
	const PLIVO_ENV = {
		PLIVO_AUTH_ID: 'MA_TEST_AUTH_ID',
		PLIVO_AUTH_TOKEN: 'plivo-token',
		PLIVO_API_URL: 'https://api.plivo.example/v1',
	};
	const TWILIO_ENV = {
		TWILIO_ACCOUNT_SID: ACCOUNT_SID,
		TWILIO_AUTH_TOKEN: AUTH_TOKEN,
		TWILIO_API_URL: API_URL,
	};
	const ZERNIO_ENV = { ZERNIO_API_KEY: 'zk_1', ZERNIO_API_URL: 'https://api.zernio.example/v1' };

	const OK = { ok: true, status: 201, body: '{"sid":"SM1"}' };

	it('provisions new WhatsApp numbers via Twilio first, then Plivo, then zernio, then the no-op', () => {
		const all = testConfig({ ...TWILIO_ENV, ...PLIVO_ENV, ...ZERNIO_ENV });
		expect(createWhatsappProvisioner(all)).toBeInstanceOf(TwilioProvisioner);
		expect(createWhatsappProvisioner(testConfig({ ...PLIVO_ENV, ...ZERNIO_ENV }))).toBeInstanceOf(
			PlivoProvisioner,
		);
		expect(createWhatsappProvisioner(testConfig(ZERNIO_ENV))).toBeInstanceOf(ZernioProvisioner);
		expect(createWhatsappProvisioner(testConfig())).toBeInstanceOf(NoopChannelProvisioner);
		// One Twilio credential alone is not a configured provider — fall through.
		expect(
			createWhatsappProvisioner(testConfig({ TWILIO_ACCOUNT_SID: ACCOUNT_SID, ...PLIVO_ENV })),
		).toBeInstanceOf(PlivoProvisioner);
	});

	it('provisions new SMS/voice numbers via Twilio first, then Plivo — zernio never serves them', () => {
		expect(createSmsProvisioner(testConfig({ ...TWILIO_ENV, ...PLIVO_ENV }))).toBeInstanceOf(
			TwilioProvisioner,
		);
		expect(createSmsProvisioner(testConfig(PLIVO_ENV))).toBeInstanceOf(PlivoProvisioner);
		expect(createSmsProvisioner(testConfig(ZERNIO_ENV))).toBeInstanceOf(NoopChannelProvisioner);
		expect(createSmsProvisioner(testConfig())).toBeInstanceOf(NoopChannelProvisioner);
	});

	it('routes each WhatsApp send through the provider that owns the number', async () => {
		const config = testConfig({ ...TWILIO_ENV, ...PLIVO_ENV, ...ZERNIO_ENV });

		// A Twilio-owned number (PN… ref) → the Twilio Messages API.
		const viaTwilio = fakeFetch([OK]);
		await createWhatsappSender(config, viaTwilio.fetchImpl).sendMessage({
			from: '+15550001111',
			to: '+15559990000',
			text: 'hello',
			providerRef: NUMBER_SID,
		});
		expect(viaTwilio.calls[0]?.url).toBe(
			`${API_URL}/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
		);
		expect(new URLSearchParams(viaTwilio.calls[0]?.init.body ?? '').get('From')).toBe(
			'whatsapp:+15550001111',
		);

		// A Plivo-owned number (bare-digits ref) → the Plivo Message API.
		const viaPlivo = fakeFetch([{ ok: true, status: 202, body: '{}' }]);
		await createWhatsappSender(config, viaPlivo.fetchImpl).sendMessage({
			from: '+15550001111',
			to: '+15559990000',
			text: 'hello',
			providerRef: '15550001111',
		});
		expect(viaPlivo.calls[0]?.url).toBe(
			'https://api.plivo.example/v1/Account/MA_TEST_AUTH_ID/Message/',
		);
		expect(JSON.parse(viaPlivo.calls[0]?.init.body ?? '{}').type).toBe('whatsapp');

		// No fingerprint claims the ref → the primary (Twilio when configured).
		const viaPrimary = fakeFetch([OK]);
		await createWhatsappSender(config, viaPrimary.fetchImpl).sendMessage({
			from: '+15550001111',
			to: '+15559990000',
			text: 'hello',
			providerRef: '',
		});
		expect(viaPrimary.calls[0]?.url).toContain(API_URL);
	});

	it('routes SMS sends the same way, without the whatsapp: prefix', async () => {
		const config = testConfig({ ...TWILIO_ENV, ...PLIVO_ENV });

		const viaTwilio = fakeFetch([OK]);
		await createSmsSender(config, viaTwilio.fetchImpl).sendMessage({
			from: '+15550001111',
			to: '+15559990000',
			text: 'hi',
			providerRef: NUMBER_SID,
		});
		expect(viaTwilio.calls[0]?.url).toBe(
			`${API_URL}/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
		);
		expect(new URLSearchParams(viaTwilio.calls[0]?.init.body ?? '').get('From')).toBe(
			'+15550001111',
		);

		const viaPlivo = fakeFetch([{ ok: true, status: 202, body: '{}' }]);
		await createSmsSender(config, viaPlivo.fetchImpl).sendMessage({
			from: '+15550001111',
			to: '+15559990000',
			text: 'hi',
			providerRef: '15550001111',
		});
		expect(viaPlivo.calls[0]?.url).toBe(
			'https://api.plivo.example/v1/Account/MA_TEST_AUTH_ID/Message/',
		);
		expect(JSON.parse(viaPlivo.calls[0]?.init.body ?? '{}').type).toBe('sms');
	});

	it('sends a Twilio-fingerprinted number to the configured provider even when Twilio is not primary', async () => {
		// Only Plivo configured: a PN… ref has no configured owner, so the send
		// goes to the primary (Plivo) and fails loudly at the provider — a visible
		// delivery error beats a silent no-op drop.
		const plivoOnly = testConfig(PLIVO_ENV);
		const { fetchImpl, calls } = fakeFetch([{ ok: true, status: 202, body: '{}' }]);
		await createWhatsappSender(plivoOnly, fetchImpl).sendMessage({
			from: '+15550001111',
			to: '+15559990000',
			text: 'hello',
			providerRef: NUMBER_SID,
		});
		expect(calls[0]?.url).toBe('https://api.plivo.example/v1/Account/MA_TEST_AUTH_ID/Message/');
	});

	it('falls back to zernio for WhatsApp when it is the only configured provider', async () => {
		const zernioOnly = testConfig(ZERNIO_ENV);
		const { fetchImpl, calls } = fakeFetch([{ ok: true, status: 200, body: '{}' }]);
		await createWhatsappSender(zernioOnly, fetchImpl).sendMessage({
			from: '+15550001111',
			to: '+15559990000',
			text: 'hello',
		});
		expect(calls[0]?.url).toContain('https://api.zernio.example/v1');
	});

	it('degrades to silent no-ops when nothing is configured (dev/test boot)', async () => {
		const none = testConfig();
		const whatsapp = fakeFetch([]);
		await createWhatsappSender(none, whatsapp.fetchImpl).sendMessage({
			from: '+15550001111',
			to: '+15559990000',
			text: 'hello',
		});
		expect(whatsapp.calls).toHaveLength(0);
		const sms = fakeFetch([]);
		await createSmsSender(none, sms.fetchImpl).sendMessage({
			from: '+15550001111',
			to: '+15559990000',
			text: 'hi',
		});
		expect(sms.calls).toHaveLength(0);
	});
});
