import { faker } from '@faker-js/faker';
import type { Account, AccountId } from '@rivus/core';
import { connectMongoose, disconnectMongoose } from './db/mongoose';
import {
	MongoAccountRepository,
	MongoCustomerRepository,
	MongoFaqRepository,
} from './repositories/mongo';
import type { AccountRepository, CustomerRepository, FaqRepository } from './repositories/types';
import {
	generateCustomers,
	parseSeedArgs,
	pickFaqSeeds,
	SEED_CUSTOMER_MAX,
	SEED_CUSTOMER_MIN,
	SEED_USAGE,
	SeedArgError,
	type SeedOptions,
	selectNewFaqs,
} from './seed-data';

/**
 * Seed a single account with demo data: 20–30 CRM customers and a library of
 * common business FAQs. It points at an account by slug or id and writes through
 * the same Mongo repositories and Zod schemas the API uses, so seeded rows are
 * identical to ones created over HTTP.
 *
 * Usage (see {@link SEED_USAGE} or run with `--help`):
 *   pnpm --filter @rivus/api seed --account <slug-or-id> [--customers n] [--faqs n]
 *
 * The pure data generation, CLI parsing, and de-duplication live in `seed-data.ts`
 * (and are unit-tested); this module is just the database wrapper.
 */

const DEFAULT_MONGODB_URI = 'mongodb://localhost:27017/rivus?replicaSet=rs0&directConnection=true';

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

async function seedCustomers(
	customers: CustomerRepository,
	account: Account,
	options: SeedOptions,
): Promise<number> {
	const count =
		options.customers ?? faker.number.int({ min: SEED_CUSTOMER_MIN, max: SEED_CUSTOMER_MAX });
	if (count === 0) {
		write('Customers: skipped (count 0).');
		return 0;
	}
	const batch = generateCustomers(count);
	if (options.dryRun) {
		write(`Customers: would create ${batch.length} (dry run).`);
		return 0;
	}
	for (const input of batch) {
		await customers.create(account.id, input);
	}
	write(`Customers: created ${batch.length}.`);
	return batch.length;
}

async function seedFaqs(
	faqs: FaqRepository,
	account: Account,
	options: SeedOptions,
): Promise<number> {
	const candidates = pickFaqSeeds(options.faqs);
	if (candidates.length === 0) {
		write('FAQs: skipped (count 0).');
		return 0;
	}
	const existing = await collectExistingFaqQuestions(faqs, account.id);
	const { toCreate, skipped } = selectNewFaqs(candidates, existing);
	const skipNote = skipped.length > 0 ? ` (${skipped.length} already present, skipped)` : '';
	if (options.dryRun) {
		write(`FAQs: would create ${toCreate.length}${skipNote} (dry run).`);
		return 0;
	}
	for (const input of toCreate) {
		await faqs.create(account.id, input);
	}
	write(`FAQs: created ${toCreate.length}${skipNote}.`);
	return toCreate.length;
}

async function run(options: SeedOptions): Promise<void> {
	if (options.seed !== undefined) {
		faker.seed(options.seed);
	}
	const uri = process.env.MONGODB_URI ?? DEFAULT_MONGODB_URI;
	await connectMongoose(uri);
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
		await seedCustomers(new MongoCustomerRepository(), account, options);
		await seedFaqs(new MongoFaqRepository(), account, options);
		write(options.dryRun ? 'Dry run complete — nothing was written.' : 'Seeding complete.');
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
