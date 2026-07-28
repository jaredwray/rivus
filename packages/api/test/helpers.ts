import { faker } from '@faker-js/faker';
import type { Account, Role, User } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createInMemoryRepositories, type InMemoryRepositories } from '../src/repositories/memory';
import { NoopReceivedEmailReader } from '../src/services/agent/email/received';
import { NoopChannelProvisioner, NoopNumberReleaser } from '../src/services/channel-provisioning';
import { createDecider } from '../src/services/chat/decide';
import type {
	AgentEmail,
	DemoLeadEmail,
	InviteEmail,
	Mailer,
	VerificationEmail,
} from '../src/services/email';
import { NoopFaqAnswerService } from '../src/services/faq-answer';
import { NoopFaqSimilarityService } from '../src/services/faq-similarity';
import { createNotificationService } from '../src/services/notifications';
import type { SmsMessage, SmsSender } from '../src/services/sms';
import { createWebsiteAuditService } from '../src/services/website-audit';
import type { WhatsappMessage, WhatsappSender } from '../src/services/whatsapp';
import type { AppDeps } from '../src/types';

/** A mailer that records every send so tests can assert on (and read) delivered email. */
export class RecordingMailer implements Mailer {
	readonly invites: InviteEmail[] = [];
	readonly codes: VerificationEmail[] = [];
	readonly agentEmails: AgentEmail[] = [];
	readonly demoLeadEmails: DemoLeadEmail[] = [];
	/** When set, the next lead notification rejects once (delivery-failure path). */
	failNextDemoLeadEmail = false;

	async sendInviteEmail(email: InviteEmail): Promise<void> {
		this.invites.push(email);
	}

	async sendVerificationCode(email: VerificationEmail): Promise<void> {
		this.codes.push(email);
	}

	async sendAgentEmail(email: AgentEmail): Promise<void> {
		this.agentEmails.push(email);
	}

	async sendDemoLeadEmail(email: DemoLeadEmail): Promise<void> {
		if (this.failNextDemoLeadEmail) {
			this.failNextDemoLeadEmail = false;
			throw new Error('demo-lead email failed (test)');
		}
		this.demoLeadEmails.push(email);
	}
}

/** A WhatsApp sender that records every message so tests can assert on delivery. */
export class RecordingWhatsappSender implements WhatsappSender {
	readonly messages: WhatsappMessage[] = [];
	/** When set, the next send rejects once (to exercise the booking-rollback path). */
	failNext = false;

	async sendMessage(message: WhatsappMessage): Promise<void> {
		if (this.failNext) {
			this.failNext = false;
			throw new Error('WhatsApp send failed (test)');
		}
		this.messages.push(message);
	}
}

/** An SMS sender that records every message so tests can assert on delivery. */
export class RecordingSmsSender implements SmsSender {
	readonly messages: SmsMessage[] = [];
	/** When set, the next send rejects once (to exercise the booking-rollback path). */
	failNext = false;

	async sendMessage(message: SmsMessage): Promise<void> {
		if (this.failNext) {
			this.failNext = false;
			throw new Error('SMS send failed (test)');
		}
		this.messages.push(message);
	}
}

const TEST_CONFIG = {
	NODE_ENV: 'test',
	JWT_SECRET: 'test-secret-value-1234',
} as NodeJS.ProcessEnv;

export async function buildTestApp(overrides: Partial<AppDeps> = {}): Promise<FastifyInstance> {
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
		demoLeads,
	} = createInMemoryRepositories();
	const app = buildApp({
		config: loadConfig(TEST_CONFIG),
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
		demoLeads,
		// A recording mailer by default so helpers can read back the emailed code.
		mailer: new RecordingMailer(),
		// No inbound-email fetching in tests — webhook payloads embed their content.
		receivedEmails: new NoopReceivedEmailReader(),
		whatsappSender: new RecordingWhatsappSender(),
		whatsappProvisioner: new NoopChannelProvisioner(),
		smsSender: new RecordingSmsSender(),
		smsProvisioner: new NoopChannelProvisioner(),
		numberReleaser: new NoopNumberReleaser(),
		// A real notification service over the in-memory store, so route emission is
		// exercised end-to-end in tests.
		notifier: createNotificationService({ notifications }),
		// Default to the no-op AI services so tests stay hermetic (no model/network).
		faqSimilarity: new NoopFaqSimilarityService(),
		faqAnswer: new NoopFaqAnswerService(),
		// The model-less decider routes chat deterministically — hermetic by default.
		chatDecider: createDecider(),
		// No provider keys in tests, so the audit answers "disabled" — hermetic,
		// and exactly what an unconfigured server does.
		websiteAudit: createWebsiteAuditService({}),
		ping: async () => ({ ready: true }),
		...overrides,
	});
	await app.ready();
	return app;
}

/**
 * Build an app whose repositories are exposed, so a test can seed data directly
 * (e.g. a user with no membership) to exercise edge cases. `overrides` swaps
 * individual deps (e.g. a fake provisioner) on top of the defaults.
 */
export async function buildTestAppWithRepos(overrides: Partial<AppDeps> = {}): Promise<{
	app: FastifyInstance;
	repos: InMemoryRepositories;
}> {
	const repos = createInMemoryRepositories();
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
		demoLeads,
	} = repos;
	const app = buildApp({
		config: loadConfig(TEST_CONFIG),
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
		demoLeads,
		mailer: new RecordingMailer(),
		receivedEmails: new NoopReceivedEmailReader(),
		whatsappSender: new RecordingWhatsappSender(),
		whatsappProvisioner: new NoopChannelProvisioner(),
		smsSender: new RecordingSmsSender(),
		smsProvisioner: new NoopChannelProvisioner(),
		numberReleaser: new NoopNumberReleaser(),
		notifier: createNotificationService({ notifications }),
		faqSimilarity: new NoopFaqSimilarityService(),
		faqAnswer: new NoopFaqAnswerService(),
		chatDecider: createDecider(),
		websiteAudit: createWebsiteAuditService({}),
		ping: async () => ({ ready: true }),
		...overrides,
	});
	await app.ready();
	return { app, repos };
}

/** Read the most recent one-time code emailed to `email` (throws if none). */
export function latestCodeFor(app: FastifyInstance, email: string): string {
	const mailer = app.deps.mailer;
	if (!(mailer instanceof RecordingMailer)) {
		throw new Error('latestCodeFor requires the app to use a RecordingMailer');
	}
	const normalized = email.trim().toLowerCase();
	const last = mailer.codes.filter((entry) => entry.to === normalized).at(-1);
	if (!last) {
		throw new Error(`no verification code was emailed to ${normalized}`);
	}
	return last.code;
}

export interface SignupCredentials {
	email: string;
	name: string;
	businessName: string;
}

export function fakeSignup(overrides: Partial<SignupCredentials> = {}): SignupCredentials {
	return {
		email: faker.internet.email().toLowerCase(),
		name: faker.person.fullName(),
		businessName: faker.company.name(),
		...overrides,
	};
}

export interface SignedUpUser {
	credentials: SignupCredentials;
	token: string;
	user: User;
	account: Account;
	role: Role;
}

/** Run the passwordless signup → verify flow and return the resulting session. */
export async function signupOwner(
	app: FastifyInstance,
	overrides: Partial<SignupCredentials> = {},
): Promise<SignedUpUser> {
	const credentials = fakeSignup(overrides);
	await app.inject({
		method: 'POST',
		url: '/v1/auth/signup',
		payload: {
			email: credentials.email,
			name: credentials.name,
			business: { businessName: credentials.businessName },
		},
	});
	const verified = await app.inject({
		method: 'POST',
		url: '/v1/auth/verify',
		payload: { email: credentials.email, code: latestCodeFor(app, credentials.email) },
	});
	const body = verified.json<{ token: string; user: User; account: Account; role: Role }>();
	return {
		credentials,
		token: body.token,
		user: body.user,
		account: body.account,
		role: body.role,
	};
}

export function authHeader(token: string): { authorization: string } {
	return { authorization: `Bearer ${token}` };
}

/** Invite a teammate with the given role and accept it, returning their session. */
export async function addMember(
	app: FastifyInstance,
	ownerToken: string,
	role: Role,
	email: string,
): Promise<{ token: string; userId: string }> {
	const invite = await app.inject({
		method: 'POST',
		url: '/v1/members/invites',
		headers: authHeader(ownerToken),
		payload: { email, name: 'Teammate', role },
	});
	const inviteToken = invite.json().token as string;
	const accepted = await app.inject({
		method: 'POST',
		url: '/v1/auth/accept-invite',
		payload: { token: inviteToken },
	});
	const body = accepted.json();
	return { token: body.token as string, userId: body.user.id as string };
}
