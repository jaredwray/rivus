import type { AuthTokenPayload, Role } from '@rivus/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config';
import type {
	AccountRepository,
	CustomerRepository,
	FaqRepository,
	InviteRepository,
	ItemRepository,
	MembershipRepository,
	OnboardingRepository,
	UserRepository,
	VerificationCodeRepository,
} from './repositories/types';
import type { Mailer } from './services/email';
import type { FaqSimilarityService } from './services/faq-similarity';

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
	/** Stores one-time sign-in codes for passwordless auth. */
	verificationCodes: VerificationCodeRepository;
	/** Sends transactional email (invitations and sign-in codes). */
	mailer: Mailer;
	/** AI check for near-duplicate FAQs (a no-op when no provider key is set). */
	faqSimilarity: FaqSimilarityService;
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
