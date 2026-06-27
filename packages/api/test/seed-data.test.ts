import { faker } from '@faker-js/faker';
import { createCustomerSchema, createFaqSchema } from '@rivus/core';
import { describe, expect, it } from 'vitest';
import {
	FAQ_SEEDS,
	generateCustomers,
	normalizeFaqQuestion,
	parseSeedArgs,
	pickFaqSeeds,
	SEED_CUSTOMER_MAX,
	SEED_CUSTOMER_MIN,
	SeedArgError,
	selectNewFaqs,
} from '../src/seed-data';

describe('parseSeedArgs', () => {
	it('parses long flags into a typed options object', () => {
		const options = parseSeedArgs([
			'--account',
			'acme-co',
			'--customers',
			'25',
			'--faqs',
			'12',
			'--seed',
			'7',
			'--dry-run',
		]);
		expect(options).toEqual({
			account: 'acme-co',
			customers: 25,
			faqs: 12,
			seed: 7,
			dryRun: true,
			help: false,
		});
	});

	it('supports short flags', () => {
		const options = parseSeedArgs(['-a', 'acme-co', '-c', '30', '-f', '10', '-s', '1']);
		expect(options.account).toBe('acme-co');
		expect(options.customers).toBe(30);
		expect(options.faqs).toBe(10);
		expect(options.seed).toBe(1);
	});

	it('defaults counts to undefined and booleans to false when omitted', () => {
		const options = parseSeedArgs(['--account', 'acme-co']);
		expect(options.customers).toBeUndefined();
		expect(options.faqs).toBeUndefined();
		expect(options.seed).toBeUndefined();
		expect(options.dryRun).toBe(false);
		expect(options.help).toBe(false);
	});

	it('allows an explicit count of zero', () => {
		expect(parseSeedArgs(['-a', 'acme-co', '-c', '0']).customers).toBe(0);
	});

	it('treats --help and --account-less invocations as parseable (validation happens later)', () => {
		expect(parseSeedArgs(['--help']).help).toBe(true);
		expect(parseSeedArgs([]).account).toBeUndefined();
	});

	it.each([
		['negative', ['-a', 'x', '-c', '-1']],
		['non-integer', ['-a', 'x', '-c', '2.5']],
		['not a number', ['-a', 'x', '-f', 'lots']],
	])('throws SeedArgError on a %s count', (_label, argv) => {
		expect(() => parseSeedArgs(argv)).toThrow(SeedArgError);
	});

	it('throws SeedArgError on an unknown flag', () => {
		expect(() => parseSeedArgs(['--nope'])).toThrow(SeedArgError);
	});
});

describe('generateCustomers', () => {
	it('generates exactly the requested number of customers', () => {
		expect(generateCustomers(25)).toHaveLength(25);
		expect(generateCustomers(0)).toHaveLength(0);
		// A negative count is clamped to an empty batch rather than throwing.
		expect(generateCustomers(-5)).toHaveLength(0);
	});

	it('produces customers that satisfy the API create schema', () => {
		faker.seed(123);
		for (const customer of generateCustomers(50)) {
			// Re-validating through the schema is a no-op if the generator is correct,
			// and throws (failing the test) if it ever drifts out of bounds.
			expect(() => createCustomerSchema.parse(customer)).not.toThrow();
			expect(customer.name.length).toBeGreaterThan(0);
			expect(customer.phone.length).toBeLessThanOrEqual(40);
			expect(customer.address.length).toBeLessThanOrEqual(300);
			expect(Number.isInteger(customer.lifetimeValue)).toBe(true);
			expect(customer.lifetimeValue).toBeGreaterThanOrEqual(0);
			expect(Number.isInteger(customer.balance)).toBe(true);
			expect(customer.balance).toBeGreaterThanOrEqual(0);
		}
	});

	it('is reproducible for a fixed faker seed', () => {
		faker.seed(999);
		const first = generateCustomers(5);
		faker.seed(999);
		const second = generateCustomers(5);
		expect(first).toEqual(second);
	});

	it('keeps the default range sane', () => {
		expect(SEED_CUSTOMER_MIN).toBeLessThanOrEqual(SEED_CUSTOMER_MAX);
		expect(SEED_CUSTOMER_MIN).toBeGreaterThanOrEqual(20);
		expect(SEED_CUSTOMER_MAX).toBeLessThanOrEqual(30);
	});
});

describe('FAQ_SEEDS', () => {
	it('provides at least ten curated FAQs', () => {
		expect(FAQ_SEEDS.length).toBeGreaterThanOrEqual(10);
	});

	it('has unique questions and non-empty categories', () => {
		const questions = FAQ_SEEDS.map((faq) => normalizeFaqQuestion(faq.question));
		expect(new Set(questions).size).toBe(FAQ_SEEDS.length);
		for (const faq of FAQ_SEEDS) {
			expect(faq.category.length).toBeGreaterThan(0);
		}
	});

	it('every curated FAQ satisfies the API create schema', () => {
		for (const faq of FAQ_SEEDS) {
			expect(() => createFaqSchema.parse(faq)).not.toThrow();
		}
	});
});

describe('pickFaqSeeds', () => {
	it('returns all curated FAQs by default, validated', () => {
		const picked = pickFaqSeeds();
		expect(picked).toHaveLength(FAQ_SEEDS.length);
		// Schema defaults are applied (e.g. status published).
		expect(picked.every((faq) => faq.status === 'published')).toBe(true);
	});

	it('caps to the first n when fewer are requested', () => {
		const picked = pickFaqSeeds(3);
		expect(picked).toHaveLength(3);
		expect(picked[0]?.question).toBe(FAQ_SEEDS[0]?.question);
	});

	it('never returns more than are available', () => {
		expect(pickFaqSeeds(1000)).toHaveLength(FAQ_SEEDS.length);
	});

	it('returns nothing for a count of zero', () => {
		expect(pickFaqSeeds(0)).toHaveLength(0);
	});
});

describe('selectNewFaqs', () => {
	it('keeps every candidate when the account has no FAQs', () => {
		const candidates = pickFaqSeeds();
		const { toCreate, skipped } = selectNewFaqs(candidates, []);
		expect(toCreate).toHaveLength(candidates.length);
		expect(skipped).toHaveLength(0);
	});

	it('skips candidates whose question already exists (case- and space-insensitive)', () => {
		const candidates = pickFaqSeeds();
		const existing = [`  ${candidates[0]?.question.toUpperCase()}  `];
		const { toCreate, skipped } = selectNewFaqs(candidates, existing);
		expect(skipped).toHaveLength(1);
		expect(skipped[0]?.question).toBe(candidates[0]?.question);
		expect(toCreate).toHaveLength(candidates.length - 1);
	});

	it('de-duplicates within the candidate batch itself', () => {
		const first = FAQ_SEEDS[0];
		if (!first) {
			throw new Error('expected at least one curated FAQ');
		}
		const duplicated = [createFaqSchema.parse(first), createFaqSchema.parse(first)];
		const { toCreate, skipped } = selectNewFaqs(duplicated, []);
		expect(toCreate).toHaveLength(1);
		expect(skipped).toHaveLength(1);
	});
});

describe('normalizeFaqQuestion', () => {
	it('trims surrounding whitespace and lowercases', () => {
		expect(normalizeFaqQuestion('  How Much?  ')).toBe('how much?');
	});
});
