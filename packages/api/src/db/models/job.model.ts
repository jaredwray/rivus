import type { JobStatus } from '@rivus/core';
import { model, Schema, type Types } from 'mongoose';

export interface JobDocument {
	accountId: Types.ObjectId;
	/** Linked customer id, or '' when the job isn't tied to a customer. */
	customerId: string;
	/** Assigned team member (user id), or '' when unassigned. */
	assignedUserId: string;
	title: string;
	status: JobStatus;
	/** Scheduled start, stored as a Date so range/overlap queries can use an index. */
	startAt: Date;
	durationMinutes: number;
	address: string;
	notes: string;
	estimatedValue: number;
	createdAt: Date;
	updatedAt: Date;
}

const jobSchema = new Schema<JobDocument>(
	{
		accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
		// Stored as plain strings (not refs) so "unassigned" is a natural '' and the
		// route — not the schema — owns referential checks against this account.
		customerId: { type: String, default: '', trim: true },
		assignedUserId: { type: String, default: '', trim: true },
		title: { type: String, required: true, trim: true },
		status: {
			type: String,
			enum: ['scheduled', 'confirmed', 'in_progress', 'completed', 'canceled'],
			default: 'scheduled',
		},
		startAt: { type: Date, required: true },
		durationMinutes: { type: Number, default: 60 },
		address: { type: String, default: '', trim: true },
		notes: { type: String, default: '', trim: true },
		estimatedValue: { type: Number, default: 0 },
	},
	{ timestamps: true },
);

// The account-scoped calendar query filters by `accountId` and a `startAt` range,
// sorted by `{ startAt: 1, _id: 1 }`; a matching compound index serves it from the
// index instead of an in-memory sort.
jobSchema.index({ accountId: 1, startAt: 1, _id: 1 });
// The double-booking check narrows to one member's jobs in a time window.
jobSchema.index({ accountId: 1, assignedUserId: 1, startAt: 1 });

export const JobModel = model<JobDocument>('Job', jobSchema);
