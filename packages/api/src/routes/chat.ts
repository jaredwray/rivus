import { type ChatMessage, chatRequestSchema } from '@rivus/core';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { chatReplyResponseSchema, errorResponseSchema } from '../http-schemas';
import { createChatActions } from '../services/chat/actions';
import { GREETING } from '../services/chat/conversation';
import { type ChatSession, respond } from '../services/chat/respond';

/**
 * The Rivus chat endpoint — the in-process successor to the standalone
 * `@rivus/agent` Worker. The wire contract is unchanged: the app posts the
 * conversation (`{ messages }`) and gets a single `{ reply }` back.
 *
 * Authentication is deliberately *optional* and never a 401 from this route:
 * anonymous visitors get the greeting, help, and friendly sign-in nudges, and a
 * token that no longer revalidates gets a "please sign in again" reply — the
 * chat window must read as a conversation, not an error surface. Once a session
 * is live, every action executes with the same revalidation `authenticate`
 * performs and scoped to the session's account.
 */
export const chatRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const deps = app.deps;

	// A friendly smoke test you can hit straight from a browser (no auth), kept
	// from the standalone agent endpoint.
	app.get(
		'/',
		{
			schema: {
				tags: ['chat'],
				summary: "Rivus's greeting (a no-auth smoke test)",
				response: { 200: chatReplyResponseSchema },
			},
		},
		async () => ({ reply: GREETING }),
	);

	app.post(
		'/',
		{
			schema: {
				tags: ['chat'],
				summary: 'Chat with Rivus',
				description:
					'Send the conversation so far and receive Rivus’s reply. Authentication is ' +
					'optional: signed-in sessions (bearer token or session cookie) can ask about ' +
					'their company and search or update their knowledge base; anonymous callers ' +
					'are greeted and nudged to sign in.',
				body: chatRequestSchema,
				response: { 200: chatReplyResponseSchema, 400: errorResponseSchema },
			},
		},
		async (request) => {
			const session = await resolveChatSession(app, request);
			// The `message` shorthand wins over `messages`, as it did on the agent.
			const messages: ChatMessage[] =
				request.body.message !== undefined
					? [{ role: 'user', content: request.body.message }]
					: request.body.messages;
			const reply = await respond({
				messages,
				session,
				decide: deps.chatDecider,
				logger: request.log,
			});
			return { reply };
		},
	);
};

/**
 * Resolve the caller's session without ever failing the request: no (or an
 * unverifiable) token is `anonymous`; a validly signed token whose session fails
 * the DB revalidation — revoked membership, canceled or deleted account — is
 * `stale`; otherwise the session is `active` and carries the account-bound
 * actions. `jwtVerify` reads the bearer header first and falls back to the
 * session cookie, exactly as `authenticate` does.
 */
async function resolveChatSession(
	app: FastifyInstance,
	request: FastifyRequest,
): Promise<ChatSession> {
	try {
		await request.jwtVerify();
	} catch {
		return { kind: 'anonymous' };
	}
	const claims = request.user;
	try {
		await app.revalidateSession(request);
	} catch {
		return { kind: 'stale', claims };
	}
	return { kind: 'active', claims, actions: createChatActions(app.deps, claims.accountId) };
}
