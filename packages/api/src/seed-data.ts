import { parseArgs } from 'node:util';
import { faker } from '@faker-js/faker';
import {
	type CreateCustomerInput,
	type CreateFaqInput,
	createCustomerSchema,
	createFaqSchema,
} from '@rivus/core';

/**
 * Pure, hermetic building blocks for the account seeder (`seed.ts`). Everything
 * here is free of database or process I/O so it can be unit-tested directly:
 * `seed.ts` is the thin Mongo wrapper that calls into these helpers.
 */

// --- Customers ---------------------------------------------------------------

/** Default customer count is a value in this (inclusive) range when not overridden. */
export const SEED_CUSTOMER_MIN = 20;
export const SEED_CUSTOMER_MAX = 30;

/**
 * A handful of realistic CRM notes. faker's `lorem` is Latin filler, which reads
 * oddly on a customer record, so we sample from these instead for the ~40% of
 * seeded customers that carry a note.
 */
const CUSTOMER_NOTE_SNIPPETS = [
	'Prefers email over phone calls.',
	'Long-time customer — always pays on time.',
	'Referred by an existing customer.',
	'Interested in upgrading their plan next quarter.',
	'Asked for a follow-up about their latest invoice.',
	'VIP account — route to a senior rep.',
	'Had a billing question last month; resolved.',
	'Prefers morning appointments.',
	'Net-30 terms agreed for larger orders.',
	'Wants to be notified about seasonal promotions.',
] as const;

/**
 * Build one synthetic customer and validate it through {@link createCustomerSchema}
 * — the very schema the API applies — so seeded rows are indistinguishable from
 * ones created through `POST /v1/customers` (defaults applied, lengths bounded,
 * money kept to non-negative integer cents). The phone is assembled from digits
 * rather than `faker.phone.number()` so its format and length are predictable.
 */
function buildCustomer(): CreateCustomerInput {
	const firstName = faker.person.firstName();
	const lastName = faker.person.lastName();
	const lifetimeValue = faker.number.int({ min: 0, max: 2_500_000 });
	// Most customers are square; a minority carry an outstanding balance that never
	// exceeds what they've spent.
	const balance = faker.datatype.boolean({ probability: 0.3 })
		? faker.number.int({ min: 0, max: Math.min(lifetimeValue, 150_000) })
		: 0;
	return createCustomerSchema.parse({
		name: `${firstName} ${lastName}`,
		email: faker.internet.email({ firstName, lastName }).toLowerCase(),
		phone: `(${faker.string.numeric(3)}) ${faker.string.numeric(3)}-${faker.string.numeric(4)}`,
		address: `${faker.location.streetAddress()}, ${faker.location.city()}, ${faker.location.state({
			abbreviated: true,
		})} ${faker.location.zipCode()}`,
		lifetimeValue,
		balance,
		notes: faker.datatype.boolean({ probability: 0.4 })
			? faker.helpers.arrayElement(CUSTOMER_NOTE_SNIPPETS)
			: '',
	});
}

/**
 * Generate `count` validated customers. Seed faker beforehand
 * (`faker.seed(n)`) for a reproducible batch.
 */
export function generateCustomers(count: number): CreateCustomerInput[] {
	return Array.from({ length: Math.max(0, count) }, buildCustomer);
}

// --- FAQs --------------------------------------------------------------------

/**
 * A library of common small-business FAQs, generic enough to suit any account.
 * There are comfortably more than ten, spread across the categories a typical
 * knowledge base uses, so the default seed satisfies the "10+ FAQs" goal.
 */
export const FAQ_SEEDS: ReadonlyArray<{
	question: string;
	answer: string;
	category: string;
}> = [
	{
		question: 'What are your business hours?',
		answer:
			"We're open Monday through Friday from 9:00 AM to 6:00 PM and Saturday from 10:00 AM to 4:00 PM. We're closed on Sundays and major public holidays. You can email us anytime and we'll reply on the next business day.",
		category: 'General',
	},
	{
		question: 'Where are you located and which areas do you serve?',
		answer:
			"Our main office is downtown, and we serve customers throughout the surrounding metro area. If you're outside our standard service area, get in touch — we can often arrange remote service or make a special accommodation.",
		category: 'General',
	},
	{
		question: 'How much do your services cost?',
		answer:
			'Pricing depends on the scope of the work, so we put together a detailed quote before anything begins. Tell us what you need and we will send a transparent, itemized estimate with no hidden fees.',
		category: 'Pricing',
	},
	{
		question: 'Do you offer discounts or promotions?',
		answer:
			'Yes. We run seasonal promotions and offer discounts for first-time customers, referrals, and recurring service plans. Ask us about current offers when you request a quote.',
		category: 'Pricing',
	},
	{
		question: 'What payment methods do you accept?',
		answer:
			'We accept all major credit and debit cards, bank transfers, and popular digital wallets. For larger projects we can also arrange invoicing with net payment terms.',
		category: 'Billing',
	},
	{
		question: 'When will I be charged?',
		answer:
			"For most services, payment is due once the work is complete and you're satisfied. Larger projects may require a deposit up front, which we always agree with you in advance.",
		category: 'Billing',
	},
	{
		question: 'How do I book an appointment?',
		answer:
			"You can book online through our website, give us a call, or send us a message. We'll confirm your appointment by email and send a reminder before your scheduled time.",
		category: 'Scheduling',
	},
	{
		question: 'Can I reschedule or cancel my appointment?',
		answer:
			'Absolutely. You can reschedule or cancel up to 24 hours before your appointment at no charge. For changes inside 24 hours a small fee may apply.',
		category: 'Scheduling',
	},
	{
		question: 'How long does shipping take and what does it cost?',
		answer:
			'Standard orders ship within 1–2 business days and usually arrive in 3–5 business days. Shipping is free on orders over $50; otherwise a flat rate is shown at checkout. Expedited options are available.',
		category: 'Shipping',
	},
	{
		question: 'What is your return and refund policy?',
		answer:
			"If you're not happy with a purchase, you can return most items within 30 days for a full refund or exchange. Items should be unused and in their original packaging. Contact us to start a return and we'll guide you through it.",
		category: 'Returns',
	},
	{
		question: 'How do I contact customer support?',
		answer:
			'Our support team is available by email, phone, and live chat during business hours. We aim to respond to every message within one business day, and we prioritize urgent issues.',
		category: 'Support',
	},
	{
		question: 'Do you offer a warranty or guarantee?',
		answer:
			"Yes. We stand behind our work with a satisfaction guarantee, and many of our products and services include a warranty. We'll walk you through the coverage that applies to your purchase.",
		category: 'Support',
	},
	{
		question: 'How do I update my account information?',
		answer:
			'Sign in and open your profile settings to update your contact details, address, or preferences. If you would rather we make the change for you, just ask our support team.',
		category: 'Account',
	},
	{
		question: 'How do you protect my personal information?',
		answer:
			'We take privacy seriously. Your information is stored securely, never sold, and used only to provide and improve our services. You can request a copy of your data, or ask us to delete it, at any time.',
		category: 'Privacy',
	},
];

/**
 * Take the first `requested` curated FAQs (all of them when omitted), clamped to
 * what's available, and validate each through {@link createFaqSchema} so seeded
 * rows match API-created ones exactly.
 */
export function pickFaqSeeds(requested?: number): CreateFaqInput[] {
	const count =
		requested === undefined ? FAQ_SEEDS.length : Math.min(FAQ_SEEDS.length, Math.max(0, requested));
	return FAQ_SEEDS.slice(0, count).map((seed) => createFaqSchema.parse(seed));
}

/** Normalize a question for duplicate detection (case- and whitespace-insensitive). */
export function normalizeFaqQuestion(question: string): string {
	return question.trim().toLowerCase();
}

/**
 * Split `candidates` into the FAQs whose question isn't already present on the
 * account and those that are, so re-running the seeder doesn't create duplicate
 * FAQs. Matching is case-insensitive on the trimmed question.
 */
export function selectNewFaqs(
	candidates: CreateFaqInput[],
	existingQuestions: Iterable<string>,
): { toCreate: CreateFaqInput[]; skipped: CreateFaqInput[] } {
	const seen = new Set<string>();
	for (const question of existingQuestions) {
		seen.add(normalizeFaqQuestion(question));
	}
	const toCreate: CreateFaqInput[] = [];
	const skipped: CreateFaqInput[] = [];
	for (const candidate of candidates) {
		const key = normalizeFaqQuestion(candidate.question);
		// Guard against the curated list (or the existing set) containing the same
		// question twice: only the first occurrence in this batch is created.
		if (seen.has(key)) {
			skipped.push(candidate);
		} else {
			seen.add(key);
			toCreate.push(candidate);
		}
	}
	return { toCreate, skipped };
}

// --- CLI ---------------------------------------------------------------------

/** Validated options parsed from the seed command line. */
export interface SeedOptions {
	/** Account slug or id to seed. */
	account?: string;
	/** Number of customers to create; `undefined` means "use the default range". */
	customers?: number;
	/** Number of curated FAQs to create; `undefined` means "all of them". */
	faqs?: number;
	/** Optional faker seed for a reproducible batch. */
	seed?: number;
	/** Build and validate the data but don't write anything. */
	dryRun: boolean;
	/** Print usage and exit. */
	help: boolean;
}

/** Raised for bad CLI input so the caller can print usage and exit non-zero. */
export class SeedArgError extends Error {}

export const SEED_USAGE = `Seed an account with demo customers and a common-FAQ knowledge base.

Usage:
  pnpm --filter @rivus/api seed --account <slug-or-id> [options]

Options:
  -a, --account <slug-or-id>  Account to seed (required). Accepts the account
                              slug or its id.
  -c, --customers <n>         How many customers to create.
                              Default: a random count in [${SEED_CUSTOMER_MIN}, ${SEED_CUSTOMER_MAX}].
                              Pass 0 to skip customers.
  -f, --faqs <n>              How many curated FAQs to create (max ${FAQ_SEEDS.length}).
                              Default: all of them. Pass 0 to skip FAQs.
  -s, --seed <n>              Seed the random generator for a reproducible batch.
      --dry-run               Build and validate the data without writing it.
  -h, --help                  Show this help.

Environment:
  MONGODB_URI                 MongoDB connection string (defaults to the local
                              docker-compose replica set).

Examples:
  pnpm --filter @rivus/api seed --account acme-co
  pnpm --filter @rivus/api seed -a acme-co -c 25 -f 12
  pnpm --filter @rivus/api seed -a 665f1e... --customers 0   # FAQs only
`;

/** Parse a numeric CLI option into a non-negative integer, or throw {@link SeedArgError}. */
function parseCountOption(raw: string | undefined, flag: string): number | undefined {
	if (raw === undefined) {
		return undefined;
	}
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 0) {
		throw new SeedArgError(`--${flag} must be a non-negative integer (got "${raw}").`);
	}
	return value;
}

/**
 * Parse seed arguments (everything after the script name, i.e.
 * `process.argv.slice(2)`). Throws {@link SeedArgError} on unknown flags or
 * non-integer counts.
 */
export function parseSeedArgs(argv: string[]): SeedOptions {
	let values: {
		account?: string;
		customers?: string;
		faqs?: string;
		seed?: string;
		'dry-run'?: boolean;
		help?: boolean;
	};
	try {
		({ values } = parseArgs({
			args: argv,
			allowPositionals: false,
			options: {
				account: { type: 'string', short: 'a' },
				customers: { type: 'string', short: 'c' },
				faqs: { type: 'string', short: 'f' },
				seed: { type: 'string', short: 's' },
				'dry-run': { type: 'boolean', default: false },
				help: { type: 'boolean', short: 'h', default: false },
			},
		}));
	} catch (error) {
		throw new SeedArgError(error instanceof Error ? error.message : String(error));
	}
	return {
		account: values.account,
		customers: parseCountOption(values.customers, 'customers'),
		faqs: parseCountOption(values.faqs, 'faqs'),
		seed: parseCountOption(values.seed, 'seed'),
		dryRun: values['dry-run'] ?? false,
		help: values.help ?? false,
	};
}
