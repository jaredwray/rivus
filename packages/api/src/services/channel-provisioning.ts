import { type AccountId, agentEmailTag } from '@rivus/core';
import type { FastifyBaseLogger } from 'fastify';

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

/** What a provisioner needs to assign (or re-confirm) an account's identifier. */
export interface ProvisionInput {
	accountId: AccountId;
	accountName: string;
	existing: ProvisionedIdentifier;
	/**
	 * The request logger, when the caller has one. Provider provisioners use it
	 * to record each upstream call and its response, so a failed enable can be
	 * diagnosed from the logs (the route only surfaces a generic 502).
	 */
	logger?: FastifyBaseLogger;
}

export interface ChannelProvisioner {
	/**
	 * Assign (or re-confirm) this account's identifier. Idempotent: when
	 * `existing.address` is non-empty it is returned unchanged (re-enabling never
	 * re-provisions). Rejects on provider failure — the route maps that to 502 and
	 * persists nothing.
	 */
	provision(input: ProvisionInput): Promise<ProvisionedIdentifier>;
}

/** How a release attempt resolved. */
export type ReleaseOutcome =
	/** The provider confirmed the number is released (billing stops). */
	| 'released'
	/**
	 * The provider doesn't know the ref *under these credentials' account*.
	 * Ambiguous: already released (e.g. by hand in the console) — or rented by a
	 * different provider account (rotated credentials) and still billing there.
	 * Callers must not treat this as a confirmed release.
	 */
	| 'not_found'
	/**
	 * No provider credentials to release with — nothing was attempted, so the
	 * rental (if any) is still live. Callers must NOT treat the number as gone:
	 * clearing its stored config would orphan a number that keeps billing.
	 */
	| 'skipped';

/**
 * Releases a rented number back to the provider — the undo of
 * {@link ChannelProvisioner}. Today this only backs the development-only
 * "release & reset" admin flow; production never releases numbers (disable
 * deliberately retains them). Rejects on provider failure so the caller can
 * refuse to clear state that still bills.
 */
export interface NumberReleaser {
	release(providerRef: string, logger?: FastifyBaseLogger): Promise<ReleaseOutcome>;
}

/** A releaser with nothing to release against — used when no provider is configured. */
export class NoopNumberReleaser implements NumberReleaser {
	async release(): Promise<ReleaseOutcome> {
		return 'skipped';
	}
}

/**
 * The providerRef {@link NoopChannelProvisioner} stores with its fake numbers.
 * Deliberately not any provider's fingerprint, so a dev fake is never routed,
 * shared, or released as if a provider rented it.
 */
export const NOOP_PROVIDER_REF = 'noop';

/**
 * A provisioner that hands out a deterministic fake number derived from the
 * account id (the same FNV-1a tag the agent email address uses), so development
 * and tests get a stable, unique `+1555…` number without a provider — and
 * re-enabling returns the same one.
 */
export class NoopChannelProvisioner implements ChannelProvisioner {
	async provision(input: ProvisionInput): Promise<ProvisionedIdentifier> {
		if (input.existing.address !== '') {
			return input.existing;
		}
		// 7 subscriber digits from the account's hex tag → +1 555 XXX XXXX.
		const subscriber = (Number.parseInt(agentEmailTag(input.accountId), 16) % 10_000_000)
			.toString()
			.padStart(7, '0');
		return { address: `+1555${subscriber}`, providerRef: NOOP_PROVIDER_REF };
	}
}
