import { faker } from '@faker-js/faker';
import {
	createConversationSchema,
	createCustomerSchema,
	createFaqSchema,
	createJobSchema,
	createMessageSchema,
	createNotificationSchema,
} from '@rivus/core';
import { describe, expect, it } from 'vitest';
import {
	buildAppointment,
	type ConversationContact,
	FAQ_SEEDS,
	generateAppointments,
	generateConversations,
	generateCustomers,
	generateNotifications,
	normalizeFaqQuestion,
	parseSeedArgs,
	pickFaqSeeds,
	SEED_APPOINTMENT_MAX,
	SEED_APPOINTMENT_MIN,
	SEED_CONVERSATION_MAX,
	SEED_CONVERSATION_MIN,
	SEED_CUSTOMER_MAX,
	SEED_CUSTOMER_MIN,
	SEED_NOTIFICATION_MAX,
	SEED_NOTIFICATION_MIN,
	SeedArgError,
	selectNewFaqs,
} from '../src/seed-data';
import { BILLING_PAUSE_REASON } from '../src/services/inbox';

describe('parseSeedArgs', () => {
	it('parses long flags into a typed options object', () => {
		const options = parseSeedArgs([
			'--account',
			'acme-co',
			'--customers',
			'25',
			'--faqs',
			'12',
			'--appointments',
			'20',
			'--notifications',
			'6',
			'--seed',
			'7',
			'--dry-run',
		]);
		expect(options).toEqual({
			account: 'acme-co',
			customers: 25,
			faqs: 12,
			appointments: 20,
			notifications: 6,
			ai: true,
			seed: 7,
			dryRun: true,
			help: false,
		});
	});

	it('supports short flags', () => {
		const options = parseSeedArgs([
			'-a',
			'acme-co',
			'-c',
			'30',
			'-f',
			'10',
			'-p',
			'15',
			'-n',
			'5',
			'-s',
			'1',
		]);
		expect(options.account).toBe('acme-co');
		expect(options.customers).toBe(30);
		expect(options.faqs).toBe(10);
		expect(options.appointments).toBe(15);
		expect(options.notifications).toBe(5);
		expect(options.seed).toBe(1);
	});

	it('defaults counts to undefined, AI on, and booleans to false when omitted', () => {
		const options = parseSeedArgs(['--account', 'acme-co']);
		expect(options.customers).toBeUndefined();
		expect(options.faqs).toBeUndefined();
		expect(options.appointments).toBeUndefined();
		expect(options.notifications).toBeUndefined();
		expect(options.seed).toBeUndefined();
		expect(options.ai).toBe(true);
		expect(options.dryRun).toBe(false);
		expect(options.help).toBe(false);
	});

	it('--no-ai turns AI off', () => {
		expect(parseSeedArgs(['-a', 'acme-co', '--no-ai']).ai).toBe(false);
	});

	it('allows an explicit count of zero', () => {
		expect(parseSeedArgs(['-a', 'acme-co', '-c', '0']).customers).toBe(0);
		expect(parseSeedArgs(['-a', 'acme-co', '-p', '0']).appointments).toBe(0);
	});

	it('parses the conversations flag (long and short)', () => {
		expect(parseSeedArgs(['-a', 'acme-co', '--conversations', '7']).conversations).toBe(7);
		expect(parseSeedArgs(['-a', 'acme-co', '-i', '0']).conversations).toBe(0);
		expect(parseSeedArgs(['-a', 'acme-co']).conversations).toBeUndefined();
	});

	it('treats --help and --account-less invocations as parseable (validation happens later)', () => {
		expect(parseSeedArgs(['--help']).help).toBe(true);
		expect(parseSeedArgs([]).account).toBeUndefined();
	});

	it.each([
		['negative', ['-a', 'x', '-c', '-1']],
		['non-integer', ['-a', 'x', '-c', '2.5']],
		['not a number', ['-a', 'x', '-f', 'lots']],
		['bad appointments', ['-a', 'x', '-p', '-3']],
		['bad notifications', ['-a', 'x', '-n', '-2']],
		['bad conversations', ['-a', 'x', '-i', '-4']],
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

describe('generateAppointments', () => {
	const referenceDate = new Date('2026-06-28T12:00:00.000Z');
	const customerIds = ['cust-1', 'cust-2', 'cust-3'];
	const memberIds = ['user-1', 'user-2'];

	it('generates exactly the requested number of appointments, all schema-valid', () => {
		faker.seed(7);
		const appointments = generateAppointments({
			count: 20,
			customerIds,
			memberIds,
			referenceDate,
		});
		expect(appointments).toHaveLength(20);
		for (const appointment of appointments) {
			expect(() => createJobSchema.parse(appointment)).not.toThrow();
			expect(appointment.title.length).toBeGreaterThan(0);
			expect(appointment.durationMinutes).toBeGreaterThanOrEqual(1);
			expect(appointment.durationMinutes).toBeLessThanOrEqual(1440);
			expect(appointment.estimatedValue).toBeGreaterThanOrEqual(0);
			expect(Number.isInteger(appointment.estimatedValue)).toBe(true);
			// startAt is a canonical UTC instant the API will accept.
			expect(appointment.startAt).toMatch(/Z$/);
			expect(Number.isNaN(Date.parse(appointment.startAt))).toBe(false);
		}
	});

	it('round-robins the supplied customers and members across appointments', () => {
		faker.seed(1);
		const appointments = generateAppointments({
			count: 6,
			customerIds,
			memberIds,
			referenceDate,
		});
		for (const appointment of appointments) {
			expect(customerIds).toContain(appointment.customerId);
			expect(memberIds).toContain(appointment.assignedUserId);
		}
		// All three customers are used across six appointments.
		expect(new Set(appointments.map((a) => a.customerId))).toEqual(new Set(customerIds));
	});

	it('leaves links empty when no customers or members are available', () => {
		faker.seed(2);
		const appointments = generateAppointments({
			count: 3,
			customerIds: [],
			memberIds: [],
			referenceDate,
		});
		expect(appointments.every((a) => a.customerId === '' && a.assignedUserId === '')).toBe(true);
	});

	it('applies AI creative overrides while keeping the row valid', () => {
		faker.seed(3);
		const [appointment] = generateAppointments({
			count: 1,
			customerIds,
			memberIds,
			referenceDate,
			overrides: [{ title: 'Roof inspection', notes: 'Bring the drone.', durationMinutes: 45 }],
		});
		expect(appointment?.title).toBe('Roof inspection');
		expect(appointment?.notes).toBe('Bring the drone.');
		expect(appointment?.durationMinutes).toBe(45);
	});

	it('clamps an out-of-range override duration into the valid window', () => {
		faker.seed(4);
		const [appointment] = generateAppointments({
			count: 1,
			customerIds,
			memberIds,
			referenceDate,
			overrides: [{ durationMinutes: 99_999 }],
		});
		expect(appointment?.durationMinutes).toBe(1440);
		expect(() => createJobSchema.parse(appointment)).not.toThrow();
	});

	it('falls back to a default duration for a non-finite override', () => {
		faker.seed(8);
		const [appointment] = generateAppointments({
			count: 1,
			customerIds,
			memberIds,
			referenceDate,
			overrides: [{ durationMinutes: Number.NaN }],
		});
		expect(appointment?.durationMinutes).toBe(60);
	});

	it('buildAppointment produces a valid job for a single booking', () => {
		faker.seed(5);
		const appointment = buildAppointment({
			customerId: 'cust-9',
			assignedUserId: 'user-9',
			referenceDate,
		});
		expect(appointment.customerId).toBe('cust-9');
		expect(appointment.assignedUserId).toBe('user-9');
		expect(() => createJobSchema.parse(appointment)).not.toThrow();
	});

	it('keeps the default range sane', () => {
		expect(SEED_APPOINTMENT_MIN).toBeLessThanOrEqual(SEED_APPOINTMENT_MAX);
		expect(SEED_APPOINTMENT_MIN).toBeGreaterThanOrEqual(1);
	});
});

describe('generateNotifications', () => {
	it('generates exactly the requested number of notifications', () => {
		expect(generateNotifications(6)).toHaveLength(6);
		expect(generateNotifications(0)).toHaveLength(0);
		// A negative count is clamped to an empty batch rather than throwing.
		expect(generateNotifications(-3)).toHaveLength(0);
	});

	it('produces notifications that satisfy the API create schema', () => {
		faker.seed(7);
		for (const notification of generateNotifications(40)) {
			// Re-validating through the schema throws (failing the test) if a template
			// ever drifts outside the bounds the API enforces.
			expect(() => createNotificationSchema.parse(notification)).not.toThrow();
			expect(notification.title.length).toBeGreaterThan(0);
			expect(notification.title.length).toBeLessThanOrEqual(200);
			expect(notification.body.length).toBeLessThanOrEqual(2000);
			expect(notification.linkHref.length).toBeLessThanOrEqual(512);
		}
	});

	it('spans every notification type across a full rotation', () => {
		faker.seed(1);
		// A batch at least as large as the template set hits every template, since the
		// generator rotates through them from its starting offset.
		const types = new Set(generateNotifications(24).map((notification) => notification.type));
		expect(types).toEqual(
			new Set([
				'job_assigned',
				'job_updated',
				'job_canceled',
				'invite_accepted',
				'role_changed',
				'system',
			]),
		);
	});

	it('is reproducible for a fixed faker seed', () => {
		faker.seed(404);
		const first = generateNotifications(8);
		faker.seed(404);
		const second = generateNotifications(8);
		expect(first).toEqual(second);
	});

	it('keeps the default range sane', () => {
		expect(SEED_NOTIFICATION_MIN).toBeLessThanOrEqual(SEED_NOTIFICATION_MAX);
		expect(SEED_NOTIFICATION_MIN).toBeGreaterThanOrEqual(1);
	});
});

describe('generateConversations', () => {
	const contacts: ConversationContact[] = [
		{ customerId: 'cust-1', name: 'Dana Whitfield', phone: '(206) 555-0142' },
		{ customerId: 'cust-2', name: 'Priya Anand', phone: '(206) 555-0119' },
	];

	it('generates exactly the requested number of conversations', () => {
		expect(generateConversations(6, contacts)).toHaveLength(6);
		expect(generateConversations(0, contacts)).toHaveLength(0);
		// A negative count is clamped to an empty batch rather than throwing.
		expect(generateConversations(-2, contacts)).toHaveLength(0);
	});

	it('round-robins across the supplied customers and addresses them by name', () => {
		const seeds = generateConversations(4, contacts);
		expect(seeds.map((seed) => seed.conversation.customerId)).toEqual([
			'cust-1',
			'cust-2',
			'cust-1',
			'cust-2',
		]);
		expect(seeds[0]?.conversation.contactName).toBe('Dana Whitfield');
		// The dialogue greets the contact by their first name.
		const rivusTurn = seeds[0]?.messages.find((message) => message.author === 'rivus');
		expect(rivusTurn?.body).toContain('Dana');
	});

	it('invents a lead with no customer link when there are no customers', () => {
		faker.seed(11);
		const [seed] = generateConversations(1, []);
		expect(seed?.conversation.customerId).toBe('');
		expect(seed?.conversation.contactName.length).toBeGreaterThan(0);
	});

	it('produces conversations and messages that satisfy the API schemas', () => {
		const seeds = generateConversations(SEED_CONVERSATION_MAX, contacts);
		for (const seed of seeds) {
			expect(() => createConversationSchema.parse(seed.conversation)).not.toThrow();
			expect(seed.messages.length).toBeGreaterThan(0);
			for (const message of seed.messages) {
				expect(() => createMessageSchema.parse(message)).not.toThrow();
			}
		}
	});

	it('flags the billing thread for review with a held draft', () => {
		// The third script is the invoice question Rivus holds for a human.
		const seeds = generateConversations(3, contacts);
		const flagged = seeds.find((seed) => seed.review !== null);
		expect(flagged?.conversation.status).toBe('needs_attention');
		expect(flagged?.review?.flagReason).toBe(BILLING_PAUSE_REASON);
		expect(flagged?.review?.pendingReply.length).toBeGreaterThan(0);
	});

	it('keeps the default range sane', () => {
		expect(SEED_CONVERSATION_MIN).toBeLessThanOrEqual(SEED_CONVERSATION_MAX);
		expect(SEED_CONVERSATION_MIN).toBeGreaterThanOrEqual(1);
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
