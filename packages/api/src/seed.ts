import { faker } from '@faker-js/faker';
import type { Account, AccountId, UserId } from '@rivus/core';
import { loadConfig } from './config';
import { connectMongoose, disconnectMongoose } from './db/mongoose';
import {
	MongoAccountRepository,
	MongoCustomerRepository,
	MongoFaqRepository,
	MongoJobRepository,
	MongoMembershipRepository,
	MongoNotificationRepository,
} from './repositories/mongo';
import type {
	AccountRepository,
	CustomerRepository,
	FaqRepository,
	JobRepository,
	NotificationRepository,
} from './repositories/types';
import {
	type BusinessContext,
	createSeedGenerator,
	DeterministicSeedGenerator,
	type SeedGenerator,
} from './seed-ai';
import {
	generateNotifications,
	parseSeedArgs,
	SEED_APPOINTMENT_MAX,
	SEED_APPOINTMENT_MIN,
	SEED_CUSTOMER_MAX,
	SEED_CUSTOMER_MIN,
	SEED_FAQ_DEFAULT,
	SEED_NOTIFICATION_MAX,
	SEED_NOTIFICATION_MIN,
	SEED_USAGE,
	SeedArgError,
	type SeedOptions,
	selectNewFaqs,
} from './seed-data';

/**
 * Seed a single account with demo data: CRM customers, a business-FAQ knowledge
 * base, and scheduled appointments (Jobs). It points at an account by slug or id
 * and writes through the same Mongo repositories and Zod schemas the API uses, so
 * seeded rows are identical to ones created over HTTP.
 *
 * Data is generated with AI when a provider key is configured (tailored to the
 * account's business), and falls back to deterministic faker/curated generation
 * otherwise or with `--no-ai`.
 *
 * Usage (see {@link SEED_USAGE} or run with `--help`):
 *   pnpm --filter @rivus/api seed --account <slug-or-id> [--customers n] [--faqs n] [--appointments n]
 *
 * The pure data generation, CLI parsing, de-duplication, and AI layer live in
 * `seed-data.ts` / `seed-ai.ts` (and are unit-tested); this module is just the
 * database wrapper.
 */

/** Resolve an account by id first (when the identifier is a valid id), then by slug. */
async function resolveAccount(
	accounts: AccountRepository,
	identifier: string,
): Promise<Account | null> {
	// `findById` returns null for a non-id string, so this naturally falls through
	// to a slug lookup for the common `--account my-business` case.
	const byId = await accounts.findById(identifier as AccountId);
	if (byId) {
		return byId;
	}
	return accounts.findBySlug(identifier);
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

function write(message: string): void {
	process.stdout.write(`${message}\n`);
}

/** Create `count` customers via the generator; returns the new customers' ids. */
async function seedCustomers(
	customers: CustomerRepository,
	generator: SeedGenerator,
	account: Account,
	context: BusinessContext,
	count: number,
): Promise<string[]> {
	if (count === 0) {
		write('Customers: skipped (count 0).');
		return [];
	}
	const inputs = await generator.generateCustomers(count, context);
	const ids: string[] = [];
	for (const input of inputs) {
		const created = await customers.create(account.id, input);
		ids.push(created.id);
	}
	write(`Customers: created ${ids.length}.`);
	return ids;
}

/** Create up to `count` FAQs, skipping any whose question already exists. */
async function seedFaqs(
	faqs: FaqRepository,
	generator: SeedGenerator,
	account: Account,
	context: BusinessContext,
	count: number,
): Promise<void> {
	if (count === 0) {
		write('FAQs: skipped (count 0).');
		return;
	}
	const candidates = await generator.generateFaqs(count, context);
	const existing = await collectExistingFaqQuestions(faqs, account.id);
	const { toCreate, skipped } = selectNewFaqs(candidates, existing);
	const skipNote = skipped.length > 0 ? ` (${skipped.length} already present, skipped)` : '';
	for (const input of toCreate) {
		await faqs.create(account.id, input);
	}
	write(`FAQs: created ${toCreate.length}${skipNote}.`);
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
): Promise<void> {
	if (count === 0) {
		write('Appointments: skipped (count 0).');
		return;
	}
	const inputs = await generator.generateAppointments(
		{ count, customerIds, memberIds, referenceDate: new Date() },
		context,
	);
	for (const input of inputs) {
		await jobs.create(account.id, input);
	}
	const linkNote = customerIds.length === 0 ? ' (no customers to link)' : '';
	write(`Appointments: created ${inputs.length}${linkNote}.`);
}

/**
 * Create `countPerMember` demo notifications for each of the account's members so
 * their bell looks lived-in, then mark the older half read so the unread badge
 * shows a realistic subset rather than every row glowing.
 */
async function seedNotifications(
	notifications: NotificationRepository,
	account: Account,
	memberIds: string[],
	countPerMember: number,
): Promise<void> {
	if (countPerMember === 0) {
		write('Notifications: skipped (count 0).');
		return;
	}
	if (memberIds.length === 0) {
		write('Notifications: skipped (no members to notify).');
		return;
	}
	let created = 0;
	for (const memberId of memberIds) {
		const ids = [];
		for (const input of generateNotifications(countPerMember)) {
			const notification = await notifications.create(account.id, memberId as UserId, input);
			ids.push(notification.id);
		}
		// The list is newest-first, so marking the first (oldest) half read leaves the
		// most recent notifications unread — the natural "haven't seen these yet" state.
		const readCount = Math.floor(ids.length / 2);
		for (let i = 0; i < readCount; i += 1) {
			const id = ids[i];
			if (id) {
				await notifications.markRead(account.id, memberId as UserId, id);
			}
		}
		created += ids.length;
	}
	write(`Notifications: created ${created} across ${memberIds.length} member(s).`);
}

async function run(options: SeedOptions): Promise<void> {
	if (options.seed !== undefined) {
		faker.seed(options.seed);
	}
	// Force a non-production env so loading config never trips the prod-only secret
	// checks (mirrors openapi.ts); we only need the Mongo URI and AI provider keys.
	const config = loadConfig({ ...process.env, NODE_ENV: 'development' });
	const generator: SeedGenerator = options.ai
		? createSeedGenerator(config)
		: new DeterministicSeedGenerator();

	// Resolve the planned counts up front so a dry run can report them without work.
	const customerCount =
		options.customers ?? faker.number.int({ min: SEED_CUSTOMER_MIN, max: SEED_CUSTOMER_MAX });
	const faqCount = options.faqs ?? SEED_FAQ_DEFAULT;
	const appointmentCount =
		options.appointments ??
		faker.number.int({ min: SEED_APPOINTMENT_MIN, max: SEED_APPOINTMENT_MAX });
	const notificationCount =
		options.notifications ??
		faker.number.int({ min: SEED_NOTIFICATION_MIN, max: SEED_NOTIFICATION_MAX });

	await connectMongoose(config.MONGODB_URI);
	try {
		const accounts = new MongoAccountRepository();
		// `options.account` is guaranteed present by `main` before we get here.
		const identifier = options.account as string;
		const account = await resolveAccount(accounts, identifier);
		if (!account) {
			throw new SeedArgError(
				`No account found for "${identifier}". Pass an existing account slug or id.`,
			);
		}
		if (account.status === 'canceled') {
			write(`Warning: account "${account.slug}" is canceled — seeding it anyway.`);
		}
		write(
			`Seeding account "${account.name}" (slug: ${account.slug}, id: ${account.id})` +
				`${options.dryRun ? ' [dry run]' : ''}`,
		);
		// Make the active mode explicit — especially when AI was requested but no key
		// is set, so the deterministic fallback isn't a silent surprise.
		if (options.ai && !generator.usesAi) {
			write('Generation: deterministic — no AI provider key set (see .env.example).');
		} else {
			write(
				`Generation: ${generator.usesAi ? 'AI (OpenAI/Google/xAI/Anthropic, with faker fallback)' : 'deterministic (faker/curated)'}.`,
			);
		}

		if (options.dryRun) {
			write(`Customers: would create ${customerCount}.`);
			write(`FAQs: would create up to ${faqCount} (new questions only).`);
			write(`Appointments: would create ${appointmentCount}.`);
			write(`Notifications: would create ${notificationCount} per member.`);
			write('Dry run complete — no AI calls, nothing written.');
			return;
		}

		const context: BusinessContext = {
			businessName: account.name,
			website: account.website,
			address: account.address,
		};
		const customers = new MongoCustomerRepository();
		const memberIds = (await new MongoMembershipRepository().listByAccount(account.id)).map(
			(membership) => membership.userId,
		);

		const newCustomerIds = await seedCustomers(
			customers,
			generator,
			account,
			context,
			customerCount,
		);
		await seedFaqs(new MongoFaqRepository(), generator, account, context, faqCount);

		// Link appointments to the customers we just created; if none were (e.g.
		// `--customers 0`), fall back to the account's existing customers.
		let customerIds = newCustomerIds;
		if (customerIds.length === 0 && appointmentCount > 0) {
			const existing = await customers.list({ accountId: account.id, page: 1, pageSize: 100 });
			customerIds = existing.customers.map((customer) => customer.id);
		}
		await seedAppointments(
			new MongoJobRepository(),
			generator,
			account,
			context,
			appointmentCount,
			customerIds,
			memberIds,
		);
		await seedNotifications(
			new MongoNotificationRepository(),
			account,
			memberIds,
			notificationCount,
		);

		write('Seeding complete.');
	} finally {
		await disconnectMongoose();
	}
}

async function main(): Promise<void> {
	let options: SeedOptions;
	try {
		options = parseSeedArgs(process.argv.slice(2));
	} catch (error) {
		// Bad flags: show the reason and usage, then exit non-zero.
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n`);
		process.stderr.write(SEED_USAGE);
		process.exitCode = 1;
		return;
	}
	if (options.help) {
		process.stdout.write(SEED_USAGE);
		return;
	}
	if (!options.account) {
		process.stderr.write('Missing required --account <slug-or-id>.\n\n');
		process.stderr.write(SEED_USAGE);
		process.exitCode = 1;
		return;
	}
	await run(options);
}

main().catch(async (error) => {
	// A SeedArgError is a user-input problem (e.g. the account doesn't exist), so
	// render just the message; anything else is unexpected and gets a full stack.
	if (error instanceof SeedArgError) {
		process.stderr.write(`${error.message}\n`);
	} else {
		console.error(error);
	}
	// Best-effort disconnect so a failure mid-run doesn't leave a dangling
	// connection (and the process able to exit cleanly).
	await disconnectMongoose().catch(() => {});
	process.exit(1);
});
