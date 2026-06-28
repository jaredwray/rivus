import { createCustomerSchema, createFaqSchema, createJobSchema } from '@rivus/core';
import type { LanguageModel } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import {
	AiSeedGenerator,
	type BusinessContext,
	createSeedGenerator,
	DeterministicSeedGenerator,
	type GenerateObjectFn,
	type SeedGenerator,
} from '../src/seed-ai';
import { normalizeFaqQuestion } from '../src/seed-data';

const CONTEXT: BusinessContext = {
	businessName: 'Acme Plumbing',
	website: 'https://acme.example',
	address: '1 Main St',
};

/**
 * A fake for the injected object-generator. The generic {@link GenerateObjectFn}
 * can't be satisfied by a concrete mock, so we cast at the boundary and branch on
 * the `schemaName` to return the right payload (mirrors the FAQ service tests).
 */
function fakeGenerate(
	impl: (options: { model: LanguageModel; schemaName?: string; prompt: string }) => unknown,
) {
	const mock = vi.fn(impl as (...args: unknown[]) => unknown);
	return { generate: mock as unknown as GenerateObjectFn, mock };
}

const PRIMARY = 'primary' as unknown as LanguageModel;
const BACKUP = 'backup' as unknown as LanguageModel;

/** Config slice with no provider keys; override one to enable AI. */
function aiConfig(overrides: Record<string, string | undefined> = {}) {
	return {
		OPENAI_API_KEY: undefined,
		OPENAI_MODEL: 'gpt-test',
		GOOGLE_GENERATIVE_AI_API_KEY: undefined,
		GEMINI_MODEL: 'gemini-test',
		XAI_API_KEY: undefined,
		XAI_MODEL: 'grok-test',
		ANTHROPIC_API_KEY: undefined,
		ANTHROPIC_MODEL: 'claude-test',
		...overrides,
	};
}

describe('createSeedGenerator', () => {
	it('returns the deterministic generator when no provider key is set', () => {
		const generator = createSeedGenerator(aiConfig());
		expect(generator.usesAi).toBe(false);
		expect(generator).toBeInstanceOf(DeterministicSeedGenerator);
	});

	it.each([
		['OPENAI_API_KEY', { OPENAI_API_KEY: 'sk-test' }],
		['GOOGLE_GENERATIVE_AI_API_KEY', { GOOGLE_GENERATIVE_AI_API_KEY: 'g-test' }],
		['XAI_API_KEY', { XAI_API_KEY: 'x-test' }],
		['ANTHROPIC_API_KEY', { ANTHROPIC_API_KEY: 'a-test' }],
	])('returns an AI generator when %s is set', (_label, overrides) => {
		const generator = createSeedGenerator(aiConfig(overrides));
		expect(generator.usesAi).toBe(true);
		expect(generator).toBeInstanceOf(AiSeedGenerator);
	});
});

describe('DeterministicSeedGenerator', () => {
	const generator: SeedGenerator = new DeterministicSeedGenerator();

	it('does not use AI', () => {
		expect(generator.usesAi).toBe(false);
	});

	it('generates valid customers, faqs, and appointments', async () => {
		const customers = await generator.generateCustomers(5, CONTEXT);
		expect(customers).toHaveLength(5);
		for (const customer of customers) {
			expect(() => createCustomerSchema.parse(customer)).not.toThrow();
		}

		const faqs = await generator.generateFaqs(6, CONTEXT);
		expect(faqs).toHaveLength(6);

		const appointments = await generator.generateAppointments(
			{
				count: 4,
				customerIds: ['c1', 'c2'],
				memberIds: ['m1'],
				referenceDate: new Date('2026-06-28T12:00:00.000Z'),
			},
			CONTEXT,
		);
		expect(appointments).toHaveLength(4);
		for (const appointment of appointments) {
			expect(() => createJobSchema.parse(appointment)).not.toThrow();
			expect(['c1', 'c2']).toContain(appointment.customerId);
		}
	});
});

describe('AiSeedGenerator.generateCustomers', () => {
	it('sanitizes model output into schema-valid customers', async () => {
		const { generate } = fakeGenerate(() => ({
			object: {
				customers: [
					{
						name: 'Jane Doe',
						email: 'jane@acme.test',
						phone: '555-111-2222',
						address: '1 A St',
						notes: 'VIP',
						lifetimeValueUsd: 100.5,
						balanceUsd: 20,
					},
					// Malformed email is replaced; negative/overlarge money is clamped.
					{ name: 'Bad Email', email: 'not-an-email', lifetimeValueUsd: -5, balanceUsd: 999_999 },
				],
			},
		}));
		const generator = new AiSeedGenerator({ models: [PRIMARY], generate });
		const customers = await generator.generateCustomers(2, CONTEXT);

		expect(customers).toHaveLength(2);
		for (const customer of customers) {
			expect(() => createCustomerSchema.parse(customer)).not.toThrow();
		}
		expect(customers[0]?.lifetimeValue).toBe(10_050);
		expect(customers[0]?.balance).toBe(2_000);
		// Negative lifetime → 0 cents; balance can't exceed lifetime.
		expect(customers[1]?.lifetimeValue).toBe(0);
		expect(customers[1]?.balance).toBe(0);
		expect(customers[1]?.email).toMatch(/@/);
	});

	it('tops up with faker when the model returns too few', async () => {
		const { generate } = fakeGenerate(() => ({
			object: { customers: [{ name: 'Only One', email: 'one@acme.test' }] },
		}));
		const generator = new AiSeedGenerator({ models: [PRIMARY], generate });
		const customers = await generator.generateCustomers(5, CONTEXT);
		expect(customers).toHaveLength(5);
	});

	it('drops unusable rows (empty name) and backfills to the requested count', async () => {
		const { generate } = fakeGenerate(() => ({
			object: { customers: [{ name: '' }, { name: '   ' }] },
		}));
		const generator = new AiSeedGenerator({ models: [PRIMARY], generate });
		const customers = await generator.generateCustomers(3, CONTEXT);
		expect(customers).toHaveLength(3);
		for (const customer of customers) {
			expect(customer.name.length).toBeGreaterThan(0);
		}
	});

	it('falls back to faker when every model fails', async () => {
		const { generate, mock } = fakeGenerate(() => {
			throw new Error('provider down');
		});
		const generator = new AiSeedGenerator({ models: [PRIMARY], generate });
		const customers = await generator.generateCustomers(4, CONTEXT);
		expect(customers).toHaveLength(4);
		expect(mock).toHaveBeenCalledTimes(1);
	});

	it('tries the next provider when the first fails', async () => {
		const { generate, mock } = fakeGenerate(({ model }) => {
			if (model === PRIMARY) {
				throw new Error('primary down');
			}
			return { object: { customers: [{ name: 'Backup Person', email: 'b@p.test' }] } };
		});
		const generator = new AiSeedGenerator({ models: [PRIMARY, BACKUP], generate });
		const customers = await generator.generateCustomers(1, CONTEXT);
		expect(mock).toHaveBeenCalledTimes(2);
		expect(customers[0]?.name).toBe('Backup Person');
	});

	it('returns nothing for a non-positive count without calling the model', async () => {
		const { generate, mock } = fakeGenerate(() => ({ object: { customers: [] } }));
		const generator = new AiSeedGenerator({ models: [PRIMARY], generate });
		expect(await generator.generateCustomers(0, CONTEXT)).toHaveLength(0);
		expect(mock).not.toHaveBeenCalled();
	});
});

describe('AiSeedGenerator.generateFaqs', () => {
	it('sanitizes faqs and tops up from the curated set without duplicating questions', async () => {
		const { generate } = fakeGenerate(() => ({
			object: {
				faqs: [
					{
						question: 'Do you offer emergency callouts?',
						answer: 'Yes, 24/7.',
						category: 'Service',
					},
					// Already in the curated set — top-up must not add it a second time.
					{ question: 'What are your business hours?', answer: '8 to 5.' },
					{ question: '', answer: 'dropped — no question' },
				],
			},
		}));
		const generator = new AiSeedGenerator({ models: [PRIMARY], generate });
		const faqs = await generator.generateFaqs(6, CONTEXT);

		expect(faqs).toHaveLength(6);
		for (const faq of faqs) {
			expect(() => createFaqSchema.parse(faq)).not.toThrow();
		}
		const questions = faqs.map((faq) => normalizeFaqQuestion(faq.question));
		expect(new Set(questions).size).toBe(questions.length);
	});

	it('falls back to the curated set when every model fails', async () => {
		const { generate } = fakeGenerate(() => {
			throw new Error('provider down');
		});
		const generator = new AiSeedGenerator({ models: [PRIMARY], generate });
		const faqs = await generator.generateFaqs(4, CONTEXT);
		expect(faqs).toHaveLength(4);
		for (const faq of faqs) {
			expect(() => createFaqSchema.parse(faq)).not.toThrow();
		}
	});

	it('returns nothing for a non-positive count', async () => {
		const { generate } = fakeGenerate(() => ({ object: { faqs: [] } }));
		const generator = new AiSeedGenerator({ models: [PRIMARY], generate });
		expect(await generator.generateFaqs(0, CONTEXT)).toHaveLength(0);
	});
});

describe('AiSeedGenerator.generateAppointments', () => {
	const args = {
		count: 3,
		customerIds: ['c1', 'c2'],
		memberIds: ['m1'],
		referenceDate: new Date('2026-06-28T12:00:00.000Z'),
	};

	it('applies AI creative fields while assembling valid, linked jobs', async () => {
		const { generate } = fakeGenerate(() => ({
			object: {
				appointments: [
					{
						title: 'Drain cleaning',
						notes: 'Bring the auger.',
						durationMinutes: 90,
						estimatedValueUsd: 250,
					},
					{ title: 'Water heater install' },
				],
			},
		}));
		const generator = new AiSeedGenerator({ models: [PRIMARY], generate });
		const appointments = await generator.generateAppointments(args, CONTEXT);

		expect(appointments).toHaveLength(3);
		for (const appointment of appointments) {
			expect(() => createJobSchema.parse(appointment)).not.toThrow();
			expect(['c1', 'c2']).toContain(appointment.customerId);
			expect(appointment.assignedUserId).toBe('m1');
		}
		expect(appointments[0]?.title).toBe('Drain cleaning');
		expect(appointments[0]?.durationMinutes).toBe(90);
		expect(appointments[0]?.estimatedValue).toBe(25_000);
	});

	it('falls back to faker appointments when the model fails', async () => {
		const { generate } = fakeGenerate(() => {
			throw new Error('provider down');
		});
		const generator = new AiSeedGenerator({ models: [PRIMARY], generate });
		const appointments = await generator.generateAppointments(args, CONTEXT);
		expect(appointments).toHaveLength(3);
		for (const appointment of appointments) {
			expect(() => createJobSchema.parse(appointment)).not.toThrow();
		}
	});

	it('returns nothing for a non-positive count', async () => {
		const { generate } = fakeGenerate(() => ({ object: { appointments: [] } }));
		const generator = new AiSeedGenerator({ models: [PRIMARY], generate });
		expect(await generator.generateAppointments({ ...args, count: 0 }, CONTEXT)).toHaveLength(0);
	});
});
