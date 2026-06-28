import {
	type Account,
	type AccountId,
	type CreateCustomerInput,
	type CreateFaqInput,
	type CreateItemInput,
	type CreateJobInput,
	type Customer,
	type CustomerId,
	type Faq,
	type FaqId,
	type Invite,
	type InviteId,
	type Item,
	type ItemId,
	type Job,
	type JobId,
	type Membership,
	type MembershipId,
	normalizePagination,
	pageToSkip,
	type Role,
	type UpdateCustomerInput,
	type UpdateFaqInput,
	type UpdateItemInput,
	type UpdateJobInput,
	type UserId,
} from '@rivus/core';
import mongoose, { type ClientSession, type HydratedDocument, Types } from 'mongoose';
import { type AccountDocument, AccountModel } from '../db/models/account.model';
import { type CustomerDocument, CustomerModel } from '../db/models/customer.model';
import { type FaqDocument, FaqModel } from '../db/models/faq.model';
import { type InviteDocument, InviteModel } from '../db/models/invite.model';
import { type ItemDocument, ItemModel } from '../db/models/item.model';
import { type JobDocument, JobModel } from '../db/models/job.model';
import { type MembershipDocument, MembershipModel } from '../db/models/membership.model';
import { type UserDocument, UserModel } from '../db/models/user.model';
import {
	type VerificationCodeDocument,
	VerificationCodeModel,
} from '../db/models/verification-code.model';
import { ConflictError, InviteNotPendingError, LastOwnerError } from './errors';
import type {
	AcceptInviteInput,
	AcceptInviteResult,
	AccountRepository,
	CustomerRepository,
	FaqRepository,
	FindOverlappingJobsOptions,
	InviteRepository,
	ItemRepository,
	JobRepository,
	ListAccountsOptions,
	ListCustomersOptions,
	ListFaqsOptions,
	ListItemsOptions,
	ListJobsOptions,
	MembershipRepository,
	NewAccount,
	NewInvite,
	NewMembership,
	NewUser,
	NewVerificationCode,
	OnboardingRepository,
	SignupInput,
	SignupResult,
	StoredUser,
	StoredVerificationCode,
	UpdateAccount,
	UserRepository,
	VerificationCodeRepository,
} from './types';

/** MongoServerError code 11000 = duplicate key (unique index violation). */
function isDuplicateKeyError(
	error: unknown,
): error is { code: 11000; keyPattern?: Record<string, 1> } {
	return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

function mapUser(doc: HydratedDocument<UserDocument>): StoredUser {
	return {
		id: doc._id.toString() as UserId,
		email: doc.email,
		name: doc.name,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

function mapVerificationCode(
	doc: HydratedDocument<VerificationCodeDocument>,
): StoredVerificationCode {
	return {
		id: doc._id.toString(),
		email: doc.email,
		purpose: doc.purpose,
		codeHash: doc.codeHash,
		expiresAt: doc.expiresAt.toISOString(),
		attempts: doc.attempts,
		signup: doc.signup,
		createdAt: doc.createdAt.toISOString(),
	};
}

function mapAccount(doc: HydratedDocument<AccountDocument>): Account {
	return {
		id: doc._id.toString() as AccountId,
		name: doc.name,
		slug: doc.slug,
		phone: doc.phone,
		address: doc.address,
		website: doc.website,
		timezone: doc.timezone,
		status: doc.status,
		canceledAt: doc.canceledAt ? doc.canceledAt.toISOString() : null,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

function mapMembership(doc: HydratedDocument<MembershipDocument>): Membership {
	return {
		id: doc._id.toString() as MembershipId,
		accountId: doc.accountId.toString() as AccountId,
		userId: doc.userId.toString() as UserId,
		role: doc.role,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

function mapInvite(doc: HydratedDocument<InviteDocument>): Invite {
	return {
		id: doc._id.toString() as InviteId,
		accountId: doc.accountId.toString() as AccountId,
		email: doc.email,
		name: doc.name,
		role: doc.role,
		status: doc.status,
		token: doc.token,
		invitedBy: doc.invitedBy.toString() as UserId,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

function mapItem(doc: HydratedDocument<ItemDocument>): Item {
	return {
		id: doc._id.toString() as ItemId,
		accountId: doc.accountId.toString() as AccountId,
		name: doc.name,
		description: doc.description,
		status: doc.status,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

function mapCustomer(doc: HydratedDocument<CustomerDocument>): Customer {
	return {
		id: doc._id.toString() as CustomerId,
		accountId: doc.accountId.toString() as AccountId,
		name: doc.name,
		email: doc.email,
		phone: doc.phone,
		// Fall back to the legacy `area` field for customers created before it was
		// renamed to `address`, so their saved location isn't dropped from responses.
		address: doc.address || doc.area || '',
		lifetimeValue: doc.lifetimeValue,
		balance: doc.balance,
		notes: doc.notes,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

function mapFaq(doc: HydratedDocument<FaqDocument>): Faq {
	return {
		id: doc._id.toString() as FaqId,
		accountId: doc.accountId.toString() as AccountId,
		question: doc.question,
		answer: doc.answer,
		category: doc.category,
		status: doc.status,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

function mapJob(doc: HydratedDocument<JobDocument>): Job {
	return {
		id: doc._id.toString() as JobId,
		accountId: doc.accountId.toString() as AccountId,
		customerId: doc.customerId,
		assignedUserId: doc.assignedUserId,
		title: doc.title,
		status: doc.status,
		startAt: doc.startAt.toISOString(),
		durationMinutes: doc.durationMinutes,
		address: doc.address,
		notes: doc.notes,
		estimatedValue: doc.estimatedValue,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

export class MongoUserRepository implements UserRepository {
	async create(input: NewUser): Promise<StoredUser> {
		try {
			const doc = await UserModel.create(input);
			return mapUser(doc);
		} catch (error) {
			if (isDuplicateKeyError(error)) {
				throw new ConflictError('email', 'An account with this email already exists');
			}
			throw error;
		}
	}

	async findByEmail(email: string): Promise<StoredUser | null> {
		const doc = await UserModel.findOne({ email: email.trim().toLowerCase() }).exec();
		return doc ? mapUser(doc) : null;
	}

	async findById(id: UserId): Promise<StoredUser | null> {
		if (!Types.ObjectId.isValid(id)) {
			return null;
		}
		const doc = await UserModel.findById(id).exec();
		return doc ? mapUser(doc) : null;
	}

	async findByIds(ids: UserId[]): Promise<StoredUser[]> {
		const objectIds = ids
			.filter((id) => Types.ObjectId.isValid(id))
			.map((id) => new Types.ObjectId(id));
		if (objectIds.length === 0) {
			return [];
		}
		const docs = await UserModel.find({ _id: { $in: objectIds } }).exec();
		return docs.map(mapUser);
	}
}

export class MongoAccountRepository implements AccountRepository {
	async create(input: NewAccount): Promise<Account> {
		try {
			const doc = await AccountModel.create(input);
			return mapAccount(doc);
		} catch (error) {
			if (isDuplicateKeyError(error)) {
				throw new ConflictError('slug', 'An account with this slug already exists');
			}
			throw error;
		}
	}

	async findById(id: AccountId): Promise<Account | null> {
		if (!Types.ObjectId.isValid(id)) {
			return null;
		}
		const doc = await AccountModel.findById(id).exec();
		return doc ? mapAccount(doc) : null;
	}

	async findBySlug(slug: string): Promise<Account | null> {
		const doc = await AccountModel.findOne({ slug: slug.trim().toLowerCase() }).exec();
		return doc ? mapAccount(doc) : null;
	}

	async list(options: ListAccountsOptions): Promise<{ accounts: Account[]; total: number }> {
		const { pageSize } = normalizePagination(options.page, options.pageSize);
		const skip = pageToSkip(options.page, options.pageSize);
		const needle = options.search?.trim();
		// Escape regex metacharacters so a search like "a.b" is matched literally, then
		// match it case-insensitively against either the name or the slug. Only active
		// accounts are listed — a canceled one can't be entered.
		const filter = needle
			? {
					status: 'active' as const,
					$or: [
						{ name: new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
						{ slug: new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
					],
				}
			: { status: 'active' as const };
		const [docs, total] = await Promise.all([
			AccountModel.find(filter).sort({ name: 1, _id: 1 }).skip(skip).limit(pageSize).exec(),
			AccountModel.countDocuments(filter).exec(),
		]);
		return { accounts: docs.map(mapAccount), total };
	}

	async update(id: AccountId, input: UpdateAccount): Promise<Account | null> {
		if (!Types.ObjectId.isValid(id)) {
			return null;
		}
		// `$set` with only the provided keys, so a partial update never blanks a field.
		const set: UpdateAccount = {};
		for (const key of ['name', 'phone', 'address', 'website', 'timezone'] as const) {
			const value = input[key];
			if (value !== undefined) {
				set[key] = value;
			}
		}
		const doc = await AccountModel.findByIdAndUpdate(id, { $set: set }, { new: true }).exec();
		return doc ? mapAccount(doc) : null;
	}

	async cancel(id: AccountId): Promise<Account | null> {
		if (!Types.ObjectId.isValid(id)) {
			return null;
		}
		const doc = await AccountModel.findByIdAndUpdate(
			id,
			{ $set: { status: 'canceled', canceledAt: new Date() } },
			{ new: true },
		).exec();
		return doc ? mapAccount(doc) : null;
	}
}

/**
 * Run an owner-mutating membership write inside a transaction that first bumps
 * the account's `membershipsVersion`. That shared write is the serialization
 * point: two concurrent demote/remove requests on the same account collide on
 * it, so one is retried by `withTransaction` and re-evaluates the owner count
 * against the other's committed result — closing the check-then-write race.
 */
async function withOwnerGuard<T>(
	accountOid: Types.ObjectId,
	fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
	const session = await mongoose.startSession();
	try {
		let result: T | undefined;
		await session.withTransaction(async () => {
			await AccountModel.updateOne(
				{ _id: accountOid },
				{ $inc: { membershipsVersion: 1 } },
				{ session },
			).exec();
			result = await fn(session);
		});
		return result as T;
	} finally {
		await session.endSession();
	}
}

/** Throw {@link LastOwnerError} unless the account still has another owner. */
async function assertAnotherOwnerRemains(
	accountOid: Types.ObjectId,
	session: ClientSession,
): Promise<void> {
	const owners = await MembershipModel.countDocuments({ accountId: accountOid, role: 'owner' })
		.session(session)
		.exec();
	if (owners <= 1) {
		throw new LastOwnerError();
	}
}

export class MongoMembershipRepository implements MembershipRepository {
	async create(input: NewMembership): Promise<Membership> {
		try {
			const doc = await MembershipModel.create({
				accountId: new Types.ObjectId(input.accountId),
				userId: new Types.ObjectId(input.userId),
				role: input.role,
			});
			return mapMembership(doc);
		} catch (error) {
			if (isDuplicateKeyError(error)) {
				throw new ConflictError('userId', 'User already belongs to an account');
			}
			throw error;
		}
	}

	async findByUserId(userId: UserId): Promise<Membership | null> {
		if (!Types.ObjectId.isValid(userId)) {
			return null;
		}
		const doc = await MembershipModel.findOne({ userId: new Types.ObjectId(userId) }).exec();
		return doc ? mapMembership(doc) : null;
	}

	async findByAccountAndUser(accountId: AccountId, userId: UserId): Promise<Membership | null> {
		if (!Types.ObjectId.isValid(accountId) || !Types.ObjectId.isValid(userId)) {
			return null;
		}
		const doc = await MembershipModel.findOne({
			accountId: new Types.ObjectId(accountId),
			userId: new Types.ObjectId(userId),
		}).exec();
		return doc ? mapMembership(doc) : null;
	}

	async listByAccount(accountId: AccountId): Promise<Membership[]> {
		if (!Types.ObjectId.isValid(accountId)) {
			return [];
		}
		const docs = await MembershipModel.find({ accountId: new Types.ObjectId(accountId) })
			.sort({ createdAt: 1 })
			.exec();
		return docs.map(mapMembership);
	}

	async updateRole(accountId: AccountId, userId: UserId, role: Role): Promise<Membership | null> {
		if (!Types.ObjectId.isValid(accountId) || !Types.ObjectId.isValid(userId)) {
			return null;
		}
		const accountOid = new Types.ObjectId(accountId);
		const userOid = new Types.ObjectId(userId);
		return withOwnerGuard(accountOid, async (session) => {
			const target = await MembershipModel.findOne({ accountId: accountOid, userId: userOid })
				.session(session)
				.exec();
			if (!target) {
				return null;
			}
			// Demoting an owner must leave at least one behind. The owner count is read
			// after the guard's account write, so a concurrent demote/remove forces a
			// write conflict and retries against the fresh count.
			if (target.role === 'owner' && role !== 'owner') {
				await assertAnotherOwnerRemains(accountOid, session);
			}
			const doc = await MembershipModel.findOneAndUpdate(
				{ accountId: accountOid, userId: userOid },
				{ $set: { role } },
				{ new: true, session },
			).exec();
			return doc ? mapMembership(doc) : null;
		});
	}

	async delete(accountId: AccountId, userId: UserId): Promise<boolean> {
		if (!Types.ObjectId.isValid(accountId) || !Types.ObjectId.isValid(userId)) {
			return false;
		}
		const accountOid = new Types.ObjectId(accountId);
		const userOid = new Types.ObjectId(userId);
		return withOwnerGuard(accountOid, async (session) => {
			const target = await MembershipModel.findOne({ accountId: accountOid, userId: userOid })
				.session(session)
				.exec();
			if (!target) {
				return false;
			}
			if (target.role === 'owner') {
				await assertAnotherOwnerRemains(accountOid, session);
			}
			const result = await MembershipModel.deleteOne({
				accountId: accountOid,
				userId: userOid,
			})
				.session(session)
				.exec();
			return result.deletedCount === 1;
		});
	}
}

export class MongoInviteRepository implements InviteRepository {
	async create(input: NewInvite): Promise<Invite> {
		const doc = await InviteModel.create({
			accountId: new Types.ObjectId(input.accountId),
			email: input.email.trim().toLowerCase(),
			name: input.name,
			role: input.role,
			token: input.token,
			invitedBy: new Types.ObjectId(input.invitedBy),
		});
		return mapInvite(doc);
	}

	async findById(id: InviteId): Promise<Invite | null> {
		if (!Types.ObjectId.isValid(id)) {
			return null;
		}
		const doc = await InviteModel.findById(id).exec();
		return doc ? mapInvite(doc) : null;
	}

	async findByToken(token: string): Promise<Invite | null> {
		const doc = await InviteModel.findOne({ token }).exec();
		return doc ? mapInvite(doc) : null;
	}

	async listPendingByAccount(accountId: AccountId): Promise<Invite[]> {
		if (!Types.ObjectId.isValid(accountId)) {
			return [];
		}
		const docs = await InviteModel.find({
			accountId: new Types.ObjectId(accountId),
			status: 'pending',
		})
			.sort({ createdAt: 1 })
			.exec();
		return docs.map(mapInvite);
	}

	async markAccepted(id: InviteId): Promise<Invite | null> {
		if (!Types.ObjectId.isValid(id)) {
			return null;
		}
		const doc = await InviteModel.findByIdAndUpdate(
			id,
			{ $set: { status: 'accepted' } },
			{ new: true },
		).exec();
		return doc ? mapInvite(doc) : null;
	}

	async revoke(accountId: AccountId, id: InviteId): Promise<boolean> {
		if (!Types.ObjectId.isValid(accountId) || !Types.ObjectId.isValid(id)) {
			return false;
		}
		const result = await InviteModel.updateOne(
			{ _id: id, accountId: new Types.ObjectId(accountId), status: 'pending' },
			{ $set: { status: 'revoked' } },
		).exec();
		return result.modifiedCount === 1;
	}
}

export class MongoVerificationCodeRepository implements VerificationCodeRepository {
	async upsert(input: NewVerificationCode): Promise<StoredVerificationCode> {
		const email = input.email.trim().toLowerCase();
		// A single atomic upsert (not delete-then-create) so two overlapping code
		// requests for the same email can't both delete then collide on the unique
		// index. Resets the attempt counter; clears any stale signup payload.
		const set = {
			purpose: input.purpose,
			codeHash: input.codeHash,
			expiresAt: new Date(input.expiresAt),
			attempts: 0,
		};
		const update = input.signup
			? { $set: { ...set, signup: input.signup } }
			: { $set: set, $unset: { signup: '' } };
		const doc = await VerificationCodeModel.findOneAndUpdate({ email }, update, {
			upsert: true,
			new: true,
			setDefaultsOnInsert: true,
		}).exec();
		return mapVerificationCode(doc as HydratedDocument<VerificationCodeDocument>);
	}

	async findByEmail(email: string): Promise<StoredVerificationCode | null> {
		const doc = await VerificationCodeModel.findOne({
			email: email.trim().toLowerCase(),
		}).exec();
		return doc ? mapVerificationCode(doc) : null;
	}

	async incrementAttempts(email: string): Promise<number> {
		const doc = await VerificationCodeModel.findOneAndUpdate(
			{ email: email.trim().toLowerCase() },
			{ $inc: { attempts: 1 } },
			{ new: true },
		).exec();
		return doc?.attempts ?? 0;
	}

	async delete(email: string): Promise<boolean> {
		const result = await VerificationCodeModel.deleteOne({
			email: email.trim().toLowerCase(),
		}).exec();
		return result.deletedCount === 1;
	}
}

/** Creates user + account + owner membership in a single Mongo transaction. */
export class MongoOnboardingRepository implements OnboardingRepository {
	async signup(input: SignupInput): Promise<SignupResult> {
		const session = await mongoose.startSession();
		try {
			let result: SignupResult | undefined;
			await session.withTransaction(async () => {
				const [user] = await UserModel.create([input.user], { session });
				const [account] = await AccountModel.create([input.account], { session });
				if (!user || !account) {
					throw new Error('Signup transaction failed to create the user or account');
				}
				const [membership] = await MembershipModel.create(
					[{ accountId: account._id, userId: user._id, role: 'owner' }],
					{ session },
				);
				if (!membership) {
					throw new Error('Signup transaction failed to create the membership');
				}
				result = {
					user: mapUser(user),
					account: mapAccount(account),
					membership: mapMembership(membership),
				};
			});
			// withTransaction only resolves after the callback succeeds, so result is set.
			return result as SignupResult;
		} catch (error) {
			if (isDuplicateKeyError(error)) {
				const field = error.keyPattern?.slug ? 'slug' : 'email';
				const message =
					field === 'slug'
						? 'An account with this slug already exists'
						: 'An account with this email already exists';
				throw new ConflictError(field, message);
			}
			throw error;
		} finally {
			await session.endSession();
		}
	}

	async acceptInvite(input: AcceptInviteInput): Promise<AcceptInviteResult> {
		const session = await mongoose.startSession();
		try {
			let result: AcceptInviteResult | undefined;
			await session.withTransaction(async () => {
				// Consume the invite first, only if it is still pending; otherwise abort
				// so a concurrently revoked/accepted invite can't grant membership.
				const consumed = await InviteModel.updateOne(
					{ _id: input.inviteId, status: 'pending' },
					{ $set: { status: 'accepted' } },
					{ session },
				);
				if (consumed.modifiedCount !== 1) {
					throw new InviteNotPendingError();
				}
				const [user] = await UserModel.create([input.user], { session });
				if (!user) {
					throw new Error('Accept-invite transaction failed to create the user');
				}
				const [membership] = await MembershipModel.create(
					[{ accountId: new Types.ObjectId(input.accountId), userId: user._id, role: input.role }],
					{ session },
				);
				if (!membership) {
					throw new Error('Accept-invite transaction failed to create the membership');
				}
				result = { user: mapUser(user), membership: mapMembership(membership) };
			});
			return result as AcceptInviteResult;
		} catch (error) {
			if (isDuplicateKeyError(error)) {
				throw new ConflictError('email', 'An account with this email already exists');
			}
			throw error;
		} finally {
			await session.endSession();
		}
	}
}

export class MongoItemRepository implements ItemRepository {
	async create(accountId: AccountId, input: CreateItemInput): Promise<Item> {
		const doc = await ItemModel.create({ accountId: new Types.ObjectId(accountId), ...input });
		return mapItem(doc);
	}

	async list(options: ListItemsOptions): Promise<{ items: Item[]; total: number }> {
		if (!Types.ObjectId.isValid(options.accountId)) {
			return { items: [], total: 0 };
		}
		const { pageSize } = normalizePagination(options.page, options.pageSize);
		const skip = pageToSkip(options.page, options.pageSize);
		const filter = { accountId: new Types.ObjectId(options.accountId) };
		const [docs, total] = await Promise.all([
			ItemModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(pageSize).exec(),
			ItemModel.countDocuments(filter).exec(),
		]);
		return { items: docs.map(mapItem), total };
	}

	async findById(accountId: AccountId, id: ItemId): Promise<Item | null> {
		if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(accountId)) {
			return null;
		}
		const doc = await ItemModel.findOne({
			_id: id,
			accountId: new Types.ObjectId(accountId),
		}).exec();
		return doc ? mapItem(doc) : null;
	}

	async update(accountId: AccountId, id: ItemId, input: UpdateItemInput): Promise<Item | null> {
		if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(accountId)) {
			return null;
		}
		const doc = await ItemModel.findOneAndUpdate(
			{ _id: id, accountId: new Types.ObjectId(accountId) },
			{ $set: input },
			{ new: true },
		).exec();
		return doc ? mapItem(doc) : null;
	}

	async delete(accountId: AccountId, id: ItemId): Promise<boolean> {
		if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(accountId)) {
			return false;
		}
		const result = await ItemModel.deleteOne({
			_id: id,
			accountId: new Types.ObjectId(accountId),
		}).exec();
		return result.deletedCount === 1;
	}
}

export class MongoCustomerRepository implements CustomerRepository {
	async create(accountId: AccountId, input: CreateCustomerInput): Promise<Customer> {
		const doc = await CustomerModel.create({ accountId: new Types.ObjectId(accountId), ...input });
		return mapCustomer(doc);
	}

	async list(options: ListCustomersOptions): Promise<{ customers: Customer[]; total: number }> {
		if (!Types.ObjectId.isValid(options.accountId)) {
			return { customers: [], total: 0 };
		}
		const { pageSize } = normalizePagination(options.page, options.pageSize);
		const skip = pageToSkip(options.page, options.pageSize);
		const filter = { accountId: new Types.ObjectId(options.accountId) };
		const [docs, total] = await Promise.all([
			CustomerModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(pageSize).exec(),
			CustomerModel.countDocuments(filter).exec(),
		]);
		return { customers: docs.map(mapCustomer), total };
	}

	async findById(accountId: AccountId, id: CustomerId): Promise<Customer | null> {
		if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(accountId)) {
			return null;
		}
		const doc = await CustomerModel.findOne({
			_id: id,
			accountId: new Types.ObjectId(accountId),
		}).exec();
		return doc ? mapCustomer(doc) : null;
	}

	async update(
		accountId: AccountId,
		id: CustomerId,
		input: UpdateCustomerInput,
	): Promise<Customer | null> {
		if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(accountId)) {
			return null;
		}
		const doc = await CustomerModel.findOneAndUpdate(
			{ _id: id, accountId: new Types.ObjectId(accountId) },
			{ $set: input },
			{ new: true },
		).exec();
		return doc ? mapCustomer(doc) : null;
	}

	async delete(accountId: AccountId, id: CustomerId): Promise<boolean> {
		if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(accountId)) {
			return false;
		}
		const result = await CustomerModel.deleteOne({
			_id: id,
			accountId: new Types.ObjectId(accountId),
		}).exec();
		return result.deletedCount === 1;
	}
}

export class MongoFaqRepository implements FaqRepository {
	async create(accountId: AccountId, input: CreateFaqInput): Promise<Faq> {
		const doc = await FaqModel.create({ accountId: new Types.ObjectId(accountId), ...input });
		return mapFaq(doc);
	}

	async list(options: ListFaqsOptions): Promise<{ faqs: Faq[]; total: number }> {
		if (!Types.ObjectId.isValid(options.accountId)) {
			return { faqs: [], total: 0 };
		}
		const { pageSize } = normalizePagination(options.page, options.pageSize);
		const skip = pageToSkip(options.page, options.pageSize);
		const filter = { accountId: new Types.ObjectId(options.accountId) };
		const [docs, total] = await Promise.all([
			FaqModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(pageSize).exec(),
			FaqModel.countDocuments(filter).exec(),
		]);
		return { faqs: docs.map(mapFaq), total };
	}

	async findById(accountId: AccountId, id: FaqId): Promise<Faq | null> {
		if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(accountId)) {
			return null;
		}
		const doc = await FaqModel.findOne({
			_id: id,
			accountId: new Types.ObjectId(accountId),
		}).exec();
		return doc ? mapFaq(doc) : null;
	}

	async update(accountId: AccountId, id: FaqId, input: UpdateFaqInput): Promise<Faq | null> {
		if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(accountId)) {
			return null;
		}
		const doc = await FaqModel.findOneAndUpdate(
			{ _id: id, accountId: new Types.ObjectId(accountId) },
			{ $set: input },
			{ new: true },
		).exec();
		return doc ? mapFaq(doc) : null;
	}

	async delete(accountId: AccountId, id: FaqId): Promise<boolean> {
		if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(accountId)) {
			return false;
		}
		const result = await FaqModel.deleteOne({
			_id: id,
			accountId: new Types.ObjectId(accountId),
		}).exec();
		return result.deletedCount === 1;
	}
}

export class MongoJobRepository implements JobRepository {
	async create(accountId: AccountId, input: CreateJobInput): Promise<Job> {
		const doc = await JobModel.create({
			accountId: new Types.ObjectId(accountId),
			...input,
			// Stored as a Date so range/overlap queries can use the index.
			startAt: new Date(input.startAt),
		});
		return mapJob(doc);
	}

	async list(options: ListJobsOptions): Promise<{ jobs: Job[]; total: number }> {
		if (!Types.ObjectId.isValid(options.accountId)) {
			return { jobs: [], total: 0 };
		}
		const { pageSize } = normalizePagination(options.page, options.pageSize);
		const skip = pageToSkip(options.page, options.pageSize);
		const filter: Record<string, unknown> = {
			accountId: new Types.ObjectId(options.accountId),
		};
		if (options.from || options.to) {
			const range: Record<string, Date> = {};
			if (options.from) {
				range.$gte = new Date(options.from);
			}
			if (options.to) {
				range.$lt = new Date(options.to);
			}
			filter.startAt = range;
		}
		if (options.assignedUserId) {
			filter.assignedUserId = options.assignedUserId;
		}
		if (options.status) {
			filter.status = options.status;
		}
		if (options.customerId) {
			filter.customerId = options.customerId;
		}
		const [docs, total] = await Promise.all([
			JobModel.find(filter).sort({ startAt: 1, _id: 1 }).skip(skip).limit(pageSize).exec(),
			JobModel.countDocuments(filter).exec(),
		]);
		return { jobs: docs.map(mapJob), total };
	}

	async findById(accountId: AccountId, id: JobId): Promise<Job | null> {
		if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(accountId)) {
			return null;
		}
		const doc = await JobModel.findOne({
			_id: id,
			accountId: new Types.ObjectId(accountId),
		}).exec();
		return doc ? mapJob(doc) : null;
	}

	async update(accountId: AccountId, id: JobId, input: UpdateJobInput): Promise<Job | null> {
		if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(accountId)) {
			return null;
		}
		// Convert the ISO start to a Date for storage; leave every other field as-is.
		const set: Record<string, unknown> = { ...input };
		if (input.startAt !== undefined) {
			set.startAt = new Date(input.startAt);
		}
		const doc = await JobModel.findOneAndUpdate(
			{ _id: id, accountId: new Types.ObjectId(accountId) },
			{ $set: set },
			{ new: true },
		).exec();
		return doc ? mapJob(doc) : null;
	}

	async delete(accountId: AccountId, id: JobId): Promise<boolean> {
		if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(accountId)) {
			return false;
		}
		const result = await JobModel.deleteOne({
			_id: id,
			accountId: new Types.ObjectId(accountId),
		}).exec();
		return result.deletedCount === 1;
	}

	async findOverlapping(options: FindOverlappingJobsOptions): Promise<Job[]> {
		// An empty assignee never conflicts; also skip a malformed account id.
		if (!options.assignedUserId || !Types.ObjectId.isValid(options.accountId)) {
			return [];
		}
		const windowStart = new Date(options.startAt);
		const windowEnd = new Date(options.endAt);
		// Durations are capped at 24h (see `durationMinutesSchema`), so any job that
		// starts more than 24h before the window can't possibly still be running when
		// it opens. Bounding `startAt` from below keeps this indexed query to the
		// handful of candidates around the window instead of scanning the assignee's
		// whole history on every conflict check.
		const earliestPossibleStart = new Date(windowStart.getTime() - 1440 * 60_000);
		const filter: Record<string, unknown> = {
			accountId: new Types.ObjectId(options.accountId),
			assignedUserId: options.assignedUserId,
			status: { $ne: 'canceled' },
			// Existing job must start within [windowStart-24h, windowEnd) to overlap;
			// the compound index serves this range.
			startAt: { $gte: earliestPossibleStart, $lt: windowEnd },
		};
		if (options.excludeJobId && Types.ObjectId.isValid(options.excludeJobId)) {
			filter._id = { $ne: new Types.ObjectId(options.excludeJobId) };
		}
		const docs = await JobModel.find(filter).sort({ startAt: 1, _id: 1 }).exec();
		// The index can't express `startAt + duration > windowStart`, so finish the
		// half-open overlap test in memory over the (small) per-member candidate set.
		const windowStartMs = windowStart.getTime();
		return docs
			.filter((doc) => doc.startAt.getTime() + doc.durationMinutes * 60_000 > windowStartMs)
			.map(mapJob);
	}
}
