import { model, Schema } from 'mongoose';

export interface AccountDocument {
	name: string;
	slug: string;
	phone: string;
	address: string;
	website: string;
	timezone: string;
	status: 'active' | 'canceled';
	canceledAt: Date | null;
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
		// Soft delete: `canceled` keeps the row (and its data) but locks the account
		// out at authentication time. Defaults keep existing/active accounts unchanged.
		status: { type: String, enum: ['active', 'canceled'], default: 'active', index: true },
		canceledAt: { type: Date, default: null },
	},
	{ timestamps: true },
);

export const AccountModel = model<AccountDocument>('Account', accountSchema);
