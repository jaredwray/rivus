import { model, Schema } from 'mongoose';

/**
 * A sales lead captured by the marketing site (demo request or waitlist
 * signup). Deliberately not account-scoped: a lead exists before any account
 * does.
 */
export interface DemoLeadDocument {
	name: string;
	email: string;
	business: string;
	phone: string;
	trade: string;
	source: 'website-demo' | 'apps-waitlist';
	createdAt: Date;
	updatedAt: Date;
}

const demoLeadSchema = new Schema<DemoLeadDocument>(
	{
		name: { type: String, required: true, trim: true },
		email: { type: String, required: true, trim: true, lowercase: true },
		business: { type: String, default: '', trim: true },
		phone: { type: String, default: '', trim: true },
		trade: { type: String, default: '', trim: true },
		source: {
			type: String,
			enum: ['website-demo', 'apps-waitlist'],
			default: 'website-demo',
			index: true,
		},
	},
	{ timestamps: true },
);

// The staff list sorts the whole collection newest-first with no filter, so
// without this index every page is a collection scan + in-memory sort.
demoLeadSchema.index({ createdAt: -1, _id: -1 });

// One lead per (email, source): the repository upserts on this pair so a
// retried submission can't double-book the sales queue, and the unique index
// closes the concurrent-insert race.
demoLeadSchema.index({ email: 1, source: 1 }, { unique: true });

export const DemoLeadModel = model<DemoLeadDocument>('DemoLead', demoLeadSchema);
