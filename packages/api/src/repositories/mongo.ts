import {
	type CreateItemInput,
	type Item,
	type ItemId,
	normalizePagination,
	pageToSkip,
	type UpdateItemInput,
	type UserId,
} from '@rivus/core';
import { type HydratedDocument, Types } from 'mongoose';
import { type ItemDocument, ItemModel } from '../db/models/item.model';
import { type UserDocument, UserModel } from '../db/models/user.model';
import type {
	ItemRepository,
	ListItemsOptions,
	NewUser,
	StoredUser,
	UserRepository,
} from './types';

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

function mapItem(doc: HydratedDocument<ItemDocument>): Item {
	return {
		id: doc._id.toString() as ItemId,
		ownerId: doc.ownerId.toString() as UserId,
		name: doc.name,
		description: doc.description,
		status: doc.status,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

export class MongoUserRepository implements UserRepository {
	async create(input: NewUser): Promise<StoredUser> {
		const doc = await UserModel.create(input);
		return mapUser(doc);
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
}

export class MongoItemRepository implements ItemRepository {
	async create(ownerId: UserId, input: CreateItemInput): Promise<Item> {
		const doc = await ItemModel.create({ ownerId: new Types.ObjectId(ownerId), ...input });
		return mapItem(doc);
	}

	async list(options: ListItemsOptions): Promise<{ items: Item[]; total: number }> {
		const { pageSize } = normalizePagination(options.page, options.pageSize);
		const skip = pageToSkip(options.page, options.pageSize);
		const filter = { ownerId: new Types.ObjectId(options.ownerId) };
		const [docs, total] = await Promise.all([
			ItemModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(pageSize).exec(),
			ItemModel.countDocuments(filter).exec(),
		]);
		return { items: docs.map(mapItem), total };
	}

	async findById(ownerId: UserId, id: ItemId): Promise<Item | null> {
		if (!Types.ObjectId.isValid(id)) {
			return null;
		}
		const doc = await ItemModel.findOne({
			_id: id,
			ownerId: new Types.ObjectId(ownerId),
		}).exec();
		return doc ? mapItem(doc) : null;
	}

	async update(ownerId: UserId, id: ItemId, input: UpdateItemInput): Promise<Item | null> {
		if (!Types.ObjectId.isValid(id)) {
			return null;
		}
		const doc = await ItemModel.findOneAndUpdate(
			{ _id: id, ownerId: new Types.ObjectId(ownerId) },
			{ $set: input },
			{ new: true },
		).exec();
		return doc ? mapItem(doc) : null;
	}

	async delete(ownerId: UserId, id: ItemId): Promise<boolean> {
		if (!Types.ObjectId.isValid(id)) {
			return false;
		}
		const result = await ItemModel.deleteOne({
			_id: id,
			ownerId: new Types.ObjectId(ownerId),
		}).exec();
		return result.deletedCount === 1;
	}
}
