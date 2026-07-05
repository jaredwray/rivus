import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createInMemoryRepositories } from './repositories/memory';
import { NoopReceivedEmailReader } from './services/agent/email/received';
import { NoopChannelProvisioner } from './services/channel-provisioning';
import { NoopMailer } from './services/email';
import { NoopFaqAnswerService } from './services/faq-answer';
import { NoopFaqSimilarityService } from './services/faq-similarity';
import { createNotificationService } from './services/notifications';
import { NoopSmsSender } from './services/sms';
import { NoopWhatsappSender } from './services/whatsapp';

/**
 * Boot the app with in-memory repositories (no database needed) purely to read
 * the generated OpenAPI document and write it to `openapi.json`, which the docs
 * site consumes for its API reference.
 */
async function main(): Promise<void> {
	const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
	const {
		users,
		accounts,
		memberships,
		invites,
		onboarding,
		items,
		faqs,
		customers,
		jobs,
		notifications,
		conversations,
		agentThreads,
		verificationCodes,
	} = createInMemoryRepositories();
	const app = buildApp({
		config,
		users,
		accounts,
		memberships,
		invites,
		onboarding,
		items,
		faqs,
		customers,
		jobs,
		notifications,
		conversations,
		agentThreads,
		verificationCodes,
		mailer: new NoopMailer(),
		receivedEmails: new NoopReceivedEmailReader(),
		whatsappSender: new NoopWhatsappSender(),
		whatsappProvisioner: new NoopChannelProvisioner(),
		smsSender: new NoopSmsSender(),
		smsProvisioner: new NoopChannelProvisioner(),
		notifier: createNotificationService({ notifications }),
		faqSimilarity: new NoopFaqSimilarityService(),
		faqAnswer: new NoopFaqAnswerService(),
		ping: async () => ({ ready: true }),
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
