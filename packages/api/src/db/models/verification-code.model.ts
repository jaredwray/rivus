import { model, Schema } from 'mongoose';
import type {
	PendingEmailChange,
	PendingSignup,
	VerificationPurpose,
} from '../../repositories/types';

export interface VerificationCodeDocument {
	email: string;
	purpose: VerificationPurpose;
	/** Scrypt hash of the 6-digit code — the plaintext only ever lives in the email. */
	codeHash: string;
	expiresAt: Date;
	attempts: number;
	/** Account details captured at signup, applied once the code is verified. */
	signup?: PendingSignup;
	/** The user moving addresses, present only on `email_change` codes. */
	emailChange?: PendingEmailChange;
	createdAt: Date;
	updatedAt: Date;
}

const verificationCodeSchema = new Schema<VerificationCodeDocument>(
	{
		// One active code per email — a new request replaces the previous code.
		email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
		purpose: { type: String, required: true, enum: ['login', 'signup', 'email_change'] },
		codeHash: { type: String, required: true },
		expiresAt: { type: Date, required: true },
		attempts: { type: Number, required: true, default: 0 },
		signup: { type: Schema.Types.Mixed },
		emailChange: { type: Schema.Types.Mixed },
	},
	{ timestamps: true },
);

// TTL index: Mongo reaps each code as soon as `expiresAt` passes, so stale codes
// never linger even if a verify request never arrives to consume them.
verificationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const VerificationCodeModel = model<VerificationCodeDocument>(
	'VerificationCode',
	verificationCodeSchema,
);
