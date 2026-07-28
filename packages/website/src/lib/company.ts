import type { IconName } from '../components/marketing/icons';
import type { Tint } from './site';

/**
 * Content for the company info pages (about, careers, contact, apps). Kept as
 * data — like `site.ts` — so the pages stay declarative and the tests can
 * iterate the same arrays the pages render.
 */

export interface ValueCard {
	title: string;
	description: string;
	icon: IconName;
	tint: Tint;
}

/** About — what the company believes. */
export const companyValues: ValueCard[] = [
	{
		title: 'Owners first',
		description:
			"We build for the person on the roof, behind the chair, under the sink. If it doesn't hand them time back, it doesn't ship.",
		icon: 'heart',
		tint: 'red',
	},
	{
		title: 'Humans stay in charge',
		description:
			'Rivus drafts, answers, and books — but your name is on the door. A human can step into any conversation, any time.',
		icon: 'users',
		tint: 'indigo',
	},
	{
		title: 'Earn trust daily',
		description:
			'Your customers, calendar, and money flow through Rivus. We treat that access like the responsibility it is.',
		icon: 'shield',
		tint: 'green',
	},
	{
		title: 'Speed is the product',
		description:
			'A lead answered in seconds becomes a job. Everything we make is measured by how fast it helps you respond.',
		icon: 'bolt',
		tint: 'cyan',
	},
];

export const aboutStory: string[] = [
	'Rivus started with a simple observation: the people who keep our towns running — plumbers, electricians, stylists, clinicians, landscapers — lose work every day for one reason. They were busy doing the job, so they missed the call about the next one.',
	"The fix used to be hiring a front office. Most local businesses can't, so evenings disappear into voicemails, invoices, and follow-ups. We believed the newest generation of AI could finally carry that load — not with a phone tree or a canned chatbot, but with an agent that genuinely runs the desk: answering every channel in seconds, booking real jobs on a real calendar, collecting payment, and keeping the marketing lights on.",
	"That's Rivus. It's built by a small team in Seattle, Washington, and set up for every customer by a real human specialist — free — because software should meet you where you are. Owners get their evenings back; their customers get an answer the moment they reach out. That's the whole idea.",
];

export interface CompanyStat {
	value: string;
	label: string;
}

/**
 * Headline numbers on the about page. Product commitments only — no invented
 * measurements (the claims rules in WEBSITE_CONTENT_PLAN.md); a measured
 * reply-time stat can return here once there is real data behind it.
 */
export const companyStats: CompanyStat[] = [
	{ value: '24/7', label: 'on every channel' },
	{ value: 'Seconds', label: 'to first reply' },
	{ value: '1 day', label: 'from signup to live' },
];

/** Careers — how the team works. */
export const careersValues: ValueCard[] = [
	{
		title: 'Small team, real ownership',
		description:
			"You'll own problems end to end — talk to customers, design the fix, ship it, and watch it book someone's next job.",
		icon: 'users',
		tint: 'violet',
	},
	{
		title: 'Ship every week',
		description:
			'We keep the loop short. Ideas become working software in days, and the best argument is a running demo.',
		icon: 'bolt',
		tint: 'cyan',
	},
	{
		title: 'Customers in the room',
		description:
			'Everyone talks to the owners we serve, whatever your role. Their Tuesday is the roadmap.',
		icon: 'chat',
		tint: 'amber',
	},
	{
		title: 'Remote-first, Seattle roots',
		description:
			'Work where you work best. We gather in Seattle a few times a year to plan, cook, and argue about fonts.',
		icon: 'pin',
		tint: 'green',
	},
];

export const careersEmail = 'careers@rivus.ai';

/** Contact — the ways to reach the team. */
export interface ContactChannel {
	title: string;
	description: string;
	email: string;
	icon: IconName;
	tint: Tint;
	/** Optional on-site page for this channel (e.g. the press kit). */
	page?: { label: string; href: string };
}

export const contactChannels: ContactChannel[] = [
	{
		title: 'Sales',
		description: 'Questions about plans, pricing, or rolling Rivus out across locations.',
		email: 'sales@rivus.ai',
		icon: 'trend-up',
		tint: 'violet',
	},
	{
		title: 'Support',
		description:
			'Already a customer? Your onboarding specialist and our support team have your back.',
		email: 'support@rivus.ai',
		icon: 'bolt',
		tint: 'cyan',
	},
	{
		title: 'Press & partnerships',
		description: "Working on a story, an integration, or a partnership? We'd love to talk.",
		email: 'press@rivus.ai',
		icon: 'star',
		tint: 'amber',
		page: { label: 'Press kit & brand assets', href: '/press' },
	},
	{
		title: 'Privacy & legal',
		description: 'Privacy requests, legal notices, and questions about our terms or policies.',
		email: 'legal@rivus.ai',
		icon: 'doc',
		tint: 'indigo',
	},
	{
		title: 'Security',
		description: 'Report a vulnerability or ask how we protect your data. We respond quickly.',
		email: 'security@rivus.ai',
		icon: 'shield',
		tint: 'green',
	},
];

/** Apps — where Rivus runs today. */
export interface AppPlatform {
	name: string;
	description: string;
	icon: IconName;
	status: 'live' | 'soon';
	statusLabel: string;
}

export const appPlatforms: AppPlatform[] = [
	{
		name: 'Web app',
		description:
			'The full Rivus experience in any browser — inbox, schedule, billing, and your marketing, live right now.',
		icon: 'desktop',
		status: 'live',
		statusLabel: 'Available now',
	},
	{
		name: 'iPhone',
		description:
			'The native iOS app with push notifications the moment Rivus books a job or flags a conversation for you.',
		icon: 'apple',
		status: 'soon',
		statusLabel: 'Coming soon',
	},
	{
		name: 'Android',
		description:
			'The same Rivus, native on Android — run the whole front office from the truck between jobs.',
		icon: 'android',
		status: 'soon',
		statusLabel: 'Coming soon',
	},
];

export const appHighlights: string[] = [
	'See every conversation Rivus is handling, live',
	'Approve quotes and big decisions with one tap',
	'Watch jobs land on your calendar as they book',
	'Get pinged only when a human touch is needed',
];
