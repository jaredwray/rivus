import { model, Schema, type Types } from 'mongoose';

/** One message in a conversation's transcript, stored as an embedded subdocument. */
export interface MessageSubdocument {
	_id: Types.ObjectId;
	author: 'customer' | 'rivus' | 'agent' | 'note';
	body: string;
	createdAt: Date;
}

export interface ConversationDocument {
	accountId: Types.ObjectId;
	/** Linked CRM customer id (as a string), or '' for a lead with no customer record. */
	customerId: string;
	contactName: string;
	contactPhone: string;
	channel: 'whatsapp' | 'phone' | 'email' | 'sms';
	status: 'rivus_handling' | 'needs_attention' | 'resolved';
	snippet: string;
	tags: string[];
	lastInvoice: string;
	pendingReply: string;
	flagReason: string;
	lastMessageAt: Date;
	/** Append-only transcript embedded on the conversation so a thread loads in one read. */
	messages: MessageSubdocument[];
	createdAt: Date;
	updatedAt: Date;
}

// Messages are immutable once written, so they carry their own `createdAt` (set on
// append) rather than full timestamps — there's no `updatedAt` to maintain.
const messageSchema = new Schema<MessageSubdocument>(
	{
		author: {
			type: String,
			enum: ['customer', 'rivus', 'agent', 'note'],
			required: true,
		},
		body: { type: String, required: true },
		createdAt: { type: Date, required: true },
	},
	{ _id: true },
);

const conversationSchema = new Schema<ConversationDocument>(
	{
		accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
		customerId: { type: String, default: '' },
		contactName: { type: String, required: true, trim: true },
		contactPhone: { type: String, default: '', trim: true },
		channel: {
			type: String,
			enum: ['whatsapp', 'phone', 'email', 'sms'],
			required: true,
		},
		status: {
			type: String,
			enum: ['rivus_handling', 'needs_attention', 'resolved'],
			default: 'rivus_handling',
		},
		snippet: { type: String, default: '' },
		tags: { type: [String], default: [] },
		lastInvoice: { type: String, default: '' },
		pendingReply: { type: String, default: '' },
		flagReason: { type: String, default: '' },
		lastMessageAt: { type: Date, required: true },
		messages: { type: [messageSchema], default: [] },
	},
	{ timestamps: true },
);

// The inbox lists an account's conversations newest-activity-first; the badge
// counts the ones that need a human. A compound index serves both.
conversationSchema.index({ accountId: 1, lastMessageAt: -1, _id: -1 });
conversationSchema.index({ accountId: 1, status: 1 });

export const ConversationModel = model<ConversationDocument>('Conversation', conversationSchema);
