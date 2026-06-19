import { model, Schema, type Types } from 'mongoose';

export interface ItemDocument {
	ownerId: Types.ObjectId;
	name: string;
	description: string;
	status: 'active' | 'archived';
	createdAt: Date;
	updatedAt: Date;
}

const itemSchema = new Schema<ItemDocument>(
	{
		ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
		name: { type: String, required: true, trim: true },
		description: { type: String, default: '' },
		status: { type: String, enum: ['active', 'archived'], default: 'active' },
	},
	{ timestamps: true },
);

export const ItemModel = model<ItemDocument>('Item', itemSchema);
