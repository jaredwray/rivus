/**
 * Content for the /compare page: Rivus against the generic ways local
 * businesses handle the phones today. Deliberately names no competitors and
 * quotes no external prices — every cell is a structural characterization a
 * reader can verify from their own experience, per the claims rules in
 * WEBSITE_CONTENT_PLAN.md.
 */

export interface CompareColumn {
	key: 'rivus' | 'hire' | 'service' | 'voicemail';
	name: string;
	summary: string;
}

export const compareColumns: CompareColumn[] = [
	{
		key: 'rivus',
		name: 'Rivus',
		summary: 'An AI agent that answers, books, and runs the follow-through',
	},
	{
		key: 'hire',
		name: 'Hiring front desk',
		summary: 'A dedicated person at your counter',
	},
	{
		key: 'service',
		name: 'Answering service',
		summary: 'An outsourced call center taking messages',
	},
	{
		key: 'voicemail',
		name: 'Voicemail',
		summary: 'The default most owners live with',
	},
];

export interface CompareRow {
	dimension: string;
	rivus: string;
	hire: string;
	service: string;
	voicemail: string;
}

export const compareRows: CompareRow[] = [
	{
		dimension: 'Coverage',
		rivus: 'Every hour of every day, on every channel',
		hire: 'One shift — nights and weekends are extra',
		service: 'Around the clock if you pay for it',
		voicemail: 'Records around the clock, answers nothing',
	},
	{
		dimension: 'What a caller gets',
		rivus: 'An answer and a booked appointment',
		hire: 'A great conversation — during hours',
		service: 'A message taken for you to return',
		voicemail: 'A beep',
	},
	{
		dimension: 'Channels',
		rivus: 'Calls, texts, email, and WhatsApp in one inbox',
		hire: 'Whatever one person can juggle',
		service: 'Phone, primarily',
		voicemail: 'Phone only',
	},
	{
		dimension: 'Knows your business',
		rivus: 'Trained on your services, prices, and FAQs',
		hire: 'Deeply — after weeks of ramp-up',
		service: 'Reads the script you wrote',
		voicemail: 'No',
	},
	{
		dimension: 'Books your calendar',
		rivus: 'Yes — offers real open slots and books the pick',
		hire: 'Yes',
		service: 'Usually just relays the request',
		voicemail: 'No',
	},
	{
		dimension: 'After the job',
		rivus: 'Invoices, review asks, and follow-ups in the same place',
		hire: 'When there is time between calls',
		service: 'Not part of the job',
		voicemail: 'No',
	},
	{
		dimension: 'Cost shape',
		rivus: 'One flat monthly price, no per-call fees',
		hire: 'A full salary and everything that comes with one',
		service: 'Commonly metered per minute or per call',
		voicemail: 'Free — it just costs you the jobs',
	},
	{
		dimension: 'Setup',
		rivus: 'Done for you by a human specialist, free',
		hire: 'Hiring, onboarding, and training take weeks',
		service: 'Scripting and account setup',
		voicemail: 'Already on',
	},
];

/**
 * The honest caveat that keeps the page fair: a great human front desk is not
 * something we pretend to beat.
 */
export const compareCaveat =
	'To be clear: a great front-desk person is irreplaceable, and if you have one, keep them. Rivus exists for the businesses that can’t justify that salary yet — and for the hours when any human is off shift. Plenty of teams run both: a person at the counter by day, Rivus on everything else.';
