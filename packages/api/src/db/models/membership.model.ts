import { model, Schema, type Types } from 'mongoose';

export interface MembershipDocument {
	accountId: Types.ObjectId;
	userId: Types.ObjectId;
	role: 'owner' | 'manager' | 'team_member';
	createdAt: Date;
	updatedAt: Date;
}

const membershipSchema = new Schema<MembershipDocument>(
	{
		accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
		// Unique so a user belongs to exactly one account (one account per user).
		userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
		role: { type: String, enum: ['owner', 'manager', 'team_member'], required: true },
	},
	{ timestamps: true },
);

export const MembershipModel = model<MembershipDocument>('Membership', membershipSchema);
