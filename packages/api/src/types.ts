import type { AuthTokenPayload, Role } from '@rivus/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config';
import type {
	AccountRepository,
	InviteRepository,
	ItemRepository,
	MembershipRepository,
	OnboardingRepository,
	UserRepository,
} from './repositories/types';

/** Everything the Fastify app needs injected — swap repositories in tests. */
export interface AppDeps {
	config: Config;
	users: UserRepository;
	accounts: AccountRepository;
	memberships: MembershipRepository;
	invites: InviteRepository;
	onboarding: OnboardingRepository;
	items: ItemRepository;
	/** Readiness check for downstream dependencies (e.g. the database). */
	ping: () => Promise<boolean>;
}

/** A route guard that rejects requests whose token role is not in `roles`. */
export type RoleGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module 'fastify' {
	interface FastifyInstance {
		deps: AppDeps;
		authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
		/** Build an `onRequest` guard allowing only the given roles (run after `authenticate`). */
		requireRole: (...roles: Role[]) => RoleGuard;
	}
}

declare module '@fastify/jwt' {
	interface FastifyJWT {
		payload: AuthTokenPayload;
		user: AuthTokenPayload;
	}
}
