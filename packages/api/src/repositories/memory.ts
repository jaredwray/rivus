import { randomUUID } from 'node:crypto';
import {
	type CreateItemInput,
	type Item,
	type ItemId,
	normalizePagination,
	pageToSkip,
	type UpdateItemInput,
	type UserId,
} from '@rivus/core';
import type {
	ItemRepository,
	ListItemsOptions,
	NewUser,
	StoredUser,
	UserRepository,
} from './types';

const now = (): string => new Date().toISOString();

/** In-memory user store — used by tests and for running the API without Mongo. */
export class InMemoryUserRepository implements UserRepository {
	private readonly byId = new Map<string, StoredUser>();

	async create(input: NewUser): Promise<StoredUser> {
		const timestamp = now();
		const user: StoredUser = {
			id: randomUUID() as UserId,
			email: input.email,
			name: input.name,
			passwordHash: input.passwordHash,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.byId.set(user.id, user);
		return structuredClone(user);
	}

	async findByEmail(email: string): Promise<StoredUser | null> {
		const normalized = email.trim().toLowerCase();
		for (const user of this.byId.values()) {
			if (user.email === normalized) {
				return structuredClone(user);
			}
		}
		return null;
	}

	async findById(id: UserId): Promise<StoredUser | null> {
		const user = this.byId.get(id);
		return user ? structuredClone(user) : null;
	}
}

/** In-memory item store, scoped by owner. */
export class InMemoryItemRepository implements ItemRepository {
	private readonly byId = new Map<string, Item>();

	async create(ownerId: UserId, input: CreateItemInput): Promise<Item> {
		const timestamp = now();
		const item: Item = {
			id: randomUUID() as ItemId,
			ownerId,
			name: input.name,
			description: input.description,
			status: input.status,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.byId.set(item.id, item);
		return structuredClone(item);
	}

	async list(options: ListItemsOptions): Promise<{ items: Item[]; total: number }> {
		// Map preserves insertion order, so reversing yields a deterministic
		// newest-first ordering even when timestamps collide within a millisecond.
		const owned = [...this.byId.values()]
			.filter((item) => item.ownerId === options.ownerId)
			.reverse();
		const { pageSize } = normalizePagination(options.page, options.pageSize);
		const skip = pageToSkip(options.page, options.pageSize);
		return {
			items: owned.slice(skip, skip + pageSize).map((item) => structuredClone(item)),
			total: owned.length,
		};
	}

	async findById(ownerId: UserId, id: ItemId): Promise<Item | null> {
		const item = this.byId.get(id);
		return item && item.ownerId === ownerId ? structuredClone(item) : null;
	}

	async update(ownerId: UserId, id: ItemId, input: UpdateItemInput): Promise<Item | null> {
		const item = this.byId.get(id);
		if (!item || item.ownerId !== ownerId) {
			return null;
		}
		const updated: Item = { ...item, ...input, updatedAt: now() };
		this.byId.set(id, updated);
		return structuredClone(updated);
	}

	async delete(ownerId: UserId, id: ItemId): Promise<boolean> {
		const item = this.byId.get(id);
		if (!item || item.ownerId !== ownerId) {
			return false;
		}
		return this.byId.delete(id);
	}
}
