import { describe, expect, it } from 'vitest';
import { isInformationalQuestion, isPureGreeting } from '../src/services/agent/question';

/**
 * The gate that decides whether the knowledge capability may claim a turn. Its
 * two error directions cost very different things — a missed question just
 * leaves today's scheduling reply in place, while a wrongly-claimed booking turn
 * answers trivia at someone trying to book — so the inventory below is heavier
 * on the scheduling side on purpose. Everything here is a real customer phrasing.
 */

describe('isInformationalQuestion — questions about the business', () => {
	it.each([
		// The reported bug, verbatim.
		'whats your hours of operation?',
		"what's your hours of operation?",
		// A question mark is not required — plenty of texts arrive without one.
		'what are your business hours',
		'do you do tile work?',
		'how much do you charge?',
		'where are you located?',
		'do you offer free estimates?',
		'are you licensed and insured?',
		'what forms of payment do you take??',
		'do you service commercial buildings',
		'is there a trip charge',
		'tell me about your warranty',
		'can you tell me what areas you cover?',
		// Fractions are product sizes in a trades inbox, not dates — "1/2 inch"
		// must not read as January 2nd.
		'do you install 1/2 inch pipe?',
		'do you carry 3/4" fittings?',
		'do you stock 3/4-inch valves?',
		'can you replace a 1/2 hp disposal?',
		'do you sell 3/4 ton units?',
		// "24/7" is opening hours, never a calendar date.
		'are you open 24/7?',
	])('reads %j as an information-seeking question', (text) => {
		expect(isInformationalQuestion(text)).toBe(true);
	});

	it('is case- and whitespace-insensitive', () => {
		expect(isInformationalQuestion('  WHERE ARE YOU   LOCATED?  ')).toBe(true);
	});
});

describe('isInformationalQuestion — scheduling turns are never questions', () => {
	it.each([
		// Slot picks.
		'1',
		'2',
		'option 2',
		'the second one',
		// Proposals and availability asks.
		'Tuesday at 2pm works',
		'can you do tomorrow at 9?',
		'when can you come out?',
		'what times do you have available?',
		'are you free Friday?',
		'can I book an appointment?',
		'how soon can you get here?',
		'whats the earliest you have?',
		'does that time work for you?',
		'how about Wednesday?',
		'what else is open?',
		// The phrasing that opens most real threads — a booking request wearing a
		// question mark.
		'Can I get someone out to fix my water heater next week?',
		'could you come by this afternoon?',
		// Cancellations and reschedules.
		'need to reschedule',
		'I have to cancel my appointment',
		// Acknowledgements.
		'thanks!',
		'see you then',
		// Slash dates stay with the calendar — the fraction carve-out needs a real
		// unit of measure, so a preposition after the date doesn't defeat it.
		'does 8/5 work for you?',
		'is 8/5 open?',
		'does 8/5 in the afternoon work for you?',
	])('refuses %j to the scheduling engine', (text) => {
		expect(isInformationalQuestion(text)).toBe(false);
	});
});

describe('isInformationalQuestion — boundaries', () => {
	it.each([
		['an empty message', ''],
		['whitespace only', '   \n\t  '],
		['a bare question mark', '?'],
		['punctuation only', '!!! ...'],
		['emoji only', '👍🔧'],
	])('reads %s as no question at all', (_label, text) => {
		expect(isInformationalQuestion(text)).toBe(false);
	});

	it('still reads a question buried in a very long message', () => {
		const rambling = `${'so my kitchen sink has been dripping for weeks and I finally got around to looking at it. '.repeat(20)}anyway what do you charge for that`;
		expect(isInformationalQuestion(rambling)).toBe(true);
	});

	it('lets one scheduling word disqualify an otherwise question-shaped message', () => {
		// The guards are absolute: the same sentence flips the moment it names a slot.
		expect(isInformationalQuestion('what do you charge for a drain clean')).toBe(true);
		expect(isInformationalQuestion('what do you charge for a Tuesday appointment')).toBe(false);
	});

	it('never sends a bare greeting to the knowledge base', () => {
		// "hello?" wears a question mark but asks nothing; a knowledge-base miss
		// would page the team over someone saying hi.
		expect(isInformationalQuestion('hello?')).toBe(false);
		expect(isInformationalQuestion('Hi there!')).toBe(false);
		// A greeting with a real question attached is still a question.
		expect(isInformationalQuestion('hello, what are your hours?')).toBe(true);
	});
});

describe('isPureGreeting', () => {
	it.each([
		'Hello',
		'hi!',
		'hey there',
		'good morning',
		'Good Afternoon!',
		'yo',
		'Hello.',
		'hello?',
		'hey 👋',
		'hi hi',
	])('reads %j as nothing but a greeting', (text) => {
		expect(isPureGreeting(text)).toBe(true);
	});

	it.each([
		['a greeting with a question', 'hello, what are your hours?'],
		['a greeting with a booking ask', 'hi can I book a time?'],
		['a greeting with a problem', 'hello I need help'],
		['a greeting with a stray number', 'hello 2'],
		['a dangling "good" with no time of day', 'good'],
		['"good" attached to something else', 'good news, the part arrived'],
		['an empty message', ''],
		['punctuation only', '!!'],
		['an acknowledgement', 'thanks!'],
	])('reads %s as more than a greeting', (_label, text) => {
		expect(isPureGreeting(text)).toBe(false);
	});
});
