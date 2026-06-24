import {
	type Account,
	type AccountId,
	type CreateItemInput,
	type Invite,
	type InviteId,
	type Item,
	type ItemId,
	type Membership,
	type MembershipId,
	normalizePagination,
	pageToSkip,
	type Role,
	type UpdateItemInput,
	type UserId,
} from '@rivus/core';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import { type AccountDocument, AccountModel } from '../db/models/account.model';
import { type InviteDocument, InviteModel } from '../db/models/invite.model';
import { type ItemDocument, ItemModel } from '../db/models/item.model';
import { type MembershipDocument, MembershipModel } from '../db/models/membership.model';
import { type UserDocument, UserModel } from '../db/models/user.model';
import { ConflictError, InviteNotPendingError } from './errors';
import type {
	AcceptInviteInput,
	AcceptInviteResult,
	AccountRepository,
	InviteRepository,
	ItemRepository,
	ListItemsOptions,
	MembershipRepository,
	NewAccount,
	NewInvite,
	NewMembership,
	NewUser,
	OnboardingRepository,
	SignupInput,
	SignupResult,
	StoredUser,
	UserRepository,
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
		passwordHash: doc.passwordHash,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
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
		const doc = await MembershipModel.findOneAndUpdate(
			{ accountId: new Types.ObjectId(accountId), userId: new Types.ObjectId(userId) },
			{ $set: { role } },
			{ new: true },
		).exec();
		return doc ? mapMembership(doc) : null;
	}

	async delete(accountId: AccountId, userId: UserId): Promise<boolean> {
		if (!Types.ObjectId.isValid(accountId) || !Types.ObjectId.isValid(userId)) {
			return false;
		}
		const result = await MembershipModel.deleteOne({
			accountId: new Types.ObjectId(accountId),
			userId: new Types.ObjectId(userId),
		}).exec();
		return result.deletedCount === 1;
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
