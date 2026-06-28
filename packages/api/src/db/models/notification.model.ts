import { model, Schema, type Types } from 'mongoose';

export interface NotificationDocument {
	accountId: Types.ObjectId;
	/** The recipient this notification is addressed to. */
	userId: Types.ObjectId;
	type:
		| 'job_assigned'
		| 'job_updated'
		| 'job_canceled'
		| 'invite_accepted'
		| 'role_changed'
		| 'system';
	title: string;
	body: string;
	readState: 'unread' | 'read';
	linkHref: string;
	createdAt: Date;
	updatedAt: Date;
}

const notificationSchema = new Schema<NotificationDocument>(
	{
		accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
		userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		type: {
			type: String,
			enum: [
				'job_assigned',
				'job_updated',
				'job_canceled',
				'invite_accepted',
				'role_changed',
				'system',
			],
			default: 'system',
		},
		title: { type: String, required: true, trim: true },
		body: { type: String, default: '' },
		readState: { type: String, enum: ['unread', 'read'], default: 'unread' },
		linkHref: { type: String, default: '' },
	},
	{ timestamps: true },
);

// A user reads their own notifications newest-first, and the unread badge counts
// the unread ones — both are served by this compound index.
notificationSchema.index({ accountId: 1, userId: 1, createdAt: -1 });
notificationSchema.index({ accountId: 1, userId: 1, readState: 1 });

export const NotificationModel = model<NotificationDocument>('Notification', notificationSchema);
