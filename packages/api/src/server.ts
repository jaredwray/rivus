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
	MongoVerificationCodeRepository,
} from './repositories/mongo';
import { createMailer } from './services/resend-mailer';

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
		verificationCodes: new MongoVerificationCodeRepository(),
		mailer: createMailer(config),
		ping: async () => isMongoConnected(),
	});

	if (!config.RESEND_API_KEY) {
		app.log.warn('RESEND_API_KEY is not set — invitation emails will not be delivered');
	}

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
