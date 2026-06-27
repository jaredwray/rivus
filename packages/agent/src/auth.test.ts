import { describe, expect, it } from 'vitest';
import {
	authenticate,
	extractSessionToken,
	parseCookies,
	SESSION_COOKIE,
	verifySessionToken,
} from './auth';

const SECRET = 'test-secret-value-1234';

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeSegment(value: unknown): string {
	return base64Url(encoder.encode(JSON.stringify(value)));
}

/** Mint an HS256 JWT the way `@rivus/api` does, for verification tests. */
async function signToken(
	payload: Record<string, unknown>,
	secret = SECRET,
	header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
): Promise<string> {
	const data = `${encodeSegment(header)}.${encodeSegment(payload)}`;
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
	return `${data}.${base64Url(signature)}`;
}

const validClaims = {
	sub: 'user_1',
	email: 'owner@acme.com',
	accountId: 'acct_1',
	role: 'owner' as const,
};

/** A token that expires an hour out, so it's valid "now". */
function freshPayload(over: Record<string, unknown> = {}) {
	return { ...validClaims, exp: Math.floor(Date.now() / 1000) + 3600, ...over };
}

function requestWith(headers: Record<string, string>): Request {
	return new Request('https://agent.test/agents/rivus-agent/default', { method: 'POST', headers });
}

describe('parseCookies', () => {
	it('returns an empty object for no header', () => {
		expect(parseCookies(null)).toEqual({});
	});

	it('parses one and many cookies, trimming whitespace', () => {
		expect(parseCookies('a=1')).toEqual({ a: '1' });
		expect(parseCookies('a=1; b=2;c=3')).toEqual({ a: '1', b: '2', c: '3' });
	});

	it('URL-decodes values and tolerates malformed encoding', () => {
		expect(parseCookies('x=hello%20world')).toEqual({ x: 'hello world' });
		expect(parseCookies('x=100%')).toEqual({ x: '100%' });
	});

	it('skips entries with no name', () => {
		expect(parseCookies('=oops; a=1')).toEqual({ a: '1' });
	});
});

describe('extractSessionToken', () => {
	it('reads a Bearer token (case-insensitive)', () => {
		expect(extractSessionToken(requestWith({ Authorization: 'Bearer abc.def.ghi' }))).toBe(
			'abc.def.ghi',
		);
		expect(extractSessionToken(requestWith({ authorization: 'bearer xyz' }))).toBe('xyz');
	});

	it('falls back to the session cookie', () => {
		expect(extractSessionToken(requestWith({ cookie: `${SESSION_COOKIE}=cookie.jwt` }))).toBe(
			'cookie.jwt',
		);
	});

	it('prefers the Authorization header over the cookie', () => {
		const request = requestWith({
			Authorization: 'Bearer header.jwt',
			cookie: `${SESSION_COOKIE}=cookie.jwt`,
		});
		expect(extractSessionToken(request)).toBe('header.jwt');
	});

	it('returns null when neither is present', () => {
		expect(extractSessionToken(requestWith({}))).toBeNull();
		// A non-Bearer Authorization scheme is ignored.
		expect(extractSessionToken(requestWith({ Authorization: 'Basic abc' }))).toBeNull();
	});
});

describe('verifySessionToken', () => {
	it('accepts a valid, unexpired token and returns the claims', async () => {
		const token = await signToken(freshPayload());
		expect(await verifySessionToken(token, SECRET)).toEqual(validClaims);
	});

	it('accepts a token with no exp', async () => {
		const token = await signToken(validClaims);
		expect(await verifySessionToken(token, SECRET)).toEqual(validClaims);
	});

	it('rejects when no secret is configured', async () => {
		const token = await signToken(freshPayload());
		expect(await verifySessionToken(token, undefined)).toBeNull();
	});

	it('rejects a token signed with a different secret', async () => {
		const token = await signToken(freshPayload(), 'some-other-secret');
		expect(await verifySessionToken(token, SECRET)).toBeNull();
	});

	it('rejects an expired token', async () => {
		const token = await signToken(freshPayload({ exp: Math.floor(Date.now() / 1000) - 10 }));
		expect(await verifySessionToken(token, SECRET)).toBeNull();
	});

	it('rejects a not-yet-valid token', async () => {
		const token = await signToken(freshPayload({ nbf: Math.floor(Date.now() / 1000) + 600 }));
		expect(await verifySessionToken(token, SECRET)).toBeNull();
	});

	it('rejects an alg other than HS256 (no alg:none, no algorithm confusion)', async () => {
		const none = await signToken(freshPayload(), SECRET, { alg: 'none', typ: 'JWT' });
		expect(await verifySessionToken(none, SECRET)).toBeNull();
		const rs256 = await signToken(freshPayload(), SECRET, { alg: 'RS256', typ: 'JWT' });
		expect(await verifySessionToken(rs256, SECRET)).toBeNull();
	});

	it('rejects a structurally malformed token', async () => {
		expect(await verifySessionToken('only.two', SECRET)).toBeNull();
		expect(await verifySessionToken('a.b.c.d', SECRET)).toBeNull();
		expect(await verifySessionToken('', SECRET)).toBeNull();
	});

	it('rejects a token whose segments are not valid base64url JSON', async () => {
		expect(await verifySessionToken('!!!.@@@.###', SECRET)).toBeNull();
	});

	it('rejects a valid signature over claims missing a required field', async () => {
		const { accountId, ...withoutAccount } = freshPayload();
		void accountId;
		const token = await signToken(withoutAccount);
		expect(await verifySessionToken(token, SECRET)).toBeNull();
	});

	it('rejects a token carrying an invalid role', async () => {
		const token = await signToken(freshPayload({ role: 'superadmin' }));
		expect(await verifySessionToken(token, SECRET)).toBeNull();
	});
});

describe('authenticate', () => {
	it('returns the token and claims for a valid bearer session', async () => {
		const token = await signToken(freshPayload());
		const result = await authenticate(requestWith({ Authorization: `Bearer ${token}` }), SECRET);
		expect(result).toEqual({ token, claims: validClaims });
	});

	it('returns the session from the cookie', async () => {
		const token = await signToken(freshPayload());
		const result = await authenticate(
			requestWith({ cookie: `${SESSION_COOKIE}=${token}` }),
			SECRET,
		);
		expect(result?.claims).toEqual(validClaims);
	});

	it('returns null when there is no token', async () => {
		expect(await authenticate(requestWith({}), SECRET)).toBeNull();
	});

	it('returns null when the token does not verify', async () => {
		const token = await signToken(freshPayload(), 'wrong-secret');
		expect(
			await authenticate(requestWith({ Authorization: `Bearer ${token}` }), SECRET),
		).toBeNull();
	});
});
