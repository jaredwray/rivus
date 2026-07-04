import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Channel-generic verification of Svix-style webhook signatures — an HMAC-SHA256
 * of `"{id}.{timestamp}.{body}"` keyed with the base64 secret after a `whsec_`
 * prefix, delivered in `{id}`/`{timestamp}`/`{signature}` headers. Resend signs
 * its inbound-email webhooks this way, and other providers (mapped to these
 * fields at the route) can reuse it. Implemented directly on `node:crypto` — the
 * scheme is a few lines of HMAC, not worth a dependency through the supply-chain
 * gate.
 */

/** Reject webhooks whose timestamp is further than this from now (replay guard). */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface WebhookHeaders {
	/** Unique delivery id, part of the signed content. */
	id: string;
	/** Unix seconds the delivery was signed. */
	timestamp: string;
	/** Space-separated list of `v1,<base64>` entries. */
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
 * Sign a payload the Svix way — the counterpart of {@link verifyWebhookSignature},
 * used by tests (and handy for local `curl`s).
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
