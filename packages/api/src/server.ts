import closeWithGrace from 'close-with-grace';
import { buildApp } from './app';
import { loadConfig } from './config';
import { connectMongoose, disconnectMongoose } from './db/mongoose';
import { MongoItemRepository, MongoUserRepository } from './repositories/mongo';

/** Connect to Mongo, build the app with Mongo-backed repositories, and listen. */
export async function start(): Promise<void> {
	const config = loadConfig();
	await connectMongoose(config.MONGODB_URI);

	const app = buildApp({
		config,
		users: new MongoUserRepository(),
		items: new MongoItemRepository(),
	});

	await app.ready();
	await app.listen({ host: config.API_HOST, port: config.API_PORT });

	closeWithGrace({ delay: 10_000 }, async ({ err }) => {
		if (err) {
			app.log.error({ err }, 'shutting down after error');
		}
		await app.close();
		await disconnectMongoose();
	});
}
