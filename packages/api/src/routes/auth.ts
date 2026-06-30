import {
	type AccountId,
	acceptInviteSchema,
	isRivusStaffEmail,
	loginSchema,
	signupSchema,
	type UserId,
	updateProfileSchema,
	verifyCodeSchema,
	verifyEmailChangeSchema,
} from '@rivus/core';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
	authResponseSchema,
	codeSentResponseSchema,
	errorResponseSchema,
	sessionResponseSchema,
	signedOutResponseSchema,
	userResponseSchema,
} from '../http-schemas';
import { SESSION_COOKIE, sessionCookieOptions } from '../plugins/auth';
import { toPublicAccount, toPublicUser } from '../presenters';
import { ConflictError } from '../repositories/errors';
import type {
	PendingEmailChange,
	PendingSignup,
	SignupResult,
	UpdateUser,
	VerificationPurpose,
} from '../repositories/types';
import { generateUniqueSlug } from '../services/accounts';
import { hashSecret, verifySecret } from '../services/hash';
import { issueSession } from '../services/session';
import {
	codeExpiry,
	generateVerificationCode,
	MAX_VERIFICATION_ATTEMPTS,
} from '../services/verification';

/** How many times to regenerate a slug when concurrent signups collide. */
const SLUG_RETRY_LIMIT = 5;

export const authRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { users, accounts, memberships, invites, onboarding, verificationCodes, mailer, notifier } =
		app.deps;

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
		payload: { signup?: PendingSignup; emailChange?: PendingEmailChange } = {},
	): Promise<void> {
		const code = generateVerificationCode();
		const codeHash = await hashSecret(code);
		await verificationCodes.upsert({
			email,
			purpose,
			codeHash,
			expiresAt: codeExpiry(),
			signup: payload.signup,
			emailChange: payload.emailChange,
		});
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
			await issueCode(request, email, 'signup', { signup: { name, business } });
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
				const token = await issueSession(app, reply, {
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
			// A canceled (soft-deleted) account is a hard lockout: don't mint a session
			// or leak its data, mirroring the accept-invite guard above.
			if (account.status === 'canceled') {
				throw app.httpErrors.unauthorized('Invalid or expired code');
			}
			const token = await issueSession(app, reply, {
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

	app.patch(
		'/me',
		{
			onRequest: [fastify.authenticate],
			schema: {
				tags: ['auth'],
				summary: 'Update your profile (name, phone, email). Changing email re-verifies it',
				security: [{ bearerAuth: [] }],
				body: updateProfileSchema,
				response: {
					200: userResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
					403: errorResponseSchema,
					409: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const userId = request.user.sub as UserId;
			const current = await users.findById(userId);
			if (!current) {
				throw app.httpErrors.unauthorized('Account no longer exists');
			}

			const { name, email, phone } = request.body;
			const patch: UpdateUser = {};
			if (name !== undefined) {
				patch.name = name;
			}
			if (phone !== undefined) {
				patch.phone = phone;
			}

			// A new email isn't applied here — it's staged on `pendingEmail` and becomes
			// the live address only once the code we email confirms it (see
			// `POST /me/email/verify`). Comparing against the live email (both normalized)
			// means re-submitting the same pending address just resends the code, and
			// submitting your current email is a no-op.
			let pendingChange: string | null = null;
			if (email !== undefined && email !== current.email) {
				// Staff status is derived solely from the email domain (`isRivusStaffEmail`),
				// so a self-service email change must never cross the staff boundary: moving
				// *to* the staff domain would self-elevate a regular user, and moving a staff
				// member *off* it would leave their other still-valid sessions carrying a
				// stale staff email claim until those tokens expire. Either direction is
				// refused here — staff email changes go through an administrator instead.
				if (isRivusStaffEmail(email) || isRivusStaffEmail(current.email)) {
					throw app.httpErrors.forbidden(
						'Rivus staff email addresses must be changed by an administrator.',
					);
				}
				const existing = await users.findByEmail(email);
				if (existing && existing.id !== userId) {
					throw app.httpErrors.conflict('A user with this email already exists');
				}
				patch.pendingEmail = email;
				pendingChange = email;
			}

			const updated = Object.keys(patch).length > 0 ? await users.update(userId, patch) : current;
			if (!updated) {
				throw app.httpErrors.unauthorized('Account no longer exists');
			}

			// Deliver the confirmation code only after the pending address is persisted,
			// so a live code never points at a change we failed to save.
			if (pendingChange) {
				await issueCode(request, pendingChange, 'email_change', {
					emailChange: { userId },
				});
			}
			return toPublicUser(updated);
		},
	);

	app.post(
		'/me/email/verify',
		{
			onRequest: [fastify.authenticate],
			schema: {
				tags: ['auth'],
				summary: 'Confirm a pending email change with its one-time code',
				security: [{ bearerAuth: [] }],
				body: verifyEmailChangeSchema,
				response: {
					200: authResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
					409: errorResponseSchema,
					429: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = request.user.sub as UserId;
			const user = await users.findById(userId);
			if (!user) {
				throw app.httpErrors.unauthorized('Account no longer exists');
			}
			if (!user.pendingEmail) {
				throw app.httpErrors.badRequest('No email change is pending');
			}

			const { code } = request.body;
			const newEmail = user.pendingEmail;
			const record = await verificationCodes.findByEmail(newEmail);
			// The code must exist, be an email-change code minted for *this* user, and be
			// unexpired — otherwise it's treated exactly like a bad code.
			if (
				record?.purpose !== 'email_change' ||
				record.emailChange?.userId !== userId ||
				new Date(record.expiresAt).getTime() < Date.now()
			) {
				throw app.httpErrors.unauthorized('Invalid or expired code');
			}
			// Same attempt budget as `/verify`: a spent code is locked until it expires,
			// and the attempt is reserved with an atomic increment *before* the slow
			// scrypt compare so concurrent requests can't brute-force the 6-digit code.
			if (record.attempts >= MAX_VERIFICATION_ATTEMPTS) {
				throw app.httpErrors.tooManyRequests('Too many incorrect attempts — request a new code');
			}
			if ((await verificationCodes.incrementAttempts(newEmail)) > MAX_VERIFICATION_ATTEMPTS) {
				throw app.httpErrors.tooManyRequests('Too many incorrect attempts — request a new code');
			}
			if (!(await verifySecret(code, record.codeHash))) {
				throw app.httpErrors.unauthorized('Invalid or expired code');
			}
			// Claim the code atomically so it can't be redeemed twice.
			if (!(await verificationCodes.delete(newEmail))) {
				throw app.httpErrors.unauthorized('Invalid or expired code');
			}

			// Apply the change. Uniqueness is re-checked here because the address could
			// have been claimed in the window since the change was requested.
			let updated: Awaited<ReturnType<typeof users.update>>;
			try {
				updated = await users.update(userId, { email: newEmail, pendingEmail: '' });
			} catch (error) {
				if (error instanceof ConflictError) {
					throw app.httpErrors.conflict('A user with this email already exists');
				}
				throw error;
			}
			if (!updated) {
				throw app.httpErrors.unauthorized('Account no longer exists');
			}

			// Re-issue the session so the JWT (and the web cookie) carry the new email —
			// the previous token still embeds the old address. Mirrors the login path.
			const membership = await memberships.findByUserId(userId);
			const account = membership ? await accounts.findById(membership.accountId) : null;
			if (!membership || !account) {
				throw app.httpErrors.unauthorized('Account no longer exists');
			}
			const token = await issueSession(app, reply, {
				sub: updated.id,
				email: updated.email,
				accountId: account.id,
				role: membership.role,
			});
			return reply.send({
				token,
				user: toPublicUser(updated),
				account: toPublicAccount(account),
				role: membership.role,
			});
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
			// A canceled (soft-deleted) account can't take on new members, even via an
			// invite issued before it was canceled.
			if (!account || account.status === 'canceled') {
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
			// Let the member who sent the invite know it was accepted — best-effort.
			await notifier.inviteAccepted({
				accountId: account.id,
				inviterId: invite.invitedBy,
				memberName: user.name,
				accountName: account.name,
				logger: request.log,
			});
			const token = await issueSession(app, reply, {
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

	app.post(
		'/logout',
		{
			schema: {
				tags: ['auth'],
				summary: 'Sign out — clears the session cookie',
				response: { 200: signedOutResponseSchema },
			},
		},
		async (_request, reply) => {
			// Clearing must use the same attributes the cookie was set with so the
			// browser matches and expires it. No auth guard: signing out should work
			// even with an already-expired or missing token.
			reply.clearCookie(SESSION_COOKIE, sessionCookieOptions(app.deps.config));
			return reply.send({ status: 'signed_out' });
		},
	);
};
