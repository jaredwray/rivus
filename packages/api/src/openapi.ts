import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { loadConfig } from './config';
import { InMemoryItemRepository, InMemoryUserRepository } from './repositories/memory';

/**
 * Boot the app with in-memory repositories (no database needed) purely to read
 * the generated OpenAPI document and write it to `openapi.json`, which the docs
 * site consumes for its API reference.
 */
async function main(): Promise<void> {
	const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
	const app = buildApp({
		config,
		users: new InMemoryUserRepository(),
		items: new InMemoryItemRepository(),
		ping: async () => true,
	});

	await app.ready();
	const spec = app.swagger();
	const outPath = fileURLToPath(new URL('../openapi.json', import.meta.url));
	writeFileSync(outPath, `${JSON.stringify(spec, null, 2)}\n`);
	await app.close();
	process.stdout.write(`Wrote ${outPath}\n`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
