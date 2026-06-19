import type { AuthTokenPayload } from '@rivus/core';
import type { Config } from './config';
import type { ItemRepository, UserRepository } from './repositories/types';

/** Everything the Fastify app needs injected — swap repositories in tests. */
export interface AppDeps {
	config: Config;
	users: UserRepository;
	items: ItemRepository;
}

declare module 'fastify' {
	interface FastifyInstance {
		deps: AppDeps;
		authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
	}
}

declare module '@fastify/jwt' {
	interface FastifyJWT {
		payload: AuthTokenPayload;
		user: AuthTokenPayload;
	}
}
