import { model, Schema } from 'mongoose';

/** One provisioned channel's config, embedded on the account (no identity of its own). */
export interface AccountChannelConfigSubdocument {
	enabled: boolean;
	/** The provisioned E.164 identifier, stored normalized; '' until provisioned. */
	address: string;
	/** The provider's opaque handle for the resource; '' when none. */
	providerRef: string;
}

export interface AccountDocument {
	name: string;
	slug: string;
	phone: string;
	address: string;
	website: string;
	timezone: string;
	/**
	 * Provisioned messaging channels. Email is derived from `slug`+`id` and never
	 * stored here; only externally-assigned identifiers (WhatsApp today; SMS and
	 * voice reserved) live on the account.
	 */
	channels: {
		whatsapp: AccountChannelConfigSubdocument;
		sms: AccountChannelConfigSubdocument;
		voice: AccountChannelConfigSubdocument;
	};
	status: 'active' | 'canceled';
	canceledAt: Date | null;
	/**
	 * Bumped inside owner-management transactions so two concurrent demote/remove
	 * requests write the same account document, conflict, and serialize — closing
	 * the check-then-write race that could otherwise orphan an account. Internal;
	 * never serialized to the API.
	 */
	membershipsVersion: number;
	createdAt: Date;
	updatedAt: Date;
}

// Embedded per-channel config. No `_id` — it's a value object rewritten wholesale
// when a channel is provisioned/enabled/disabled.
const accountChannelConfigSchema = new Schema<AccountChannelConfigSubdocument>(
	{
		enabled: { type: Boolean, default: false },
		address: { type: String, default: '', trim: true },
		providerRef: { type: String, default: '', trim: true },
	},
	{ _id: false },
);

const accountSchema = new Schema<AccountDocument>(
	{
		name: { type: String, required: true, trim: true },
		slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
		phone: { type: String, default: '' },
		address: { type: String, default: '' },
		website: { type: String, default: '' },
		timezone: { type: String, default: 'UTC' },
		// Each channel defaults to its own fresh off/empty subdoc.
		channels: {
			whatsapp: { type: accountChannelConfigSchema, default: () => ({}) },
			sms: { type: accountChannelConfigSchema, default: () => ({}) },
			voice: { type: accountChannelConfigSchema, default: () => ({}) },
		},
		// Soft delete: `canceled` keeps the row (and its data) but locks the account
		// out at authentication time. Defaults keep existing/active accounts unchanged.
		status: { type: String, enum: ['active', 'canceled'], default: 'active', index: true },
		canceledAt: { type: Date, default: null },
		membershipsVersion: { type: Number, default: 0 },
	},
	{ timestamps: true },
);

// A provisioned channel identifier is the multi-tenant key an inbound webhook
// resolves to its account, so it must be unique across accounts — but only when
// actually assigned. A *partial* (not sparse) index is required: every account
// stores the field, defaulting to `''`, so a sparse index wouldn't skip the
// unprovisioned rows and their shared `''` would collide. The partial filter
// indexes only rows whose address is non-empty.
for (const channel of ['whatsapp', 'sms', 'voice'] as const) {
	accountSchema.index(
		{ [`channels.${channel}.address`]: 1 },
		{ unique: true, partialFilterExpression: { [`channels.${channel}.address`]: { $gt: '' } } },
	);
}

export const AccountModel = model<AccountDocument>('Account', accountSchema);
