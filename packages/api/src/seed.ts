import { faker } from '@faker-js/faker';
import type { Account, AccountId } from '@rivus/core';
import { loadConfig } from './config';
import { connectMongoose, disconnectMongoose } from './db/mongoose';
import {
	MongoAccountRepository,
	MongoConversationRepository,
	MongoCustomerRepository,
	MongoFaqRepository,
	MongoJobRepository,
	MongoMembershipRepository,
	MongoNotificationRepository,
} from './repositories/mongo';
import type { AccountRepository } from './repositories/types';
import { createSeedGenerator, DeterministicSeedGenerator, type SeedGenerator } from './seed-ai';
import { parseSeedArgs, SEED_USAGE, SeedArgError, type SeedOptions } from './seed-data';
import { resolveSeedCounts, type SeedAccountCounts, seedAccountData } from './services/seed';

/**
 * Seed a single account with demo data: CRM customers, a business-FAQ knowledge
 * base, scheduled appointments (Jobs), per-member notifications, and inbox
 * conversations. It points at an account by slug or id and writes through the
 * Mongo repositories, so seeded rows are identical to ones created over HTTP.
 *
 * Data is generated with AI when a provider key is configured (tailored to the
 * account's business), and falls back to deterministic faker/curated generation
 * otherwise or with `--no-ai`.
 *
 * Usage (see {@link SEED_USAGE} or run with `--help`):
 *   pnpm --filter @rivus/api seed --account <slug-or-id> [--customers n] [--faqs n] [--appointments n]
 *
 * The pure data generation, CLI parsing, de-duplication, and AI layer live in
 * `seed-data.ts` / `seed-ai.ts`, and the repository orchestration lives in
 * `services/seed.ts` (which the development-only seed route reuses). This module
 * is just the database wrapper around them.
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

function write(message: string): void {
	process.stdout.write(`${message}\n`);
}

/** Map the CLI options onto the seeder's per-entity count shape. */
function countsFrom(options: SeedOptions): SeedAccountCounts {
	return {
		customers: options.customers,
		faqs: options.faqs,
		appointments: options.appointments,
		notifications: options.notifications,
		conversations: options.conversations,
	};
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
			const planned = resolveSeedCounts(countsFrom(options));
			write(`Customers: would create ${planned.customers}.`);
			write(`FAQs: would create up to ${planned.faqs} (new questions only).`);
			write(`Appointments: would create ${planned.appointments}.`);
			write(`Notifications: would create ${planned.notifications} per member.`);
			write(`Conversations: would create ${planned.conversations}.`);
			write('Dry run complete — no AI calls, nothing written.');
			return;
		}

		await seedAccountData(
			{
				customers: new MongoCustomerRepository(),
				faqs: new MongoFaqRepository(),
				jobs: new MongoJobRepository(),
				notifications: new MongoNotificationRepository(),
				conversations: new MongoConversationRepository(),
				memberships: new MongoMembershipRepository(),
			},
			generator,
			account,
			countsFrom(options),
			{ log: write },
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
