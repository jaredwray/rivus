import { parseArgs } from 'node:util';
import { faker } from '@faker-js/faker';
import {
	type CreateCustomerInput,
	type CreateFaqInput,
	type CreateJobInput,
	createCustomerSchema,
	createFaqSchema,
	createJobSchema,
	type JobStatus,
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

/** Default number of FAQs to seed (the full curated set) when not overridden. */
export const SEED_FAQ_DEFAULT = FAQ_SEEDS.length;

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

// --- Appointments (scheduled jobs) -------------------------------------------

// In Rivus an appointment is a scheduled **Job**: a booking with a customer, an
// assigned team member, a start time, a duration, and an estimated value. The
// seeder creates these so a demo account has a populated calendar.

/** Default appointment count is a value in this (inclusive) range when not overridden. */
export const SEED_APPOINTMENT_MIN = 12;
export const SEED_APPOINTMENT_MAX = 24;

/** Service titles a small business might book, sampled when no AI title is supplied. */
const APPOINTMENT_TITLES = [
	'Initial consultation',
	'On-site estimate',
	'Standard service visit',
	'Annual maintenance',
	'Follow-up appointment',
	'Installation',
	'Repair call',
	'Inspection',
	'System tune-up',
	'Emergency call-out',
	'Project kickoff',
	'Final walkthrough',
] as const;

/** Short scheduling notes, sampled for roughly half of seeded appointments. */
const APPOINTMENT_NOTES = [
	'Customer requested the morning slot.',
	'Bring replacement parts.',
	'Gate code provided; call on arrival.',
	'Quoted over the phone last week.',
	'Repeat customer — knows the routine.',
	'Park in the rear lot.',
	'Confirm materials before heading out.',
	'Follow up with an invoice afterward.',
] as const;

/** Common appointment lengths, in minutes. */
const APPOINTMENT_DURATIONS = [30, 60, 90, 120] as const;

// Status skews with when the appointment falls (see {@link appointmentStatus}).
const PAST_STATUSES: readonly JobStatus[] = [
	'completed',
	'completed',
	'completed',
	'canceled',
	'in_progress',
];
const TODAY_STATUSES: readonly JobStatus[] = ['in_progress', 'confirmed', 'completed'];
const FUTURE_STATUSES: readonly JobStatus[] = ['scheduled', 'scheduled', 'confirmed'];

/** Creative fields an AI generator can supply per appointment; the rest is assembled. */
export interface AppointmentCreative {
	title?: string;
	notes?: string;
	durationMinutes?: number;
	/** Estimated value in integer cents. */
	estimatedValue?: number;
}

export interface BuildAppointmentOptions {
	/** Linked customer id, or '' for none. */
	customerId: string;
	/** Assigned team member (user) id, or '' for unassigned. */
	assignedUserId: string;
	/** Anchor for the scheduled time; appointments spread before and after it. */
	referenceDate: Date;
	/** Creative overrides (e.g. from an AI generator); missing fields use faker. */
	overrides?: AppointmentCreative;
}

/** Clamp a duration to the schema's 1..1440-minute window as a whole number. */
function clampDuration(minutes: number): number {
	if (!Number.isFinite(minutes)) {
		return 60;
	}
	return Math.min(1440, Math.max(1, Math.trunc(minutes)));
}

/**
 * Pick a status that fits when the appointment falls: past visits skew to
 * completed (some canceled / still in progress), today is live, and future
 * bookings are scheduled or confirmed — so the seeded calendar reads realistically.
 */
function appointmentStatus(dayOffset: number): JobStatus {
	if (dayOffset < 0) {
		return faker.helpers.arrayElement(PAST_STATUSES);
	}
	if (dayOffset === 0) {
		return faker.helpers.arrayElement(TODAY_STATUSES);
	}
	return faker.helpers.arrayElement(FUTURE_STATUSES);
}

/**
 * Build one appointment as a {@link CreateJobInput}, linked to the given customer
 * and team member, and validate it through {@link createJobSchema}. The scheduled
 * start lands on a business-hours half-hour within ~3 weeks either side of
 * `referenceDate`; any creative field not supplied in `overrides` is filled with
 * faker, so an AI generator can provide just titles/notes and still get a valid row.
 */
export function buildAppointment(options: BuildAppointmentOptions): CreateJobInput {
	const dayOffset = faker.number.int({ min: -21, max: 21 });
	const start = new Date(options.referenceDate);
	start.setUTCDate(start.getUTCDate() + dayOffset);
	// Business hours: 8:00am–4:30pm, on the half hour.
	start.setUTCHours(
		faker.number.int({ min: 8, max: 16 }),
		faker.helpers.arrayElement([0, 30]),
		0,
		0,
	);

	const overrides = options.overrides ?? {};
	const title = overrides.title?.trim() || faker.helpers.arrayElement(APPOINTMENT_TITLES);
	const notes =
		overrides.notes !== undefined
			? overrides.notes
			: faker.datatype.boolean({ probability: 0.5 })
				? faker.helpers.arrayElement(APPOINTMENT_NOTES)
				: '';
	const durationMinutes = clampDuration(
		overrides.durationMinutes ?? faker.helpers.arrayElement(APPOINTMENT_DURATIONS),
	);
	const estimatedValue =
		overrides.estimatedValue !== undefined
			? Math.max(0, Math.trunc(overrides.estimatedValue))
			: faker.number.int({ min: 5_000, max: 150_000 });

	return createJobSchema.parse({
		title: title.slice(0, 160),
		customerId: options.customerId,
		assignedUserId: options.assignedUserId,
		startAt: start.toISOString(),
		durationMinutes,
		status: appointmentStatus(dayOffset),
		// A job-site address; for a demo it needn't match the customer's on file.
		address: faker.datatype.boolean({ probability: 0.7 })
			? `${faker.location.streetAddress()}, ${faker.location.city()}, ${faker.location.state({
					abbreviated: true,
				})} ${faker.location.zipCode()}`
			: '',
		notes: notes.slice(0, 2000),
		estimatedValue,
	});
}

export interface GenerateAppointmentsOptions {
	count: number;
	/** Customer ids to link appointments to (round-robin); empty list ⇒ "no customer". */
	customerIds: string[];
	/** Team member (user) ids to assign (round-robin); empty list ⇒ "unassigned". */
	memberIds: string[];
	referenceDate: Date;
	/** Per-appointment creative overrides (e.g. from an AI generator). */
	overrides?: AppointmentCreative[];
}

/** Round-robin element from `ids`, or '' when the list is empty ("none"). */
function pickRoundRobin(ids: string[], index: number): string {
	return ids.length === 0 ? '' : (ids[index % ids.length] ?? '');
}

/**
 * Generate `count` validated appointments, round-robining across the available
 * customers and team members so the seeded calendar is spread across the account.
 * Seed faker beforehand (`faker.seed(n)`) for a reproducible batch.
 */
export function generateAppointments(options: GenerateAppointmentsOptions): CreateJobInput[] {
	const count = Math.max(0, options.count);
	return Array.from({ length: count }, (_unused, index) =>
		buildAppointment({
			customerId: pickRoundRobin(options.customerIds, index),
			assignedUserId: pickRoundRobin(options.memberIds, index),
			referenceDate: options.referenceDate,
			overrides: options.overrides?.[index],
		}),
	);
}

// --- CLI ---------------------------------------------------------------------

/** Validated options parsed from the seed command line. */
export interface SeedOptions {
	/** Account slug or id to seed. */
	account?: string;
	/** Number of customers to create; `undefined` means "use the default range". */
	customers?: number;
	/** Number of FAQs to create; `undefined` means "all of them". */
	faqs?: number;
	/** Number of appointments to create; `undefined` means "use the default range". */
	appointments?: number;
	/** Whether to use AI generation (when a provider key is set). `--no-ai` clears it. */
	ai: boolean;
	/** Optional faker seed for a reproducible batch. */
	seed?: number;
	/** Build and validate the data but don't write anything. */
	dryRun: boolean;
	/** Print usage and exit. */
	help: boolean;
}

/** Raised for bad CLI input so the caller can print usage and exit non-zero. */
export class SeedArgError extends Error {}

export const SEED_USAGE = `Seed an account with demo customers, FAQs, and appointments.

Data is generated with AI when a provider key is configured (OpenAI, Google,
xAI, or Anthropic — same providers as the FAQ features), tailored to the
account's business. Without a key, or with --no-ai, it falls back to built-in
faker/curated generation. Either way every row is validated against the same
schemas the API uses.

Usage:
  pnpm --filter @rivus/api seed --account <slug-or-id> [options]

Options:
  -a, --account <slug-or-id>  Account to seed (required). Accepts the account
                              slug or its id.
  -c, --customers <n>         How many customers to create.
                              Default: a random count in [${SEED_CUSTOMER_MIN}, ${SEED_CUSTOMER_MAX}].
                              Pass 0 to skip customers.
  -f, --faqs <n>              How many FAQs to create.
                              Default: ${FAQ_SEEDS.length} (the curated set). Pass 0 to skip FAQs.
  -p, --appointments <n>      How many appointments (scheduled jobs) to create.
                              Default: a random count in [${SEED_APPOINTMENT_MIN}, ${SEED_APPOINTMENT_MAX}].
                              Pass 0 to skip appointments.
      --no-ai                 Force built-in faker/curated generation even when a
                              provider key is set.
  -s, --seed <n>              Seed the random generator for a reproducible batch.
      --dry-run               Report the plan without calling AI or writing anything.
  -h, --help                  Show this help.

Environment:
  MONGODB_URI                 MongoDB connection string (defaults to the local
                              docker-compose replica set).
  OPENAI_API_KEY, …           Any one enables AI generation (see .env.example).

Examples:
  pnpm --filter @rivus/api seed --account acme-co
  pnpm --filter @rivus/api seed -a acme-co -c 25 -f 12 -p 20
  pnpm --filter @rivus/api seed -a acme-co --no-ai --seed 42
  pnpm --filter @rivus/api seed -a 665f1e... --customers 0   # FAQs + appointments only
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
		appointments?: string;
		'no-ai'?: boolean;
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
				appointments: { type: 'string', short: 'p' },
				'no-ai': { type: 'boolean', default: false },
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
		appointments: parseCountOption(values.appointments, 'appointments'),
		ai: !(values['no-ai'] ?? false),
		seed: parseCountOption(values.seed, 'seed'),
		dryRun: values['dry-run'] ?? false,
		help: values.help ?? false,
	};
}
