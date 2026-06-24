import { model, Schema } from 'mongoose';

export interface AccountDocument {
	name: string;
	slug: string;
	phone: string;
	address: string;
	website: string;
	timezone: string;
	createdAt: Date;
	updatedAt: Date;
}

const accountSchema = new Schema<AccountDocument>(
	{
		name: { type: String, required: true, trim: true },
		slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
		phone: { type: String, default: '' },
		address: { type: String, default: '' },
		website: { type: String, default: '' },
		timezone: { type: String, default: 'UTC' },
	},
	{ timestamps: true },
);

export const AccountModel = model<AccountDocument>('Account', accountSchema);
