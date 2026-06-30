import { faker } from '@faker-js/faker';
import type { Account, AccountId, UserId } from '@rivus/core';
import type {
	ConversationRepository,
	CustomerRepository,
	FaqRepository,
	JobRepository,
	MembershipRepository,
	NotificationRepository,
} from '../repositories/types';
import type { BusinessContext, SeedGenerator } from '../seed-ai';
import {
	type ConversationContact,
	generateConversations,
	generateNotifications,
	SEED_APPOINTMENT_MAX,
	SEED_APPOINTMENT_MIN,
	SEED_CONVERSATION_MAX,
	SEED_CONVERSATION_MIN,
	SEED_CUSTOMER_MAX,
	SEED_CUSTOMER_MIN,
	SEED_FAQ_DEFAULT,
	SEED_NOTIFICATION_MAX,
	SEED_NOTIFICATION_MIN,
	selectNewFaqs,
} from '../seed-data';

/**
 * The account seeder, expressed against the repository interfaces so it runs
 * over either the Mongo repositories (the `seed` CLI) or the in-memory ones (the
 * development-only `POST /v1/admin/seed` route and its tests). It writes through
 * the same repositories and Zod schemas the API uses, so seeded rows are
 * identical to ones created over HTTP.
 *
 * The data itself is produced by an injected {@link SeedGenerator} — AI-tailored
 * when a provider key is configured, deterministic faker/curated otherwise — and
 * the pure generators live in `seed-data.ts` / `seed-ai.ts`. This module is just
 * the orchestration: resolve the counts, fan out to each entity, and report what
 * was written.
 */

/** The repositories the seeder writes through (a subset of `AppDeps`). */
export interface SeedRepositories {
	customers: CustomerRepository;
	faqs: FaqRepository;
	jobs: JobRepository;
	notifications: NotificationRepository;
	conversations: ConversationRepository;
	memberships: MembershipRepository;
}

/** Per-entity counts to seed; an absent count means "use the seeder's default". */
export interface SeedAccountCounts {
	customers?: number;
	faqs?: number;
	appointments?: number;
	notifications?: number;
	conversations?: number;
}

/** The concrete counts after every absent one is filled with its default. */
export interface ResolvedSeedCounts {
	customers: number;
	faqs: number;
	appointments: number;
	notifications: number;
	conversations: number;
}

/** A tally of what a seeding run created, for reporting back to the caller. */
export interface SeedAccountResult {
	customers: number;
	/** FAQs newly created (excludes any whose question already existed). */
	faqs: number;
	/** FAQs skipped because the question was already present on the account. */
	faqsSkipped: number;
	appointments: number;
	notifications: number;
	conversations: number;
	/** How many account members the notifications were addressed to. */
	members: number;
	/** Which generator produced the data. */
	generation: 'ai' | 'deterministic';
}

export interface SeedAccountOptions {
	/** Optional faker seed for a reproducible batch. */
	seed?: number;
	/** Optional progress sink (the CLI passes stdout; the route passes nothing). */
	log?: (message: string) => void;
}

/**
 * Resolve each requested count to a concrete number, filling an absent count with
 * the seeder's default (the full curated FAQ set, or a random value in a small
 * range). Seed faker first (`faker.seed(n)`) for a reproducible result.
 */
export function resolveSeedCounts(counts: SeedAccountCounts): ResolvedSeedCounts {
	return {
		customers:
			counts.customers ?? faker.number.int({ min: SEED_CUSTOMER_MIN, max: SEED_CUSTOMER_MAX }),
		faqs: counts.faqs ?? SEED_FAQ_DEFAULT,
		appointments:
			counts.appointments ??
			faker.number.int({ min: SEED_APPOINTMENT_MIN, max: SEED_APPOINTMENT_MAX }),
		notifications:
			counts.notifications ??
			faker.number.int({ min: SEED_NOTIFICATION_MIN, max: SEED_NOTIFICATION_MAX }),
		conversations:
			counts.conversations ??
			faker.number.int({ min: SEED_CONVERSATION_MIN, max: SEED_CONVERSATION_MAX }),
	};
}

/** Gather every existing FAQ question for an account, paging through the repository. */
async function collectExistingFaqQuestions(
	faqs: FaqRepository,
	accountId: AccountId,
): Promise<string[]> {
	const pageSize = 100;
	const questions: string[] = [];
	let page = 1;
	// Page until we've collected `total`; the generous guard stops a runaway loop
	// if the count and the returned rows ever disagree.
	for (let guard = 0; guard < 1000; guard += 1) {
		const { faqs: batch, total } = await faqs.list({ accountId, page, pageSize });
		for (const faq of batch) {
			questions.push(faq.question);
		}
		if (batch.length === 0 || questions.length >= total) {
			break;
		}
		page += 1;
	}
	return questions;
}

/** Create `count` customers via the generator; returns the new customers' ids. */
async function seedCustomers(
	customers: CustomerRepository,
	generator: SeedGenerator,
	account: Account,
	context: BusinessContext,
	count: number,
	log: (message: string) => void,
): Promise<string[]> {
	if (count === 0) {
		log('Customers: skipped (count 0).');
		return [];
	}
	const inputs = await generator.generateCustomers(count, context);
	const ids: string[] = [];
	for (const input of inputs) {
		const created = await customers.create(account.id, input);
		ids.push(created.id);
	}
	log(`Customers: created ${ids.length}.`);
	return ids;
}

/** Create up to `count` FAQs, skipping any whose question already exists. */
async function seedFaqs(
	faqs: FaqRepository,
	generator: SeedGenerator,
	account: Account,
	context: BusinessContext,
	count: number,
	log: (message: string) => void,
): Promise<{ created: number; skipped: number }> {
	if (count === 0) {
		log('FAQs: skipped (count 0).');
		return { created: 0, skipped: 0 };
	}
	const candidates = await generator.generateFaqs(count, context);
	const existing = await collectExistingFaqQuestions(faqs, account.id);
	const { toCreate, skipped } = selectNewFaqs(candidates, existing);
	const skipNote = skipped.length > 0 ? ` (${skipped.length} already present, skipped)` : '';
	for (const input of toCreate) {
		await faqs.create(account.id, input);
	}
	log(`FAQs: created ${toCreate.length}${skipNote}.`);
	return { created: toCreate.length, skipped: skipped.length };
}

/** Create `count` appointments (Jobs) linked to the given customers and members. */
async function seedAppointments(
	jobs: JobRepository,
	generator: SeedGenerator,
	account: Account,
	context: BusinessContext,
	count: number,
	customerIds: string[],
	memberIds: string[],
	log: (message: string) => void,
): Promise<number> {
	if (count === 0) {
		log('Appointments: skipped (count 0).');
		return 0;
	}
	const inputs = await generator.generateAppointments(
		{ count, customerIds, memberIds, referenceDate: new Date() },
		context,
	);
	for (const input of inputs) {
		await jobs.create(account.id, input);
	}
	const linkNote = customerIds.length === 0 ? ' (no customers to link)' : '';
	log(`Appointments: created ${inputs.length}${linkNote}.`);
	return inputs.length;
}

/**
 * Create `countPerMember` demo notifications for each of the account's members so
 * their bell looks lived-in, then mark the older half read so the unread badge
 * shows a realistic subset rather than every row glowing. Returns the total created.
 */
async function seedNotifications(
	notifications: NotificationRepository,
	account: Account,
	memberIds: UserId[],
	countPerMember: number,
	log: (message: string) => void,
): Promise<number> {
	if (countPerMember === 0) {
		log('Notifications: skipped (count 0).');
		return 0;
	}
	if (memberIds.length === 0) {
		log('Notifications: skipped (no members to notify).');
		return 0;
	}
	let created = 0;
	for (const memberId of memberIds) {
		const ids = [];
		for (const input of generateNotifications(countPerMember)) {
			const notification = await notifications.create(account.id, memberId, input);
			ids.push(notification.id);
		}
		// The list is newest-first, so marking the first (oldest) half read leaves the
		// most recent notifications unread — the natural "haven't seen these yet" state.
		const readCount = Math.floor(ids.length / 2);
		for (let i = 0; i < readCount; i += 1) {
			const id = ids[i];
			if (id) {
				await notifications.markRead(account.id, memberId, id);
			}
		}
		created += ids.length;
	}
	log(`Notifications: created ${created} across ${memberIds.length} member(s).`);
	return created;
}

/**
 * Create `count` inbox conversations linked to the account's customers, replaying
 * each scripted message through the repository (and setting the review state for
 * the flagged thread) so the seeded inbox is identical to one built over HTTP.
 * Returns the number of conversations created.
 */
async function seedConversations(
	conversations: ConversationRepository,
	account: Account,
	contacts: ConversationContact[],
	count: number,
	log: (message: string) => void,
): Promise<number> {
	if (count === 0) {
		log('Conversations: skipped (count 0).');
		return 0;
	}
	const seeds = generateConversations(count, contacts);
	for (const seed of seeds) {
		const created = await conversations.create(account.id, seed.conversation);
		for (const message of seed.messages) {
			await conversations.addMessage(account.id, created.id, message);
		}
		if (seed.review) {
			await conversations.setReviewState(account.id, created.id, {
				status: 'needs_attention',
				pendingReply: seed.review.pendingReply,
				flagReason: seed.review.flagReason,
			});
		}
	}
	const linkNote = contacts.length === 0 ? ' (no customers to link)' : '';
	log(`Conversations: created ${seeds.length}${linkNote}.`);
	return seeds.length;
}

/**
 * Seed one account with demo data: CRM customers, a business-FAQ knowledge base,
 * scheduled appointments (Jobs), per-member notifications, and inbox
 * conversations. Each entity links to the ones before it (appointments and
 * conversations to the seeded customers; notifications to the account's members),
 * so the result reads like a real, lived-in account.
 *
 * Returns a tally of what was written. Pass `options.log` to stream progress
 * (the CLI does); the route omits it and uses the returned summary instead.
 */
export async function seedAccountData(
	repos: SeedRepositories,
	generator: SeedGenerator,
	account: Account,
	counts: SeedAccountCounts,
	options: SeedAccountOptions = {},
): Promise<SeedAccountResult> {
	const log = options.log ?? (() => {});
	if (options.seed !== undefined) {
		faker.seed(options.seed);
	}
	const resolved = resolveSeedCounts(counts);

	const context: BusinessContext = {
		businessName: account.name,
		website: account.website,
		address: account.address,
	};
	const memberIds = (await repos.memberships.listByAccount(account.id)).map(
		(membership) => membership.userId,
	);

	const newCustomerIds = await seedCustomers(
		repos.customers,
		generator,
		account,
		context,
		resolved.customers,
		log,
	);
	const faqResult = await seedFaqs(repos.faqs, generator, account, context, resolved.faqs, log);

	// Link appointments to the customers we just created; if none were (e.g.
	// `customers: 0`), fall back to the account's existing customers.
	let customerIds = newCustomerIds;
	if (customerIds.length === 0 && resolved.appointments > 0) {
		const existing = await repos.customers.list({ accountId: account.id, page: 1, pageSize: 100 });
		customerIds = existing.customers.map((customer) => customer.id);
	}
	const appointments = await seedAppointments(
		repos.jobs,
		generator,
		account,
		context,
		resolved.appointments,
		customerIds,
		memberIds,
		log,
	);
	const notifications = await seedNotifications(
		repos.notifications,
		account,
		memberIds,
		resolved.notifications,
		log,
	);

	// Link conversations to the account's customers (the ones just seeded, or the
	// existing roster when customers were skipped) so each thread has a real contact.
	let contacts: ConversationContact[] = [];
	if (resolved.conversations > 0) {
		const roster = await repos.customers.list({ accountId: account.id, page: 1, pageSize: 100 });
		contacts = roster.customers.map((customer) => ({
			customerId: customer.id,
			name: customer.name,
			phone: customer.phone,
		}));
	}
	const conversations = await seedConversations(
		repos.conversations,
		account,
		contacts,
		resolved.conversations,
		log,
	);

	return {
		customers: newCustomerIds.length,
		faqs: faqResult.created,
		faqsSkipped: faqResult.skipped,
		appointments,
		notifications,
		conversations,
		members: memberIds.length,
		generation: generator.usesAi ? 'ai' : 'deterministic',
	};
}
