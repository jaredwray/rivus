// Emit dist/robots.txt after the Expo web export. Only the production
// deployment (app.rivus.ai) is crawlable; every pre-production build
// (dev-app.rivus.ai) and local export blocks all crawlers so the
// pre-release app never lands in a search index.
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
	: '# Pre-production app — keep it out of search indexes.\nUser-agent: *\nDisallow: /\n';

const destination = resolve(here, '../dist/robots.txt');
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, body);

console.log(
	`[app] wrote ${destination} (${isProduction ? 'allow all' : 'disallow all'} — RIVUS_ENV=${process.env.RIVUS_ENV ?? 'unset'})`,
);
