import { type Account, agentEmailLocalPart } from '@rivus/core';

/**
 * Addressing for outbound agent mail — the one thing every reply into an email
 * thread shares, whether it comes from the scheduling engine (the webhook) or a
 * human answering in the inbox. Rendering lives in `templates.ts`; this is just
 * who the mail is *from*.
 */

/** A display name safe to place before `<address>` in a From header. */
export function sanitizeDisplayName(name: string): string {
	return name.replace(/[\r\n"<>]/g, '').trim();
}

/**
 * The account's canonical agent `From` header: its tagged agent address
 * (`<slug>-<hex>@domain`) with the business name as a quoted display name when
 * it has one. Quoting lets names with commas or periods ("Cascade Plumbing,
 * Inc.") survive RFC 5322 parsing — {@link sanitizeDisplayName} has already
 * stripped any quotes. Every reply on the thread goes out from this single
 * address, so the customer sees one consistent sender.
 */
export function agentFromHeader(account: Account, agentDomain: string): string {
	const address = `${agentEmailLocalPart(account.slug, account.id)}@${agentDomain}`;
	const displayName = sanitizeDisplayName(account.agentName);
	return displayName === '' ? address : `"${displayName}" <${address}>`;
}
