import { model, Schema } from 'mongoose';

export interface UserDocument {
	email: string;
	name: string;
	phone: string;
	/** A new email address awaiting verification, or `''` when none is pending. */
	pendingEmail: string;
	/** Custom avatar override, or `''` to fall back to the Gravatar derived from `email`. */
	avatarUrl: string;
	createdAt: Date;
	updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
	{
		email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
		name: { type: String, required: true, trim: true },
		phone: { type: String, default: '', trim: true },
		// Not unique: it defaults to '' (many users share that) and is just a staging
		// slot — uniqueness is enforced on `email` when the change is actually applied.
		pendingEmail: { type: String, default: '', lowercase: true, trim: true },
		avatarUrl: { type: String, default: '', trim: true },
	},
	{ timestamps: true },
);

export const UserModel = model<UserDocument>('User', userSchema);
