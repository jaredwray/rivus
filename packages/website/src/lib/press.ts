import type { IconName } from '../components/marketing/icons';
import type { Tint } from './site';

/**
 * Content for the press & brand page. Like `company.ts`, kept as data so the
 * page stays declarative and the tests iterate the same arrays.
 *
 * Deliberately limited to independently verifiable company facts — no
 * metrics. Stats join this page only after the claims pass in
 * WEBSITE_CONTENT_PLAN.md clears them.
 */

export const pressEmail = 'press@rivus.ai';

/** The one-paragraph company description reporters can lift verbatim. */
export const boilerplate =
	'Rivus is the AI agent that runs the front office for local businesses — plumbers, HVAC crews, electricians, salons, clinics, and landscapers. It answers every call, text, email, and WhatsApp message the moment it arrives, books jobs onto a real calendar, handles invoicing through the tools a business already uses, and keeps reviews, ads, and newsletters running. Every account is set up by a human onboarding specialist, free. Rivus is built by a remote-first team with roots in Seattle, Washington, and lives at rivus.ai.';

export interface PressFact {
	title: string;
	description: string;
	icon: IconName;
	tint: Tint;
}

export const pressFacts: PressFact[] = [
	{
		title: 'What we make',
		description:
			'An AI agent that runs a local business’s front office — answering, scheduling, billing, and marketing in one place.',
		icon: 'bolt',
		tint: 'violet',
	},
	{
		title: 'Who it serves',
		description:
			'Owner-operated local businesses: the trades, salons, clinics, and crews that keep towns running.',
		icon: 'users',
		tint: 'cyan',
	},
	{
		title: 'Where we are',
		description:
			'Remote-first with roots in Seattle, Washington, United States. Online at rivus.ai and riv.us.',
		icon: 'pin',
		tint: 'green',
	},
	{
		title: 'How setup works',
		description:
			'Every plan includes a dedicated human onboarding specialist who connects tools and trains Rivus — at no cost.',
		icon: 'heart',
		tint: 'amber',
	},
];

export interface BrandAsset {
	name: string;
	description: string;
	/** Downloads offered for this asset, all under /press/. */
	files: { label: string; href: string }[];
	/** Preview image path; rendered on a light card. */
	preview: string;
}

export const brandAssets: BrandAsset[] = [
	{
		name: 'Horizontal logo',
		description: 'The primary lockup. Use it whenever the space is wider than it is tall.',
		preview: '/press/rivus-logo-horizontal.svg',
		files: [
			{ label: 'SVG', href: '/press/rivus-logo-horizontal.svg' },
			{ label: 'PNG', href: '/press/rivus-logo-horizontal.png' },
			{ label: 'SVG · on dark', href: '/press/rivus-logo-horizontal-negative.svg' },
			{ label: 'PNG · on dark', href: '/press/rivus-logo-horizontal-negative.png' },
		],
	},
	{
		name: 'Vertical logo',
		description: 'The stacked lockup for square and tall placements.',
		preview: '/press/rivus-logo-vertical.svg',
		files: [
			{ label: 'SVG', href: '/press/rivus-logo-vertical.svg' },
			{ label: 'PNG', href: '/press/rivus-logo-vertical.png' },
			{ label: 'SVG · on dark', href: '/press/rivus-logo-vertical-negative.svg' },
			{ label: 'PNG · on dark', href: '/press/rivus-logo-vertical-negative.png' },
		],
	},
	{
		name: 'Symbol',
		description: 'The mark on its own, for avatars, favicons, and tight spaces.',
		preview: '/press/rivus-symbol.svg',
		files: [
			{ label: 'SVG', href: '/press/rivus-symbol.svg' },
			{ label: 'PNG', href: '/press/rivus-symbol.png' },
		],
	},
];

export const brandGuidelinesPdf = '/press/rivus-brand-guidelines.pdf';

/** The usage rules that travel with the assets (the PDF has the full system). */
export const brandRules: string[] = [
	'Keep the logo’s colors as shipped — the gradient mark and wordmark are not to be recolored.',
	'Use the on-dark (negative) variants on dark backgrounds; never place the positive logo on dark.',
	'Give the logo clear space and don’t stretch, rotate, outline, or add effects to it.',
	'The Rivus gradient identifies Rivus itself — don’t use it as a background or decoration in your own layouts.',
];
