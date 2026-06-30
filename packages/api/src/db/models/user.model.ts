import { model, Schema } from 'mongoose';

export interface UserDocument {
	email: string;
	name: string;
	/** Custom avatar override; unset falls back to the Gravatar derived from `email`. */
	avatarUrl?: string;
	createdAt: Date;
	updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
	{
		email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
		name: { type: String, required: true, trim: true },
		avatarUrl: { type: String, required: false, trim: true },
	},
	{ timestamps: true },
);

export const UserModel = model<UserDocument>('User', userSchema);
