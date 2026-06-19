// Copy the API's generated OpenAPI document into the docs site so Docula can
// render it as the API reference. Run `pnpm --filter @rivus/api openapi` first
// to regenerate the source spec from the live route schemas.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../api/openapi.json');
const destination = resolve(here, '../site/openapi.json');

if (!existsSync(source)) {
	console.warn(`[docs] ${source} not found — using the committed openapi.json.`);
	process.exit(0);
}

copyFileSync(source, destination);
console.log(`[docs] synced OpenAPI spec → ${destination}`);
