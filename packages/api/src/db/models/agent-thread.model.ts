import { model, Schema, type Types } from 'mongoose';

/** One offered slot, embedded on the thread (no identity of its own). */
export interface AgentSlotSubdocument {
	startAt: Date;
	durationMinutes: number;
}

export interface AgentThreadDocument {
	accountId: Types.ObjectId;
	channel: 'whatsapp' | 'phone' | 'email' | 'sms';
	/** The contact's channel address, stored lower-cased (email address for email). */
	contactAddress: string;
	conversationId: Types.ObjectId;
	/** Linked CRM customer id (as a string), or '' until the sender is validated. */
	customerId: string;
	state: 'new' | 'awaiting_signup' | 'slots_offered' | 'booked';
	/** Slots most recently offered; only meaningful while `state` is `slots_offered`. */
	offeredSlots: AgentSlotSubdocument[];
	lastExternalMessageId: string;
	subject: string;
	bookedJobId: string;
	createdAt: Date;
	updatedAt: Date;
}

// Offered slots are value objects rewritten wholesale on each offer, so they
// carry no _id of their own.
const agentSlotSchema = new Schema<AgentSlotSubdocument>(
	{
		startAt: { type: Date, required: true },
		durationMinutes: { type: Number, required: true },
	},
	{ _id: false },
);

const agentThreadSchema = new Schema<AgentThreadDocument>(
	{
		accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
		channel: {
			type: String,
			enum: ['whatsapp', 'phone', 'email', 'sms'],
			required: true,
		},
		contactAddress: { type: String, required: true, trim: true, lowercase: true },
		conversationId: {
			type: Schema.Types.ObjectId,
			ref: 'Conversation',
			required: true,
		},
		customerId: { type: String, default: '' },
		state: {
			type: String,
			enum: ['new', 'awaiting_signup', 'slots_offered', 'booked'],
			default: 'new',
		},
		offeredSlots: { type: [agentSlotSchema], default: [] },
		lastExternalMessageId: { type: String, default: '' },
		subject: { type: String, default: '' },
		bookedJobId: { type: String, default: '' },
	},
	{ timestamps: true },
);

// Each contact has exactly one thread per channel within an account — the
// lookup every inbound message performs, and the invariant that keeps two
// concurrent webhook deliveries from splitting one exchange across two threads.
agentThreadSchema.index({ accountId: 1, channel: 1, contactAddress: 1 }, { unique: true });

export const AgentThreadModel = model<AgentThreadDocument>('AgentThread', agentThreadSchema);
