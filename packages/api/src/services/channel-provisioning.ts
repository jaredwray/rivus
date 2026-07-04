import { type AccountId, agentEmailTag } from '@rivus/core';

/**
 * Provisioning of a channel's customer-facing identifier. Unlike email (whose
 * address is derived from the account and always on), WhatsApp/SMS/voice numbers
 * are assigned by the provider when an owner enables the channel, then stored on
 * the account. This seam keeps that provider call behind an interface so the API
 * boots and tests without credentials.
 */

/** A provisioned identifier plus the provider's opaque handle for it. */
export interface ProvisionedIdentifier {
	/** The customer-facing E.164 number. */
	address: string;
	/** The provider's reference for the provisioned resource; '' when none. */
	providerRef: string;
}

export interface ChannelProvisioner {
	/**
	 * Assign (or re-confirm) this account's identifier. Idempotent: when
	 * `existing.address` is non-empty it is returned unchanged (re-enabling never
	 * re-provisions). Rejects on provider failure — the route maps that to 502 and
	 * persists nothing.
	 */
	provision(input: {
		accountId: AccountId;
		accountName: string;
		existing: ProvisionedIdentifier;
	}): Promise<ProvisionedIdentifier>;
}

/**
 * A provisioner that hands out a deterministic fake number derived from the
 * account id (the same FNV-1a tag the agent email address uses), so development
 * and tests get a stable, unique `+1555…` number without a provider — and
 * re-enabling returns the same one.
 */
export class NoopChannelProvisioner implements ChannelProvisioner {
	async provision(input: {
		accountId: AccountId;
		accountName: string;
		existing: ProvisionedIdentifier;
	}): Promise<ProvisionedIdentifier> {
		if (input.existing.address !== '') {
			return input.existing;
		}
		// 7 subscriber digits from the account's hex tag → +1 555 XXX XXXX.
		const subscriber = (Number.parseInt(agentEmailTag(input.accountId), 16) % 10_000_000)
			.toString()
			.padStart(7, '0');
		return { address: `+1555${subscriber}`, providerRef: 'noop' };
	}
}
