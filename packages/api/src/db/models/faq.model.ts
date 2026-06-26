import { model, Schema, type Types } from 'mongoose';

export interface FaqDocument {
	accountId: Types.ObjectId;
	question: string;
	answer: string;
	category: string;
	status: 'published' | 'draft';
	createdAt: Date;
	updatedAt: Date;
}

const faqSchema = new Schema<FaqDocument>(
	{
		accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
		question: { type: String, required: true, trim: true },
		answer: { type: String, required: true, trim: true },
		category: { type: String, default: '', trim: true },
		status: { type: String, enum: ['published', 'draft'], default: 'published' },
	},
	{ timestamps: true },
);

export const FaqModel = model<FaqDocument>('Faq', faqSchema);
