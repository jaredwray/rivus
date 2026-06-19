import { start } from './server';

start().catch((error) => {
	console.error(error);
	// Force exit so leftover handles from a failed startup can't leave a zombie
	// process that an orchestrator won't restart.
	process.exit(1);
});
