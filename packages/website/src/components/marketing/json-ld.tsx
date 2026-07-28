/**
 * Embeds a JSON-LD structured-data block. The payload is always built from
 * our own static content files (never user input), serialized with
 * `JSON.stringify`, and `<` is escaped so no markup can terminate the script
 * element early.
 */
export function JsonLd({ data }: { data: object }) {
	const json = JSON.stringify(data).replace(/</g, '\\u003c');
	return (
		// biome-ignore lint/security/noDangerouslySetInnerHtml: static site-owned JSON, serialized and `<`-escaped above.
		<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
	);
}
