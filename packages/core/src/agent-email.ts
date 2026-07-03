/**
 * The grammar of an account's inbound "agent" email address. Its local part is
 * `${slug}-${tag}`: the readable business slug plus a short hex tag. The slug is
 * already unique, but the tag pins an explicit, stable id onto every address so
 * that two look-alike business names can never share — or guess — one another's
 * address. Join the local part to `@${AGENT_EMAIL_DOMAIN}` for the full address.
 */

/**
 * The 8-character lowercase hex tag for an account, derived deterministically
 * from its globally-unique id. A plain FNV-1a hash keeps the tag uniform for
 * either id shape (a UUID or a Mongo ObjectId) and, because it is a pure
 * function of an id the account already has, needs no stored column or backfill.
 *
 * @example agentEmailTag('550e8400-e29b-41d4-a716-446655440000') // 8 hex chars
 */
export function agentEmailTag(accountId: string): string {
	// FNV-1a, 32-bit. The tag only needs to be stable and well-distributed, not
	// cryptographic; `Math.imul` keeps the multiply in 32 bits and `>>> 0`
	// re-reads the result as unsigned before it is hex-encoded and zero-padded.
	let hash = 0x811c9dc5;
	for (let index = 0; index < accountId.length; index += 1) {
		hash ^= accountId.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The local part of an account's agent email address — `${slug}-${tag}`. The
 * caller appends `@${AGENT_EMAIL_DOMAIN}` to form the address customers write to.
 *
 * @example agentEmailLocalPart('jw-riv-inc', id) // 'jw-riv-inc-1a2b3c4d'
 */
export function agentEmailLocalPart(slug: string, accountId: string): string {
	return `${slug}-${agentEmailTag(accountId)}`;
}

// The trailing `-<8 hex>` tag on an agent-email local part.
const AGENT_EMAIL_TAG_SUFFIX = /-[0-9a-f]{8}$/;

/**
 * Peel the trailing hex tag off an agent-email local part, returning the bare
 * slug. Left unchanged when there is no tag (a legacy `${slug}@` address), so a
 * caller can resolve both the `${slug}-${tag}` and bare `${slug}` forms back to
 * the same account.
 */
export function stripAgentEmailTag(localPart: string): string {
	return localPart.replace(AGENT_EMAIL_TAG_SUFFIX, '');
}
