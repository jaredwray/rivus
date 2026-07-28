import { describe, expect, it } from 'vitest';
import type { Config } from '../src/config';
import { FORWARDED_VARS, forwardedEnv } from '../worker/env';

/**
 * The only config keys that may be absent from `FORWARDED_VARS`.
 *
 * - `NODE_ENV` is set explicitly by the container (always `production`), so
 *   forwarding a Worker binding of the same name could only weaken that.
 * - `API_HOST` / `API_PORT` are fixed by the container contract: Fastify must
 *   listen on `0.0.0.0:4000` to match `ApiContainer.defaultPort`, so making them
 *   settable per environment would only ever break the port mapping.
 */
type NotForwarded = 'NODE_ENV' | 'API_HOST' | 'API_PORT';

type Forwarded = (typeof FORWARDED_VARS)[number];

/** Config keys that are neither forwarded nor deliberately excluded. */
type Unforwarded = Exclude<keyof Config, Forwarded | NotForwarded>;

/**
 * Guards the Worker→container env bridge. The messaging channels shipped broken
 * to the deployed environment because these provider vars were set on the
 * Worker but never forwarded into the Fastify container, so `loadConfig()` never
 * saw them and every channel reported "not configured". These tests fail if a
 * provider var is dropped from the forwarding list again.
 */
describe('forwardedEnv', () => {
	it('forwards only the keys that read back a non-empty string', () => {
		const source: Record<string, unknown> = {
			JWT_SECRET: 'secret',
			TWILIO_ACCOUNT_SID: 'AC123',
			TWILIO_AUTH_TOKEN: '',
			MONGODB_URI: undefined,
			// A non-string binding (e.g. the Durable Object namespace) is never forwarded.
			API_CONTAINER: { fetch() {} },
		};
		const forwarded = forwardedEnv(
			['JWT_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'MONGODB_URI', 'API_CONTAINER'],
			(key) => source[key],
		);
		expect(forwarded).toEqual({ JWT_SECRET: 'secret', TWILIO_ACCOUNT_SID: 'AC123' });
		// Unset/empty are dropped — never reach the container as the string "undefined".
		expect('TWILIO_AUTH_TOKEN' in forwarded).toBe(false);
		expect('MONGODB_URI' in forwarded).toBe(false);
	});

	it('ignores keys the source does not have at all', () => {
		expect(forwardedEnv(['NOT_SET'], () => undefined)).toEqual({});
	});
});

describe('FORWARDED_VARS', () => {
	it('forwards every messaging-provider credential and webhook var', () => {
		// The credentials and webhook URLs the container needs to activate a channel.
		const required = [
			'TWILIO_ACCOUNT_SID',
			'TWILIO_AUTH_TOKEN',
			'TWILIO_API_URL',
			'TWILIO_WHATSAPP_WEBHOOK_URL',
			'TWILIO_SMS_WEBHOOK_URL',
			'TWILIO_VOICE_WEBHOOK_URL',
			'TWILIO_NUMBER_COUNTRY',
			'PLIVO_AUTH_ID',
			'PLIVO_AUTH_TOKEN',
			'PLIVO_API_URL',
			'PLIVO_WEBHOOK_URL',
			'PLIVO_SMS_WEBHOOK_URL',
			'PLIVO_NUMBER_COUNTRY',
			'ZERNIO_API_KEY',
			'ZERNIO_API_URL',
			'ZERNIO_WEBHOOK_SECRET',
			'ZERNIO_VERIFY_TOKEN',
		];
		for (const key of required) {
			expect(FORWARDED_VARS).toContain(key);
		}
	});

	it('still forwards the core secrets the API needs to boot', () => {
		for (const key of ['MONGODB_URI', 'JWT_SECRET', 'RESEND_API_KEY', 'APP_URL']) {
			expect(FORWARDED_VARS).toContain(key);
		}
	});

	it('forwards the website-audit keys (ZenRows + Brave)', () => {
		// Same trap as the messaging vars: set on the Worker but not forwarded =
		// the chat forever answers "website audits aren't enabled".
		for (const key of ['ZENROWS_API_KEY', 'BRAVE_SEARCH_API_KEY']) {
			expect(FORWARDED_VARS).toContain(key);
		}
	});

	it('forwards the model overrides, including the embedding models', () => {
		// The embedding models were documented as overridable via wrangler `vars`
		// but never forwarded, so setting one silently kept the default model.
		for (const key of [
			'OPENAI_MODEL',
			'OPENAI_EMBEDDING_MODEL',
			'GEMINI_MODEL',
			'GOOGLE_EMBEDDING_MODEL',
			'XAI_MODEL',
			'ANTHROPIC_MODEL',
		]) {
			expect(FORWARDED_VARS).toContain(key);
		}
	});

	it('forwards every var loadConfig reads, except the deliberate exclusions', () => {
		// A compile-time exhaustiveness check: adding a var to `src/config.ts`
		// without forwarding it (or excluding it above) makes `Unforwarded` a
		// non-empty union, and this annotation stops type-checking. The lists above
		// only catch vars someone thought to enumerate; this catches all of them.
		const everyConfigVarIsForwarded: [Unforwarded] extends [never] ? true : never = true;
		expect(everyConfigVarIsForwarded).toBe(true);
	});
});
