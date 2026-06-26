import { model, Schema, type Types } from 'mongoose';

export interface CustomerDocument {
	accountId: Types.ObjectId;
	name: string;
	email: string;
	phone: string;
	area: string;
	channel: 'whatsapp' | 'phone' | 'email' | 'sms';
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
		area: { type: String, default: '', trim: true },
		channel: { type: String, enum: ['whatsapp', 'phone', 'email', 'sms'], default: 'phone' },
		status: { type: String, enum: ['lead', 'quote', 'paid', 'due'], default: 'lead' },
		lifetimeValue: { type: Number, default: 0 },
		balance: { type: Number, default: 0 },
		notes: { type: String, default: '', trim: true },
	},
	{ timestamps: true },
);

export const CustomerModel = model<CustomerDocument>('Customer', customerSchema);
