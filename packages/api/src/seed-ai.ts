import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { faker } from '@faker-js/faker';
import {
	type CreateCustomerInput,
	type CreateFaqInput,
	type CreateJobInput,
	createCustomerSchema,
	createFaqSchema,
} from '@rivus/core';
import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { Config } from './config';
import {
	type AppointmentCreative,
	generateAppointments as fakerAppointments,
	generateCustomers as fakerCustomers,
	normalizeFaqQuestion,
	pickFaqSeeds,
} from './seed-data';

/**
 * AI generation layer for the account seeder. It mirrors the knowledge-base AI
 * services (`faq-answer.ts`, `faq-similarity.ts`): build an ordered list of models
 * from whichever provider keys are set, call {@link generateObject} with a Zod
 * schema, try each model in turn, and — crucially — never throw. When no key is
 * configured, or every provider fails, generation degrades to the deterministic
 * faker/curated generators in `seed-data.ts`, so the seeder always produces a full,
 * schema-valid batch (and stays runnable offline and in tests).
 *
 * AI is used for the *creative* parts (names, business-specific FAQ and service
 * copy, notes); structural fields (money kept to integer cents, scheduled times,
 * customer/member links) are assembled and re-validated here so the model can't
 * emit an invalid row.
 */

/** What the model is told about the account, so generated data fits the business. */
export interface BusinessContext {
	businessName: string;
	website: string;
	address: string;
}

export interface GenerateAppointmentsArgs {
	count: number;
	/** Customer ids to link appointments to (round-robin). */
	customerIds: string[];
	/** Team member (user) ids to assign (round-robin). */
	memberIds: string[];
	/** Anchor for scheduled times. */
	referenceDate: Date;
}

export interface SeedGenerator {
	/** Whether this generator calls a model (false ⇒ pure faker/curated). */
	readonly usesAi: boolean;
	generateCustomers(count: number, context: BusinessContext): Promise<CreateCustomerInput[]>;
	generateFaqs(count: number, context: BusinessContext): Promise<CreateFaqInput[]>;
	generateAppointments(
		args: GenerateAppointmentsArgs,
		context: BusinessContext,
	): Promise<CreateJobInput[]>;
}

// Output-token ceilings per call. Customer/appointment lists are the longest, so
// they get the most room; the model may still return fewer than asked, in which
// case the batch is topped up deterministically.
const MAX_CUSTOMER_TOKENS = 4000;
const MAX_FAQ_TOKENS = 3000;
const MAX_APPOINTMENT_TOKENS = 3000;

/**
 * The single AI call this layer makes, narrowed to what we use. Injectable so
 * tests drive the sanitizing/fallback logic without a model or the network.
 */
export type GenerateObjectFn = <T>(options: {
	model: LanguageModel;
	schema: z.ZodType<T>;
	schemaName?: string;
	system?: string;
	prompt: string;
	maxOutputTokens?: number;
}) => Promise<{ object: T }>;

const defaultGenerateObject: GenerateObjectFn = async (options) => {
	const { object } = await generateObject({
		model: options.model,
		schema: options.schema,
		schemaName: options.schemaName,
		system: options.system,
		prompt: options.prompt,
		maxOutputTokens: options.maxOutputTokens,
	});
	return { object };
};

// --- Raw model-output schemas (lenient; sanitized before use) ----------------

const aiCustomersSchema = z.object({
	customers: z.array(
		z.object({
			name: z.string(),
			email: z.string().optional(),
			phone: z.string().optional(),
			address: z.string().optional(),
			notes: z.string().optional(),
			lifetimeValueUsd: z.number().optional(),
			balanceUsd: z.number().optional(),
		}),
	),
});

const aiFaqsSchema = z.object({
	faqs: z.array(
		z.object({
			question: z.string(),
			answer: z.string(),
			category: z.string().optional(),
		}),
	),
});

const aiAppointmentsSchema = z.object({
	appointments: z.array(
		z.object({
			title: z.string(),
			notes: z.string().optional(),
			durationMinutes: z.number().optional(),
			estimatedValueUsd: z.number().optional(),
		}),
	),
});

const CUSTOMERS_SYSTEM =
	'You generate realistic but entirely fictional CRM customers for a business demo ' +
	'account. Return a `customers` array of the requested length. Each customer has a ' +
	'realistic full name, a plausible email and US phone number, a US street address, an ' +
	'optional one-line internal note, and lifetimeValueUsd / balanceUsd as dollar amounts ' +
	'where balance never exceeds lifetime value. Make the set diverse. Never use real, ' +
	'identifiable people.';

const FAQS_SYSTEM =
	'You write a customer-facing FAQ knowledge base tailored to a specific business. ' +
	'Return a `faqs` array of the requested length. Each entry has a clear question a real ' +
	'customer of THIS business would ask, a concise helpful answer (one to four sentences), ' +
	'and a short category label (for example Pricing, Scheduling, Support). Keep answers ' +
	'accurate-sounding and safe as defaults; do not invent specific prices or legal claims.';

const APPOINTMENTS_SYSTEM =
	'You generate fictional service appointments (calendar bookings) for a business demo ' +
	'schedule. Return an `appointments` array of the requested length. Each has a short ' +
	'service title appropriate to THIS business (the kind of job it books), an optional ' +
	'one-line internal note, a typical durationMinutes (15-240), and an estimatedValueUsd in ' +
	'dollars. Do not include dates, customers, or staff names — only the service details.';

/** A short business description for the prompt. */
function businessSummary(context: BusinessContext): string {
	const parts = [`Business name: ${context.businessName || 'A small local business'}`];
	if (context.website) {
		parts.push(`Website: ${context.website}`);
	}
	if (context.address) {
		parts.push(`Location: ${context.address}`);
	}
	return parts.join('\n');
}

/** Dollars (possibly fractional) to a non-negative whole number of cents. */
function toCents(usd: unknown): number {
	const value = typeof usd === 'number' && Number.isFinite(usd) ? usd : 0;
	return Math.max(0, Math.round(value * 100));
}

/** Build a schema-valid customer from one raw AI record, or null if unusable. */
function sanitizeCustomer(raw: {
	name?: string;
	email?: string;
	phone?: string;
	address?: string;
	notes?: string;
	lifetimeValueUsd?: number;
	balanceUsd?: number;
}): CreateCustomerInput | null {
	const lifetimeValue = toCents(raw.lifetimeValueUsd);
	const candidate = {
		name: (raw.name ?? '').trim(),
		// optionalEmailSchema rejects a malformed address; fall back to a faker one so a
		// bad AI email doesn't drop the whole record.
		email: isValidEmail(raw.email) ? (raw.email ?? '') : faker.internet.email().toLowerCase(),
		phone: (raw.phone ?? '').slice(0, 40),
		address: (raw.address ?? '').slice(0, 300),
		lifetimeValue,
		// Keep balance within what they've spent so the demo data stays coherent.
		balance: Math.min(lifetimeValue, toCents(raw.balanceUsd)),
		notes: (raw.notes ?? '').slice(0, 2000),
	};
	const parsed = createCustomerSchema.safeParse(candidate);
	return parsed.success ? parsed.data : null;
}

function isValidEmail(email: string | undefined): boolean {
	return typeof email === 'string' && z.email().safeParse(email.trim()).success;
}

/** Build a schema-valid FAQ from one raw AI record, or null if unusable. */
function sanitizeFaq(raw: {
	question?: string;
	answer?: string;
	category?: string;
}): CreateFaqInput | null {
	const candidate = {
		question: (raw.question ?? '').trim().slice(0, 300),
		answer: (raw.answer ?? '').trim().slice(0, 4000),
		category: (raw.category ?? '').trim().slice(0, 80),
	};
	if (!candidate.question || !candidate.answer) {
		return null;
	}
	const parsed = createFaqSchema.safeParse(candidate);
	return parsed.success ? parsed.data : null;
}

/** Map one raw AI appointment to creative overrides for `buildAppointment`. */
function toAppointmentCreative(raw: {
	title?: string;
	notes?: string;
	durationMinutes?: number;
	estimatedValueUsd?: number;
}): AppointmentCreative {
	return {
		title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : undefined,
		notes: typeof raw.notes === 'string' ? raw.notes : undefined,
		durationMinutes: typeof raw.durationMinutes === 'number' ? raw.durationMinutes : undefined,
		estimatedValue:
			typeof raw.estimatedValueUsd === 'number' ? toCents(raw.estimatedValueUsd) : undefined,
	};
}

/** Minimal logger surface — compatible with `console` and Fastify's pino logger. */
export interface SeedAiLogger {
	warn(message: string): void;
}

/**
 * AI-backed seed generation with deterministic fallback. Tries each model in
 * order; if all fail (or return nothing usable) it falls back to the faker/curated
 * generators, so a batch is always produced.
 */
export class AiSeedGenerator implements SeedGenerator {
	readonly usesAi = true;
	private readonly models: LanguageModel[];
	private readonly generate: GenerateObjectFn;
	private readonly logger?: SeedAiLogger;

	constructor(options: {
		models: LanguageModel[];
		generate?: GenerateObjectFn;
		logger?: SeedAiLogger;
	}) {
		this.models = options.models;
		this.generate = options.generate ?? defaultGenerateObject;
		this.logger = options.logger;
	}

	/** Try each model in turn; return the first success, or null if all fail. */
	private async generateWithFallback<T>(options: {
		schema: z.ZodType<T>;
		schemaName: string;
		system: string;
		prompt: string;
		maxOutputTokens: number;
	}): Promise<T | null> {
		for (const model of this.models) {
			try {
				const { object } = await this.generate({
					model,
					schema: options.schema,
					schemaName: options.schemaName,
					system: options.system,
					prompt: options.prompt,
					maxOutputTokens: options.maxOutputTokens,
				});
				return object;
			} catch (error) {
				this.logger?.warn(
					`Seed generation: ${options.schemaName} request failed, trying next provider — ${String(error)}`,
				);
			}
		}
		return null;
	}

	async generateCustomers(count: number, context: BusinessContext): Promise<CreateCustomerInput[]> {
		if (count <= 0) {
			return [];
		}
		const result = await this.generateWithFallback({
			schema: aiCustomersSchema,
			schemaName: 'seed_customers',
			system: CUSTOMERS_SYSTEM,
			prompt: `${businessSummary(context)}\n\nGenerate ${count} customers.`,
			maxOutputTokens: MAX_CUSTOMER_TOKENS,
		});
		if (!result) {
			return fakerCustomers(count);
		}
		const valid = result.customers
			.map(sanitizeCustomer)
			.filter((customer): customer is CreateCustomerInput => customer !== null)
			.slice(0, count);
		// The model may return fewer (or all-invalid) rows; top up to `count`.
		if (valid.length < count) {
			valid.push(...fakerCustomers(count - valid.length));
		}
		return valid;
	}

	async generateFaqs(count: number, context: BusinessContext): Promise<CreateFaqInput[]> {
		if (count <= 0) {
			return [];
		}
		const result = await this.generateWithFallback({
			schema: aiFaqsSchema,
			schemaName: 'seed_faqs',
			system: FAQS_SYSTEM,
			prompt: `${businessSummary(context)}\n\nGenerate ${count} FAQs.`,
			maxOutputTokens: MAX_FAQ_TOKENS,
		});
		if (!result) {
			return pickFaqSeeds(count);
		}
		const faqs = result.faqs
			.map(sanitizeFaq)
			.filter((faq): faq is CreateFaqInput => faq !== null)
			.slice(0, count);
		// Top up from the curated set, skipping any question the AI already produced.
		if (faqs.length < count) {
			const seen = new Set(faqs.map((faq) => normalizeFaqQuestion(faq.question)));
			for (const fallback of pickFaqSeeds()) {
				if (faqs.length >= count) {
					break;
				}
				const key = normalizeFaqQuestion(fallback.question);
				if (!seen.has(key)) {
					seen.add(key);
					faqs.push(fallback);
				}
			}
		}
		return faqs;
	}

	async generateAppointments(
		args: GenerateAppointmentsArgs,
		context: BusinessContext,
	): Promise<CreateJobInput[]> {
		if (args.count <= 0) {
			return [];
		}
		const result = await this.generateWithFallback({
			schema: aiAppointmentsSchema,
			schemaName: 'seed_appointments',
			system: APPOINTMENTS_SYSTEM,
			prompt: `${businessSummary(context)}\n\nGenerate ${args.count} appointment service entries.`,
			maxOutputTokens: MAX_APPOINTMENT_TOKENS,
		});
		// Times, statuses, and customer/member links are always assembled here; the AI
		// only supplies per-appointment creative overrides (null ⇒ pure faker).
		const overrides = result ? result.appointments.map(toAppointmentCreative) : undefined;
		return fakerAppointments({
			count: args.count,
			customerIds: args.customerIds,
			memberIds: args.memberIds,
			referenceDate: args.referenceDate,
			overrides,
		});
	}
}

/** Deterministic generator: the faker/curated `seed-data.ts` generators, no AI. */
export class DeterministicSeedGenerator implements SeedGenerator {
	readonly usesAi = false;

	async generateCustomers(count: number): Promise<CreateCustomerInput[]> {
		return fakerCustomers(count);
	}

	async generateFaqs(count: number): Promise<CreateFaqInput[]> {
		return pickFaqSeeds(count);
	}

	async generateAppointments(args: GenerateAppointmentsArgs): Promise<CreateJobInput[]> {
		return fakerAppointments({
			count: args.count,
			customerIds: args.customerIds,
			memberIds: args.memberIds,
			referenceDate: args.referenceDate,
		});
	}
}

/**
 * Build the seed generator from config. Each provider whose key is set joins an
 * ordered model list — OpenAI primary, then Google, xAI, and Anthropic backups —
 * exactly like the FAQ services. With no key set, returns a
 * {@link DeterministicSeedGenerator} so the seeder runs without AI.
 */
export function createSeedGenerator(
	config: Pick<
		Config,
		| 'OPENAI_API_KEY'
		| 'OPENAI_MODEL'
		| 'GOOGLE_GENERATIVE_AI_API_KEY'
		| 'GEMINI_MODEL'
		| 'XAI_API_KEY'
		| 'XAI_MODEL'
		| 'ANTHROPIC_API_KEY'
		| 'ANTHROPIC_MODEL'
	>,
): SeedGenerator {
	const models: LanguageModel[] = [];
	if (config.OPENAI_API_KEY) {
		models.push(createOpenAI({ apiKey: config.OPENAI_API_KEY })(config.OPENAI_MODEL));
	}
	if (config.GOOGLE_GENERATIVE_AI_API_KEY) {
		models.push(
			createGoogleGenerativeAI({ apiKey: config.GOOGLE_GENERATIVE_AI_API_KEY })(
				config.GEMINI_MODEL,
			),
		);
	}
	if (config.XAI_API_KEY) {
		models.push(createXai({ apiKey: config.XAI_API_KEY })(config.XAI_MODEL));
	}
	if (config.ANTHROPIC_API_KEY) {
		models.push(createAnthropic({ apiKey: config.ANTHROPIC_API_KEY })(config.ANTHROPIC_MODEL));
	}
	if (models.length === 0) {
		return new DeterministicSeedGenerator();
	}
	return new AiSeedGenerator({ models, logger: console });
}
