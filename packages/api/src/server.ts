import closeWithGrace from 'close-with-grace';
import { buildApp } from './app';
import { loadConfig } from './config';
import { connectMongoose, disconnectMongoose, isMongoConnected } from './db/mongoose';
import {
	MongoAccountRepository,
	MongoInviteRepository,
	MongoItemRepository,
	MongoMembershipRepository,
	MongoOnboardingRepository,
	MongoUserRepository,
} from './repositories/mongo';

/** Connect to Mongo, build the app with Mongo-backed repositories, and listen. */
export async function start(): Promise<void> {
	const config = loadConfig();
	await connectMongoose(config.MONGODB_URI);

	const app = buildApp({
		config,
		users: new MongoUserRepository(),
		accounts: new MongoAccountRepository(),
		memberships: new MongoMembershipRepository(),
		invites: new MongoInviteRepository(),
		onboarding: new MongoOnboardingRepository(),
		items: new MongoItemRepository(),
		ping: async () => isMongoConnected(),
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
