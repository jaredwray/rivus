// Emit site/dist/robots.txt after the Docula build. Only the production docs
// (docs.rivus.ai) are crawlable; every pre-production build (dev-docs.rivus.ai)
// and local build blocks all crawlers so pre-release docs never land in a
// search index.
//
// The deploy workflows set RIVUS_ENV per Cloudflare environment; anything other
// than "production" (including unset) is treated as non-production.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.RIVUS_ENV === 'production';

const body = isProduction
	? 'User-agent: *\nAllow: /\n'
	: '# Pre-production docs — keep them out of search indexes.\nUser-agent: *\nDisallow: /\n';

const destination = resolve(here, '../site/dist/robots.txt');
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, body);

console.log(
	`[docs] wrote ${destination} (${isProduction ? 'allow all' : 'disallow all'} — RIVUS_ENV=${process.env.RIVUS_ENV ?? 'unset'})`,
);
