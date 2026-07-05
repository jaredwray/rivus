import { createHmac } from 'node:crypto';
import type { AccountId } from '@rivus/core';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { NoopChannelProvisioner } from '../src/services/channel-provisioning';
import {
	createPlivoProvisioner,
	createPlivoWhatsappSender,
	PlivoProvisioner,
	PlivoWhatsappSender,
	signPlivoUrl,
	verifyPlivoSignature,
} from '../src/services/plivo-whatsapp';
import type { FetchLike } from '../src/services/resend-mailer';
import { NoopWhatsappSender } from '../src/services/whatsapp';
import { createWhatsappProvisioner, createWhatsappSender } from '../src/services/whatsapp-provider';
import { ZernioProvisioner, ZernioWhatsappSender } from '../src/services/zernio-whatsapp';

const AUTH_ID = 'MA_TEST_AUTH_ID';
const AUTH_TOKEN = 'test-auth-token';
const API_URL = 'https://api.plivo.example/v1';

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

describe('signPlivoUrl / verifyPlivoSignature', () => {
	const URL_SIGNED = 'https://api.rivus.ai/v1/channels/whatsapp/plivo/inbound';
	const NONCE = '05429567804466091622';

	it('computes the base64 HMAC-SHA256 of url+nonce keyed by the auth token', () => {
		const expected = createHmac('sha256', AUTH_TOKEN)
			.update(URL_SIGNED + NONCE)
			.digest('base64');
		expect(signPlivoUrl({ authToken: AUTH_TOKEN, url: URL_SIGNED, nonce: NONCE })).toBe(expected);
	});

	it('ignores the query string (and fragment), like Plivo does', () => {
		const bare = signPlivoUrl({ authToken: AUTH_TOKEN, url: URL_SIGNED, nonce: NONCE });
		expect(
			signPlivoUrl({ authToken: AUTH_TOKEN, url: `${URL_SIGNED}?a=1&b=2`, nonce: NONCE }),
		).toBe(bare);
		expect(signPlivoUrl({ authToken: AUTH_TOKEN, url: `${URL_SIGNED}#frag`, nonce: NONCE })).toBe(
			bare,
		);
	});

	it('accepts a valid signature and rejects a tampered one', () => {
		const signature = signPlivoUrl({ authToken: AUTH_TOKEN, url: URL_SIGNED, nonce: NONCE });
		expect(
			verifyPlivoSignature({ authToken: AUTH_TOKEN, url: URL_SIGNED, nonce: NONCE, signature }),
		).toBe(true);
		expect(
			verifyPlivoSignature({
				authToken: AUTH_TOKEN,
				url: URL_SIGNED,
				nonce: '99999999',
				signature,
			}),
		).toBe(false);
		expect(
			verifyPlivoSignature({
				authToken: 'other-token',
				url: URL_SIGNED,
				nonce: NONCE,
				signature,
			}),
		).toBe(false);
		expect(
			verifyPlivoSignature({
				authToken: AUTH_TOKEN,
				url: 'https://elsewhere.example/hook',
				nonce: NONCE,
				signature,
			}),
		).toBe(false);
	});

	it('accepts the signature from the main-account header or a comma-separated list', () => {
		const signature = signPlivoUrl({ authToken: AUTH_TOKEN, url: URL_SIGNED, nonce: NONCE });
		expect(
			verifyPlivoSignature({
				authToken: AUTH_TOKEN,
				url: URL_SIGNED,
				nonce: NONCE,
				signature: '',
				maSignature: signature,
			}),
		).toBe(true);
		expect(
			verifyPlivoSignature({
				authToken: AUTH_TOKEN,
				url: URL_SIGNED,
				nonce: NONCE,
				signature: `bogus-one, ${signature}`,
			}),
		).toBe(true);
	});

	it('rejects when the token, nonce, or every signature is missing', () => {
		const signature = signPlivoUrl({ authToken: AUTH_TOKEN, url: URL_SIGNED, nonce: NONCE });
		expect(verifyPlivoSignature({ authToken: '', url: URL_SIGNED, nonce: NONCE, signature })).toBe(
			false,
		);
		expect(
			verifyPlivoSignature({ authToken: AUTH_TOKEN, url: URL_SIGNED, nonce: '', signature }),
		).toBe(false);
		expect(
			verifyPlivoSignature({ authToken: AUTH_TOKEN, url: URL_SIGNED, nonce: NONCE, signature: '' }),
		).toBe(false);
	});
});

describe('PlivoWhatsappSender', () => {
	const MESSAGE = { from: '+15550001111', to: '+15559990000', text: 'Your slot is booked.' };

	it('POSTs a whatsapp-typed message to the account Message resource with Basic auth', async () => {
		const { fetchImpl, calls } = fakeFetch([
			{ ok: true, status: 202, body: '{"message":"message(s) queued"}' },
		]);
		const sender = new PlivoWhatsappSender({
			authId: AUTH_ID,
			authToken: AUTH_TOKEN,
			apiUrl: API_URL,
			fetchImpl,
		});
		await sender.sendMessage(MESSAGE);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(`${API_URL}/Account/${AUTH_ID}/Message/`);
		expect(calls[0]?.init.method).toBe('POST');
		const credentials = Buffer.from(`${AUTH_ID}:${AUTH_TOKEN}`).toString('base64');
		expect(calls[0]?.init.headers.authorization).toBe(`Basic ${credentials}`);
		expect(JSON.parse(calls[0]?.init.body ?? '{}')).toEqual({
			src: MESSAGE.from,
			dst: MESSAGE.to,
			type: 'whatsapp',
			text: MESSAGE.text,
		});
	});

	it('attaches the delivery-status callback URL when configured', async () => {
		const { fetchImpl, calls } = fakeFetch([{ ok: true, status: 202, body: '{}' }]);
		const sender = new PlivoWhatsappSender({
			authId: AUTH_ID,
			authToken: AUTH_TOKEN,
			apiUrl: API_URL,
			statusCallbackUrl: 'https://api.rivus.ai/v1/channels/whatsapp/plivo/inbound',
			fetchImpl,
		});
		await sender.sendMessage(MESSAGE);
		expect(JSON.parse(calls[0]?.init.body ?? '{}').url).toBe(
			'https://api.rivus.ai/v1/channels/whatsapp/plivo/inbound',
		);
	});

	it('rejects with the status and response detail when Plivo refuses the send', async () => {
		const { fetchImpl } = fakeFetch([
			{ ok: false, status: 400, body: '{"error":"src is not whatsapp-enabled"}' },
		]);
		const sender = new PlivoWhatsappSender({
			authId: AUTH_ID,
			authToken: AUTH_TOKEN,
			apiUrl: API_URL,
			fetchImpl,
		});
		await expect(sender.sendMessage(MESSAGE)).rejects.toThrow(
			/status 400.*src is not whatsapp-enabled/,
		);
	});
});

describe('PlivoProvisioner', () => {
	const INPUT = {
		accountId: 'acc_1' as AccountId,
		accountName: 'Cascade Plumbing',
		existing: { address: '', providerRef: '' },
	};

	function provisioner(fetchImpl: FetchLike, country = 'us') {
		return new PlivoProvisioner({
			authId: AUTH_ID,
			authToken: AUTH_TOKEN,
			apiUrl: API_URL,
			numberCountry: country,
			fetchImpl,
		});
	}

	it('returns the existing identifier untouched (idempotent re-enable)', async () => {
		const { fetchImpl, calls } = fakeFetch([]);
		const existing = { address: '+15551234567', providerRef: '15551234567' };
		await expect(provisioner(fetchImpl).provision({ ...INPUT, existing })).resolves.toEqual(
			existing,
		);
		expect(calls).toHaveLength(0);
	});

	it('searches for a voice+SMS number, rents it, and returns it as +E.164', async () => {
		const { fetchImpl, calls } = fakeFetch([
			{ ok: true, status: 200, body: '{"objects":[{"number":"14154009186"}]}' },
			{ ok: true, status: 201, body: '{"numbers":[{"number":"14154009186","status":"Success"}]}' },
		]);
		const provisioned = await provisioner(fetchImpl).provision(INPUT);
		expect(provisioned).toEqual({ address: '+14154009186', providerRef: '14154009186' });
		const searchUrl = new URL(calls[0]?.url ?? '');
		expect(searchUrl.pathname).toBe(`/v1/Account/${AUTH_ID}/PhoneNumber/`);
		expect(searchUrl.searchParams.get('country_iso')).toBe('US');
		expect(searchUrl.searchParams.get('services')).toBe('voice,sms');
		expect(calls[0]?.init.method).toBe('GET');
		expect(calls[0]?.init.body).toBeUndefined();
		expect(calls[1]?.url).toBe(`${API_URL}/Account/${AUTH_ID}/PhoneNumber/14154009186/`);
		expect(calls[1]?.init.method).toBe('POST');
	});

	it('fails when the search errors or returns no numbers', async () => {
		const errored = fakeFetch([{ ok: false, status: 500, body: 'upstream sad' }]);
		await expect(provisioner(errored.fetchImpl).provision(INPUT)).rejects.toThrow(
			/search failed \(status 500\)/,
		);
		const empty = fakeFetch([{ ok: true, status: 200, body: '{"objects":[]}' }]);
		await expect(provisioner(empty.fetchImpl).provision(INPUT)).rejects.toThrow(
			/no US numbers with voice\+SMS/,
		);
	});

	it('fails when the rental errors or is not confirmed', async () => {
		const search = { ok: true, status: 200, body: '{"objects":[{"number":"14154009186"}]}' };
		const refused = fakeFetch([search, { ok: false, status: 403, body: 'insufficient funds' }]);
		await expect(provisioner(refused.fetchImpl).provision(INPUT)).rejects.toThrow(
			/refused to rent 14154009186 \(status 403\)/,
		);
		const pending = fakeFetch([
			search,
			{ ok: true, status: 201, body: '{"numbers":[{"number":"14154009186","status":"pending"}]}' },
		]);
		await expect(provisioner(pending.fetchImpl).provision(INPUT)).rejects.toThrow(
			/did not confirm the rental/,
		);
	});

	it('fails when Plivo offers a number that is not valid E.164', async () => {
		const { fetchImpl } = fakeFetch([
			{ ok: true, status: 200, body: '{"objects":[{"number":"not-a-number"}]}' },
			{ ok: true, status: 201, body: '{"numbers":[{"number":"not-a-number","status":"Success"}]}' },
		]);
		await expect(provisioner(fetchImpl).provision(INPUT)).rejects.toThrow(/not valid E\.164/);
	});
});

describe('provider factories', () => {
	it('Plivo factories degrade to no-ops without credentials', () => {
		const config = testConfig();
		expect(createPlivoWhatsappSender(config)).toBeInstanceOf(NoopWhatsappSender);
		expect(createPlivoProvisioner(config)).toBeInstanceOf(NoopChannelProvisioner);
	});

	it('Plivo factories build real adapters when credentials are set', () => {
		const config = testConfig({ PLIVO_AUTH_ID: AUTH_ID, PLIVO_AUTH_TOKEN: AUTH_TOKEN });
		expect(createPlivoWhatsappSender(config)).toBeInstanceOf(PlivoWhatsappSender);
		expect(createPlivoProvisioner(config)).toBeInstanceOf(PlivoProvisioner);
	});

	it('selects Plivo first, then zernio, then the no-ops', () => {
		const plivo = testConfig({
			PLIVO_AUTH_ID: AUTH_ID,
			PLIVO_AUTH_TOKEN: AUTH_TOKEN,
			ZERNIO_API_KEY: 'zk_1',
		});
		expect(createWhatsappSender(plivo)).toBeInstanceOf(PlivoWhatsappSender);
		expect(createWhatsappProvisioner(plivo)).toBeInstanceOf(PlivoProvisioner);

		const zernio = testConfig({ ZERNIO_API_KEY: 'zk_1' });
		expect(createWhatsappSender(zernio)).toBeInstanceOf(ZernioWhatsappSender);
		expect(createWhatsappProvisioner(zernio)).toBeInstanceOf(ZernioProvisioner);

		// One Plivo credential alone is not a configured provider — fall through.
		const partial = testConfig({ PLIVO_AUTH_ID: AUTH_ID });
		expect(createWhatsappSender(partial)).toBeInstanceOf(NoopWhatsappSender);
		expect(createWhatsappProvisioner(partial)).toBeInstanceOf(NoopChannelProvisioner);
	});
});
