import closeWithGrace from 'close-with-grace';
import { buildApp } from './app';
import { loadConfig } from './config';
import { checkDatabaseReady, connectMongoose, disconnectMongoose } from './db/mongoose';
import {
	MongoAccountRepository,
	MongoAgentThreadRepository,
	MongoConversationRepository,
	MongoCustomerRepository,
	MongoFaqRepository,
	MongoInviteRepository,
	MongoItemRepository,
	MongoJobRepository,
	MongoMembershipRepository,
	MongoNotificationRepository,
	MongoOnboardingRepository,
	MongoUserRepository,
	MongoVerificationCodeRepository,
} from './repositories/mongo';
import { createReceivedEmailReader } from './services/agent/email/received';
import { createDeciderFromConfig } from './services/chat/decide';
import { createFaqAnswerService } from './services/faq-answer';
import { createFaqSimilarityService } from './services/faq-similarity';
import {
	createSmsProvisioner,
	createSmsSender,
	createWhatsappProvisioner,
	createWhatsappSender,
} from './services/messaging-provider';
import { createNotificationService } from './services/notifications';
import { createMailer } from './services/resend-mailer';

/** Connect to Mongo, build the app with Mongo-backed repositories, and listen. */
export async function start(): Promise<void> {
	const config = loadConfig();
	await connectMongoose(config.MONGODB_URI);

	const notifications = new MongoNotificationRepository();
	const app = buildApp({
		config,
		users: new MongoUserRepository(),
		accounts: new MongoAccountRepository(),
		memberships: new MongoMembershipRepository(),
		invites: new MongoInviteRepository(),
		onboarding: new MongoOnboardingRepository(),
		items: new MongoItemRepository(),
		faqs: new MongoFaqRepository(),
		customers: new MongoCustomerRepository(),
		jobs: new MongoJobRepository(),
		notifications,
		conversations: new MongoConversationRepository(),
		agentThreads: new MongoAgentThreadRepository(),
		verificationCodes: new MongoVerificationCodeRepository(),
		mailer: createMailer(config),
		receivedEmails: createReceivedEmailReader(config),
		whatsappSender: createWhatsappSender(config),
		whatsappProvisioner: createWhatsappProvisioner(config),
		smsSender: createSmsSender(config),
		smsProvisioner: createSmsProvisioner(config),
		notifier: createNotificationService({ notifications }),
		faqSimilarity: createFaqSimilarityService(config),
		faqAnswer: createFaqAnswerService(config),
		chatDecider: createDeciderFromConfig(config),
		// Real readiness: run an actual query so "connected but unauthorized" reports
		// unready (503, with the reason) instead of falsely healthy.
		ping: checkDatabaseReady,
	});

	// `connect()` only proves the client authenticated. A user that authenticates but
	// lacks roles on the database fails every query with "not authorized", so verify
	// real access and log a loud, actionable message if it's missing. We don't exit:
	// staying up lets `/ready` report the reason (503) instead of crash-looping out
	// of reach, and a transient blip self-heals on the next request.
	const readiness = await checkDatabaseReady();
	if (!readiness.ready) {
		app.log.error(
			{ reason: readiness.reason },
			'MongoDB is connected but not usable — the database user authenticated but appears ' +
				'unauthorized to read/write the database, so every request will fail until this is ' +
				'fixed. Grant the user readWrite on the database (Atlas: Database Access → Edit user) ' +
				'and confirm MONGODB_URI uses the correct database name and authSource.',
		);
	}

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
