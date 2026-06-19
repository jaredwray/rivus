import type { CreateItemInput, Item, ItemId, UpdateItemInput, User, UserId } from '@rivus/core';

/** A user as persisted, including the bcrypt password hash (never serialized). */
export interface StoredUser extends User {
	passwordHash: string;
}

export interface NewUser {
	email: string;
	name: string;
	passwordHash: string;
}

export interface UserRepository {
	create(input: NewUser): Promise<StoredUser>;
	findByEmail(email: string): Promise<StoredUser | null>;
	findById(id: UserId): Promise<StoredUser | null>;
}

export interface ListItemsOptions {
	ownerId: UserId;
	page: number;
	pageSize: number;
}

export interface ItemRepository {
	create(ownerId: UserId, input: CreateItemInput): Promise<Item>;
	list(options: ListItemsOptions): Promise<{ items: Item[]; total: number }>;
	findById(ownerId: UserId, id: ItemId): Promise<Item | null>;
	update(ownerId: UserId, id: ItemId, input: UpdateItemInput): Promise<Item | null>;
	delete(ownerId: UserId, id: ItemId): Promise<boolean>;
}
