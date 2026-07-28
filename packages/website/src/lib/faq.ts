import { slugify } from '@rivus/core';

/**
 * The marketing site's FAQ. Kept as data — like `site.ts` — so the page, the
 * pricing strip, and the FAQPage structured data all render from one source,
 * and the tests iterate the same arrays.
 *
 * Every answer states only what the site already claims elsewhere (pricing
 * tiers, the onboarding checklist, the legal/security pages) — no new
 * metrics, so the Phase 4 claims pass has nothing extra to audit here.
 */

export interface FaqEntry {
	question: string;
	answer: string;
}

export interface FaqCategory {
	title: string;
	/** Small uppercase kicker above the category heading. */
	eyebrow: string;
	entries: FaqEntry[];
}

/** URL-safe anchor id for a category, shared by the page and deep links. */
export function faqCategoryAnchor(category: FaqCategory): string {
	return slugify(category.title);
}

export const faqCategories: FaqCategory[] = [
	{
		title: 'Plans & pricing',
		eyebrow: 'PRICING',
		entries: [
			{
				question: 'How much does Rivus cost?',
				answer:
					'Solo is $149/month for one user at one location. Team is $349/month with unlimited users at one location. Multi-location is $349/month for the first location and $179/month for each additional one. Every plan includes every feature.',
			},
			{
				question: 'Does every plan really get every feature?',
				answer:
					'Yes. Plans differ only by how many users and locations they cover. All channels answered 24/7, scheduling and reminders, QuickBooks billing, reviews and FAQs, Google and Facebook ads, and the newsletter are on every plan.',
			},
			{
				question: 'Are there per-call or per-message fees?',
				answer:
					'No. Rivus is one flat monthly price — there are no per-call fees, and answering more of your calls never costs you more.',
			},
			{
				question: 'Do I need a credit card to start?',
				answer:
					'No. You can get started free with no credit card, and your onboarding specialist sets everything up before you commit to a plan.',
			},
			{
				question: 'Can I cancel anytime?',
				answer:
					'Yes. You can cancel whenever you like. Paid plans are billed in advance on a recurring basis until you cancel, as described in our Terms of Service.',
			},
		],
	},
	{
		title: 'Free setup & onboarding',
		eyebrow: 'GETTING STARTED',
		entries: [
			{
				question: 'What does the free onboarding include?',
				answer:
					'A dedicated human specialist imports your customers and history, writes your first FAQs, connects QuickBooks and your calendar, sets up ads and review requests, trains Rivus on your voice, and stays on call for your first weeks — at no cost, on every plan.',
			},
			{
				question: 'How fast can I go live?',
				answer:
					'Most owners are fully live within a day of signing up. Your specialist does the heavy lifting, so your part is mostly answering a few questions about how your business runs.',
			},
			{
				question: 'Do I have to set anything up myself?',
				answer:
					"No — that's the point of the specialist. You review how Rivus represents your business (its answers, its tone, your services and prices) and stay in charge of what it says; the connecting and configuring is done for you.",
			},
			{
				question: 'What do you need from me to get started?',
				answer:
					'The basics of your business: your services and pricing, your availability, the answers you want customers to get, and access to the tools you already use — like your calendar and QuickBooks. Your specialist takes it from there.',
			},
		],
	},
	{
		title: 'Channels & your number',
		eyebrow: 'CHANNELS',
		entries: [
			{
				question: 'Which channels does Rivus answer?',
				answer:
					'Phone calls, text/SMS, email, and WhatsApp — every one of them around the clock, in one unified inbox your team can watch live.',
			},
			{
				question: 'Do I keep my existing phone number?',
				answer:
					'Yes. Your onboarding specialist connects the number your customers already know, so nothing about how people reach you changes — except that someone always answers.',
			},
			{
				question: 'What happens when someone calls after hours?',
				answer:
					'Rivus answers immediately, whatever the hour. Voicemails are transcribed and called back, messages get an on-brand reply in seconds, and booked jobs land straight on your calendar for the morning.',
			},
			{
				question: 'How do reminders and follow-ups work?',
				answer:
					'When a job is booked, Rivus sends the confirmations and reminders that cut no-shows, and after the work is done it handles the invoice, the review request, and the follow-up that brings customers back.',
			},
		],
	},
	{
		title: 'The AI agent & human handoff',
		eyebrow: 'HOW IT WORKS',
		entries: [
			{
				question: 'Will Rivus sound like my business?',
				answer:
					'Yes. Rivus is trained on your own content — your services, prices, FAQs, and voice — so replies stay on-brand. Your specialist tunes it with you during onboarding, and you can adjust it any time.',
			},
			{
				question: 'Can a human step in?',
				answer:
					'Any time. Your team sees every conversation live in the app and can take over a thread whenever they want — your name stays on the door, and you stay in charge.',
			},
			{
				question: "What does Rivus do when it isn't sure?",
				answer:
					'It flags the conversation for a human instead of guessing. Big decisions — like large quotes — wait for your approval, and you get pinged only when a human touch is actually needed.',
			},
			{
				question: 'Can Rivus make mistakes?',
				answer:
					'Like any assistant, human or AI, it can. That is why you can review important messages, quotes, and bookings, and why a human on your team can step into any conversation at any moment. We are honest about this in our Terms of Service, too.',
			},
		],
	},
	{
		title: 'Security & data',
		eyebrow: 'TRUST',
		entries: [
			{
				question: 'Is my data secure?',
				answer:
					'We encrypt your data in transit with TLS and at rest with industry-standard encryption, restrict production access to the people who need it, and monitor continuously. Our Security page has the full picture.',
			},
			{
				question: 'Is my data used to train AI for other businesses?',
				answer:
					"No. Your business content trains Rivus to serve your business — it is not pooled to train a shared model on other companies' information.",
			},
			{
				question: 'How do payments stay safe?',
				answer:
					'Payments are processed by established PCI-compliant partners. Rivus never stores full card numbers, so sensitive payment details never sit on our servers.',
			},
			{
				question: 'How do my customers opt out of texts?',
				answer:
					'They reply STOP to any message — Rivus honors it automatically and passes it through to you — or HELP for help. Consent and opt-outs are covered in detail in our SMS terms.',
			},
		],
	},
];

/** Flat list of every entry, for the FAQPage structured data. */
export const allFaqEntries: FaqEntry[] = faqCategories.flatMap((category) => category.entries);

/** The pricing-adjacent questions teased under the pricing grid. */
export const pricingFaqTeasers: FaqEntry[] = [
	...(faqCategories.find((category) => category.title === 'Plans & pricing')?.entries.slice(0, 3) ??
		[]),
];
