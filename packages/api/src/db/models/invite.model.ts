import { model, Schema, type Types } from 'mongoose';

export interface InviteDocument {
	accountId: Types.ObjectId;
	email: string;
	name: string;
	role: 'manager' | 'team_member';
	status: 'pending' | 'accepted' | 'revoked';
	token: string;
	invitedBy: Types.ObjectId;
	createdAt: Date;
	updatedAt: Date;
}

const inviteSchema = new Schema<InviteDocument>(
	{
		accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
		email: { type: String, required: true, lowercase: true, trim: true, index: true },
		name: { type: String, required: true, trim: true },
		role: { type: String, enum: ['manager', 'team_member'], required: true },
		status: {
			type: String,
			enum: ['pending', 'accepted', 'revoked'],
			default: 'pending',
			index: true,
		},
		token: { type: String, required: true, unique: true, index: true },
		invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
	},
	{ timestamps: true },
);

export const InviteModel = model<InviteDocument>('Invite', inviteSchema);
