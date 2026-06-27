import { model, Schema, type Types } from 'mongoose';

export interface CustomerDocument {
	accountId: Types.ObjectId;
	name: string;
	email: string;
	phone: string;
	address: string;
	/**
	 * @deprecated Legacy location field from before it was renamed to `address`.
	 * Retained in the schema only so documents written before the rename still
	 * hydrate their stored value; `mapCustomer` falls back to it when `address`
	 * is empty. It is never written to new documents and can be dropped once
	 * existing customers have been backfilled.
	 */
	area?: string;
	status: 'lead' | 'quote' | 'paid' | 'due';
	lifetimeValue: number;
	balance: number;
	notes: string;
	createdAt: Date;
	updatedAt: Date;
}

const customerSchema = new Schema<CustomerDocument>(
	{
		accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
		name: { type: String, required: true, trim: true },
		email: { type: String, default: '', trim: true, lowercase: true },
		phone: { type: String, default: '', trim: true },
		address: { type: String, default: '', trim: true },
		// Legacy location field (renamed to `address`). No default, so it is never
		// written to new documents, but it is still read back for pre-rename records
		// (see the fallback in `mapCustomer`).
		area: { type: String, trim: true },
		status: { type: String, enum: ['lead', 'quote', 'paid', 'due'], default: 'lead' },
		lifetimeValue: { type: Number, default: 0 },
		balance: { type: Number, default: 0 },
		notes: { type: String, default: '', trim: true },
	},
	{ timestamps: true },
);

// The account-scoped list query filters by `accountId` and sorts by
// `{ createdAt: -1, _id: -1 }`; a matching compound index lets Mongo serve it
// from the index instead of an in-memory sort (which fails past the 32MB limit
// once an account has many customers).
customerSchema.index({ accountId: 1, createdAt: -1, _id: -1 });

export const CustomerModel = model<CustomerDocument>('Customer', customerSchema);
