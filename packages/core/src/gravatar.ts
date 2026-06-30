/**
 * Gravatar shows a profile photo for an email address without any account setup
 * on our side — it's keyed by the MD5 hash of the (trimmed, lowercased) address,
 * per https://docs.gravatar.com/api/avatars/images/. MD5 isn't used for anything
 * security-sensitive here, just as the public lookup key the Gravatar API
 * expects, so a small dependency-free implementation keeps this working
 * identically across Node, the browser, Cloudflare Workers, and the Expo app
 * without relying on a platform crypto API that isn't uniformly available across
 * all of them.
 */

const SHIFTS = [
	7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
	20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
	10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// `floor(abs(sin(i + 1)) * 2**32)` for i in 0..63, per RFC 1321.
const SINE_TABLE = [
	0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
	0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
	0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
	0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
	0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
	0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
	0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
	0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

function rotateLeft(value: number, bits: number): number {
	return (value << bits) | (value >>> (32 - bits));
}

/**
 * Index into one of the fixed-size lookup tables above. The indices used below
 * are always in range (derived from a fixed round count and chunk size) — this
 * just satisfies `noUncheckedIndexedAccess` in one place instead of scattering
 * non-null assertions through the round function.
 */
function at(values: readonly number[], index: number): number {
	// biome-ignore lint/style/noNonNullAssertion: index is always in range, see above.
	return values[index]!;
}

/** Pad a message per the MD5 spec: a `1` bit, zero bits to 448 mod 512, then its 64-bit length. */
function pad(message: Uint8Array): Uint8Array {
	const bitLength = message.length * 8;
	let paddedLength = message.length + 1;
	while (paddedLength % 64 !== 56) {
		paddedLength += 1;
	}
	const padded = new Uint8Array(paddedLength + 8);
	padded.set(message);
	padded[message.length] = 0x80;
	const view = new DataView(padded.buffer);
	// Realistic inputs here (email addresses) are far short of 2**32 bits, so the
	// high 32 bits of the 64-bit little-endian length are always zero.
	view.setUint32(paddedLength, bitLength >>> 0, true);
	view.setUint32(paddedLength + 4, 0, true);
	return padded;
}

function wordToHexLE(word: number): string {
	let hex = '';
	for (let i = 0; i < 4; i++) {
		hex += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
	}
	return hex;
}

/** The MD5 digest of `message` as a lowercase 32-character hex string (RFC 1321). */
function md5Hex(message: string): string {
	const padded = pad(new TextEncoder().encode(message));
	const view = new DataView(padded.buffer);

	let a0 = 0x67452301;
	let b0 = 0xefcdab89;
	let c0 = 0x98badcfe;
	let d0 = 0x10325476;

	for (let chunk = 0; chunk < padded.length; chunk += 64) {
		const words: number[] = [];
		for (let i = 0; i < 16; i++) {
			words.push(view.getUint32(chunk + i * 4, true));
		}

		let a = a0;
		let b = b0;
		let c = c0;
		let d = d0;

		for (let i = 0; i < 64; i++) {
			let f: number;
			let g: number;
			if (i < 16) {
				f = (b & c) | (~b & d);
				g = i;
			} else if (i < 32) {
				f = (d & b) | (~d & c);
				g = (5 * i + 1) % 16;
			} else if (i < 48) {
				f = b ^ c ^ d;
				g = (3 * i + 5) % 16;
			} else {
				f = c ^ (b | ~d);
				g = (7 * i) % 16;
			}
			f = (f + a + at(SINE_TABLE, i) + at(words, g)) | 0;
			a = d;
			d = c;
			c = b;
			b = (b + rotateLeft(f, at(SHIFTS, i))) | 0;
		}

		a0 = (a0 + a) | 0;
		b0 = (b0 + b) | 0;
		c0 = (c0 + c) | 0;
		d0 = (d0 + d) | 0;
	}

	return [a0, b0, c0, d0].map(wordToHexLE).join('');
}

/** The image Gravatar serves when the email has no avatar set. */
export type GravatarDefault =
	| '404'
	| 'mp'
	| 'identicon'
	| 'monsterid'
	| 'wavatar'
	| 'retro'
	| 'robohash'
	| 'blank';

export interface GravatarOptions {
	/** Image size in pixels (Gravatar serves a square image). Defaults to `200`. */
	size?: number;
	/**
	 * What Gravatar serves when the email has no avatar. Defaults to `'404'` —
	 * an actual HTTP 404 — so callers can detect "no Gravatar" (e.g. an `<Image>`
	 * `onError`) and fall back to initials, instead of always getting Gravatar's
	 * generic placeholder art.
	 */
	default?: GravatarDefault;
}

/**
 * Build a Gravatar image URL for an email address — no API call or account
 * setup required, since Gravatar derives the image purely from the email's MD5
 * hash. See https://docs.gravatar.com/api/avatars/images/.
 *
 * @example gravatarUrl('jane@example.com') // 'https://www.gravatar.com/avatar/...?s=200&d=404'
 */
export function gravatarUrl(email: string, options: GravatarOptions = {}): string {
	const hash = md5Hex(email.trim().toLowerCase());
	const params = new URLSearchParams({
		s: String(options.size ?? 200),
		d: options.default ?? '404',
	});
	return `https://www.gravatar.com/avatar/${hash}?${params.toString()}`;
}
