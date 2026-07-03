import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verification of Resend's inbound-email webhook signatures. Resend signs
 * webhooks the Svix way: an HMAC-SHA256 of `"{id}.{timestamp}.{body}"` keyed
 * with the base64 secret after the `whsec_` prefix, delivered in the
 * `svix-id`/`svix-timestamp`/`svix-signature` headers. Implemented directly on
 * `node:crypto` — the scheme is three lines of HMAC, which isn't worth a new
 * dependency through the supply-chain gate.
 */

/** Reject webhooks whose timestamp is further than this from now (replay guard). */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface WebhookHeaders {
	/** `svix-id` — unique delivery id, part of the signed content. */
	id: string;
	/** `svix-timestamp` — unix seconds the delivery was signed. */
	timestamp: string;
	/** `svix-signature` — space-separated list of `v1,<base64>` entries. */
	signature: string;
}

/** The `whsec_`-prefixed secret's raw key bytes. */
function secretKey(secret: string): Buffer {
	const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
	return Buffer.from(encoded, 'base64');
}

/**
 * Whether a webhook delivery is authentically signed with `secret` and fresh
 * enough to act on. Comparison is timing-safe; multiple signature entries
 * (present while a secret is being rotated) are each tried.
 */
export function verifyWebhookSignature(options: {
	secret: string;
	headers: WebhookHeaders;
	/** The raw request body, byte-for-byte as received. */
	payload: string;
	/** The current instant — injected so tests are deterministic. */
	now: Date;
}): boolean {
	const { id, timestamp, signature } = options.headers;
	if (!id || !timestamp || !signature) {
		return false;
	}
	const timestampSeconds = Number(timestamp);
	if (!Number.isFinite(timestampSeconds)) {
		return false;
	}
	const skew = Math.abs(options.now.getTime() / 1000 - timestampSeconds);
	if (skew > WEBHOOK_TOLERANCE_SECONDS) {
		return false;
	}

	const expected = createHmac('sha256', secretKey(options.secret))
		.update(`${id}.${timestamp}.${options.payload}`)
		.digest();

	// The header carries one or more space-separated `v1,<base64>` entries.
	return signature.split(' ').some((entry) => {
		const [version, encoded] = entry.split(',');
		if (version !== 'v1' || !encoded) {
			return false;
		}
		const candidate = Buffer.from(encoded, 'base64');
		return candidate.length === expected.length && timingSafeEqual(candidate, expected);
	});
}

/**
 * Sign a payload the way Svix/Resend does — the counterpart of
 * {@link verifyWebhookSignature}, used by tests (and handy for local `curl`s).
 */
export function signWebhookPayload(options: {
	secret: string;
	id: string;
	timestamp: string;
	payload: string;
}): string {
	const digest = createHmac('sha256', secretKey(options.secret))
		.update(`${options.id}.${options.timestamp}.${options.payload}`)
		.digest('base64');
	return `v1,${digest}`;
}
