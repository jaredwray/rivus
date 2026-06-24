import {
	type AccountId,
	acceptInviteSchema,
	loginSchema,
	signupSchema,
	type UserId,
	verifyCodeSchema,
} from '@rivus/core';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
	authResponseSchema,
	codeSentResponseSchema,
	errorResponseSchema,
	sessionResponseSchema,
} from '../http-schemas';
import { toPublicAccount, toPublicUser } from '../presenters';
import { ConflictError } from '../repositories/errors';
import type { PendingSignup, SignupResult, VerificationPurpose } from '../repositories/types';
import { generateUniqueSlug } from '../services/accounts';
import { hashSecret, verifySecret } from '../services/hash';
import {
	codeExpiry,
	generateVerificationCode,
	MAX_VERIFICATION_ATTEMPTS,
} from '../services/verification';

/** How many times to regenerate a slug when concurrent signups collide. */
const SLUG_RETRY_LIMIT = 5;

export const authRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { users, accounts, memberships, invites, onboarding, verificationCodes, mailer } = app.deps;

	/**
	 * Deliver a code without blocking the response on it. Decoupling delivery keeps
	 * response latency uniform (so `/login` doesn't leak whether an email exists via
	 * Resend round-trip time) and means a transient mail failure is logged, not 500.
	 */
	function deliverCode(
		request: FastifyRequest,
		to: string,
		code: string,
		purpose: VerificationPurpose,
	): void {
		void mailer
			.sendVerificationCode({ to, code, purpose })
			.catch((err) => request.log.error({ err }, 'failed to send verification code'));
	}

	/** Generate, store, and email a fresh one-time code for an email. */
	async function issueCode(
		request: FastifyRequest,
		email: string,
		purpose: VerificationPurpose,
		signup?: PendingSignup,
	): Promise<void> {
		const code = generateVerificationCode();
		const codeHash = await hashSecret(code);
		await verificationCodes.upsert({ email, purpose, codeHash, expiresAt: codeExpiry(), signup });
		deliverCode(request, email, code, purpose);
	}

	/** Create the account a verified signup code describes (with slug-collision retry). */
	async function createAccount(email: string, signup: PendingSignup): Promise<SignupResult> {
		let result: SignupResult | undefined;
		for (let attempt = 0; attempt < SLUG_RETRY_LIMIT; attempt++) {
			const slug = await generateUniqueSlug(accounts, signup.business.businessName);
			try {
				result = await onboarding.signup({
					user: { email, name: signup.name },
					account: {
						name: signup.business.businessName,
						slug,
						phone: signup.business.phone,
						address: signup.business.address,
						website: signup.business.website,
						timezone: signup.business.timezone,
					},
				});
				break;
			} catch (error) {
				// Two same-named signups can race to the same slug; regenerate and retry.
				// Any other conflict (e.g. duplicate email) propagates as 409.
				if (
					error instanceof ConflictError &&
					error.field === 'slug' &&
					attempt < SLUG_RETRY_LIMIT - 1
				) {
					continue;
				}
				throw error;
			}
		}
		return result as SignupResult;
	}

	app.post(
		'/signup',
		{
			schema: {
				tags: ['auth'],
				summary: 'Begin signup — emails a one-time code to confirm the address',
				body: signupSchema,
				response: {
					202: codeSentResponseSchema,
					400: errorResponseSchema,
					409: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const { email, name, business } = request.body;
			// Reject a duplicate before emailing anything, so we never start a signup
			// for an address that already has an account.
			if (await users.findByEmail(email)) {
				throw app.httpErrors.conflict('A user with this email already exists');
			}
			await issueCode(request, email, 'signup', { name, business });
			return reply.code(202).send({ status: 'code_sent', email });
		},
	);

	app.post(
		'/login',
		{
			schema: {
				tags: ['auth'],
				summary: 'Request a one-time sign-in code',
				body: loginSchema,
				response: { 202: codeSentResponseSchema, 400: errorResponseSchema },
			},
		},
		async (request, reply) => {
			const { email } = request.body;
			// Only send a code to a registered address, but always respond the same way
			// so the endpoint never reveals whether an email has an account.
			if (await users.findByEmail(email)) {
				await issueCode(request, email, 'login');
			} else {
				// Spend the same dominant scrypt cost for unknown emails, so response
				// latency doesn't betray whether the address is registered.
				await hashSecret(generateVerificationCode());
			}
			return reply.code(202).send({ status: 'code_sent', email });
		},
	);

	app.post(
		'/verify',
		{
			schema: {
				tags: ['auth'],
				summary: 'Verify a one-time code and receive a session',
				body: verifyCodeSchema,
				response: {
					200: authResponseSchema,
					201: authResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
					429: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const { email, code } = request.body;
			const record = await verificationCodes.findByEmail(email);
			if (!record || new Date(record.expiresAt).getTime() < Date.now()) {
				throw app.httpErrors.unauthorized('Invalid or expired code');
			}
			// Fast path: a code whose budget is already spent is locked until it expires.
			if (record.attempts >= MAX_VERIFICATION_ATTEMPTS) {
				throw app.httpErrors.tooManyRequests('Too many incorrect attempts — request a new code');
			}
			// Reserve this attempt with an atomic increment *before* the slow scrypt
			// compare. Otherwise many concurrent requests would all read the same
			// `attempts` snapshot, pass the check above, and brute-force the 6-digit
			// code while their compares run in parallel.
			if ((await verificationCodes.incrementAttempts(email)) > MAX_VERIFICATION_ATTEMPTS) {
				throw app.httpErrors.tooManyRequests('Too many incorrect attempts — request a new code');
			}
			if (!(await verifySecret(code, record.codeHash))) {
				throw app.httpErrors.unauthorized('Invalid or expired code');
			}
			// Atomically claim the code: only the request that actually removes it
			// proceeds, so a single-use code can't be redeemed twice by concurrent
			// requests (which would mint two sessions / race account creation).
			if (!(await verificationCodes.delete(email))) {
				throw app.httpErrors.unauthorized('Invalid or expired code');
			}

			if (record.purpose === 'signup') {
				if (!record.signup) {
					throw app.httpErrors.unauthorized('Invalid or expired code');
				}
				const { user, account, membership } = await createAccount(email, record.signup);
				const token = await reply.jwtSign({
					sub: user.id,
					email: user.email,
					accountId: account.id,
					role: membership.role,
				});
				return reply.code(201).send({
					token,
					user: toPublicUser(user),
					account: toPublicAccount(account),
					role: membership.role,
				});
			}

			// Login: resolve the user's account and role.
			const user = await users.findByEmail(email);
			const membership = user ? await memberships.findByUserId(user.id) : null;
			const account = membership ? await accounts.findById(membership.accountId) : null;
			if (!user || !membership || !account) {
				throw app.httpErrors.unauthorized('Invalid or expired code');
			}
			const token = await reply.jwtSign({
				sub: user.id,
				email: user.email,
				accountId: account.id,
				role: membership.role,
			});
			return reply.send({
				token,
				user: toPublicUser(user),
				account: toPublicAccount(account),
				role: membership.role,
			});
		},
	);

	app.get(
		'/me',
		{
			onRequest: [fastify.authenticate],
			schema: {
				tags: ['auth'],
				summary: 'Return the current user, account, and role',
				security: [{ bearerAuth: [] }],
				response: { 200: sessionResponseSchema, 401: errorResponseSchema },
			},
		},
		async (request) => {
			const user = await users.findById(request.user.sub as UserId);
			const account = await accounts.findById(request.user.accountId as AccountId);
			if (!user || !account) {
				throw app.httpErrors.unauthorized('Account no longer exists');
			}
			return {
				user: toPublicUser(user),
				account: toPublicAccount(account),
				role: request.user.role,
			};
		},
	);

	app.post(
		'/accept-invite',
		{
			schema: {
				tags: ['auth'],
				summary: 'Accept an invitation and join an account',
				body: acceptInviteSchema,
				response: {
					201: authResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
					409: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const { token: inviteToken } = request.body;
			const invite = await invites.findByToken(inviteToken);
			if (!invite) {
				throw app.httpErrors.unauthorized('Invalid or expired invitation');
			}
			const account = await accounts.findById(invite.accountId);
			if (!account) {
				throw app.httpErrors.unauthorized('Invalid or expired invitation');
			}
			// Creates the user + membership and marks the invite accepted atomically
			// (a Mongo transaction in production). `onboarding.acceptInvite` enforces
			// the invite is still pending (mapping a stale/revoked invite to 401), and
			// throws ConflictError (409) if the email was claimed since the invite.
			const { user, membership } = await onboarding.acceptInvite({
				user: { email: invite.email, name: invite.name },
				accountId: account.id,
				role: invite.role,
				inviteId: invite.id,
			});
			const token = await reply.jwtSign({
				sub: user.id,
				email: user.email,
				accountId: account.id,
				role: membership.role,
			});
			return reply.code(201).send({
				token,
				user: toPublicUser(user),
				account: toPublicAccount(account),
				role: membership.role,
			});
		},
	);
};
