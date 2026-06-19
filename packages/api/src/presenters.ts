import type { User } from '@rivus/core';
import type { StoredUser } from './repositories/types';

/** Strip the password hash before a user ever leaves the API. */
export function toPublicUser(user: StoredUser): User {
	return {
		id: user.id,
		email: user.email,
		name: user.name,
		createdAt: user.createdAt,
		updatedAt: user.updatedAt,
	};
}
