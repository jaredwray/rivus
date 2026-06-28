import type { AuthTokenPayload, Role } from '@rivus/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config';
import type {
	AccountRepository,
	CustomerRepository,
	FaqRepository,
	InviteRepository,
	ItemRepository,
	JobRepository,
	MembershipRepository,
	NotificationRepository,
	OnboardingRepository,
	UserRepository,
	VerificationCodeRepository,
} from './repositories/types';
import type { Mailer } from './services/email';
import type { FaqAnswerService } from './services/faq-answer';
import type { FaqSimilarityService } from './services/faq-similarity';
import type { NotificationService } from './services/notifications';

/** Result of a readiness check: whether dependencies are usable, and why not. */
export interface ReadinessResult {
	ready: boolean;
	/** A bounded, probe-safe explanation when `ready` is false (no request internals). */
	reason?: string;
}

/** Everything the Fastify app needs injected — swap repositories in tests. */
export interface AppDeps {
	config: Config;
	users: UserRepository;
	accounts: AccountRepository;
	memberships: MembershipRepository;
	invites: InviteRepository;
	onboarding: OnboardingRepository;
	items: ItemRepository;
	faqs: FaqRepository;
	customers: CustomerRepository;
	/** Scheduled jobs (appointments) on the account's calendar. */
	jobs: JobRepository;
	/** Per-user notifications (the bell). */
	notifications: NotificationRepository;
	/** Stores one-time sign-in codes for passwordless auth. */
	verificationCodes: VerificationCodeRepository;
	/** Sends transactional email (invitations and sign-in codes). */
	mailer: Mailer;
	/** Turns domain events (job assigned, invite accepted, …) into notifications. */
	notifier: NotificationService;
	/** AI check for near-duplicate FAQs (a no-op when no provider key is set). */
	faqSimilarity: FaqSimilarityService;
	/** AI answering of questions from the knowledge base (deterministic when no key is set). */
	faqAnswer: FaqAnswerService;
	/** Readiness check for downstream dependencies (e.g. the database). */
	ping: () => Promise<ReadinessResult>;
}

/** A route guard that rejects requests whose token role is not in `roles`. */
export type RoleGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module 'fastify' {
	interface FastifyInstance {
		deps: AppDeps;
		authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
		/** Build an `onRequest` guard allowing only the given roles (run after `authenticate`). */
		requireRole: (...roles: Role[]) => RoleGuard;
		/** `onRequest` guard allowing only Rivus staff (run after `authenticate`). */
		requireStaff: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
	}
}

declare module '@fastify/jwt' {
	interface FastifyJWT {
		payload: AuthTokenPayload;
		user: AuthTokenPayload;
	}
}
