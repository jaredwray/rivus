import { slugify } from '@rivus/core';
import type { IconName } from '../components/marketing/icons';

/** Named color tints for icon tiles and avatars; resolved to colors in CSS. */
export type Tint = 'red' | 'amber' | 'indigo' | 'violet' | 'cyan' | 'green';

export const siteConfig = {
	name: 'Rivus',
	tagline: 'The AI agent that runs your front office.',
	description:
		'Rivus answers every call, text, and message the second it comes in — booking jobs straight to your calendar and handling billing, reviews, ads, and your newsletter. Around the clock.',
	heroLead:
		'Rivus is the AI agent that runs your front office — answering every call, text, and message the second it comes in, booking jobs straight to your calendar, and handling billing, reviews, ads, and your newsletter. Around the clock.',
	domains: 'riv.us · rivus.ai',
};

export const navLinks = [
	{ label: 'Why Rivus', href: '/#problem' },
	{ label: 'Features', href: '/#features' },
	{ label: 'Setup', href: '/#onboarding' },
	{ label: 'Pricing', href: '/#pricing' },
];

export interface Feature {
	title: string;
	description: string;
	icon: IconName;
	tint: Tint;
}

/** The four back-office capabilities shown in the features grid. */
export const features: Feature[] = [
	{
		title: 'Smart FAQs',
		description: 'Post your answers once. Rivus uses them to handle customer questions, on brand.',
		icon: 'doc',
		tint: 'violet',
	},
	{
		title: 'Google & FB ads',
		description: 'Rivus runs and optimizes your ads, shifting budget to what books real jobs.',
		icon: 'trend-up',
		tint: 'cyan',
	},
	{
		title: 'Reviews',
		description: 'Asks happy customers for 5 stars and replies to every review for you.',
		icon: 'star',
		tint: 'amber',
	},
	{
		title: 'Newsletter',
		description: 'Drafts and sends a newsletter that brings past customers back for more.',
		icon: 'newsletter',
		tint: 'green',
	},
];

/** A URL-safe anchor id for a feature, derived with the shared slugify helper. */
export function featureAnchor(feature: Feature): string {
	return slugify(feature.title);
}

export interface Problem {
	title: string;
	description: string;
	icon: IconName;
	tint: Tint;
}

export const problems: Problem[] = [
	{
		title: 'Missed calls = missed money',
		description:
			'1 in 4 calls to local businesses goes unanswered. Each one is a job handed to a competitor.',
		icon: 'phone-off',
		tint: 'red',
	},
	{
		title: 'Leads come in after hours',
		description:
			"Customers message at 9pm. By morning, they've already booked someone who replied first.",
		icon: 'clock',
		tint: 'amber',
	},
	{
		title: 'Buried in admin',
		description:
			'Quotes, invoices, reminders, follow-ups. The paperwork eats the evenings you owe your family.',
		icon: 'list',
		tint: 'indigo',
	},
	{
		title: 'No time for marketing',
		description:
			'Ads, reviews, newsletters — you know they grow the business, but who has the hours?',
		icon: 'trend-up',
		tint: 'violet',
	},
];

export interface Step {
	title: string;
	description: string;
}

export const steps: Step[] = [
	{
		title: 'We set you up — free',
		description:
			'Your onboarding specialist connects your number, calendar, and QuickBooks, and trains Rivus on your business.',
	},
	{
		title: 'Rivus answers 24/7',
		description:
			'Every call, text, and email gets a fast, on-brand reply — and turns into a booked job on your calendar.',
	},
	{
		title: 'You just do the work',
		description:
			'Show up to the job. Rivus handles the reminders, the invoice, the review request, and the next lead.',
	},
];

export interface Channel {
	label: string;
	icon: IconName;
}

export const channels: Channel[] = [
	{ label: 'Phone calls', icon: 'phone' },
	{ label: 'Text / SMS', icon: 'chat' },
	{ label: 'Email', icon: 'mail' },
	{ label: 'WhatsApp', icon: 'whatsapp' },
];

export const outcomes: string[] = ['Job booked', 'Invoice paid', 'Review requested'];

export interface InboxItem {
	initials: string;
	name: string;
	channel: string;
	note: string;
	/** `handled` shows the Rivus check; `flagged` shows the needs-you marker. */
	state: 'handled' | 'flagged';
}

export const inboxItems: InboxItem[] = [
	{
		initials: 'TM',
		name: 'Theo Marsh',
		channel: 'Phone',
		note: 'Voicemail transcribed & called back',
		state: 'handled',
	},
	{
		initials: 'PA',
		name: 'Priya Anand',
		channel: 'Email',
		note: 'Billing question — flagged for you',
		state: 'flagged',
	},
	{
		initials: 'LR',
		name: 'Luis Romero',
		channel: 'WhatsApp',
		note: 'Answered from your FAQs',
		state: 'handled',
	},
];

export interface ScheduleItem {
	time: string;
	title: string;
	detail: string;
	/** Visual treatment of the slot. */
	tone: 'cyan' | 'violet' | 'hold';
}

export const scheduleItems: ScheduleItem[] = [
	{ time: '8:30', title: 'Water heater install', detail: 'Dana W. · Ballard', tone: 'cyan' },
	{ time: '10:00', title: 'Drain cleaning', detail: 'Theo M. · Queen Anne', tone: 'violet' },
	{ time: '1:30', title: 'Emergency hold', detail: 'Kept open by Rivus', tone: 'hold' },
	{ time: '3:30', title: 'Faucet replacement', detail: 'Luis R. · Bellevue', tone: 'cyan' },
];

export const onboardingChecklist: string[] = [
	'Imports your customers & history',
	'Writes your first FAQs',
	'Connects QuickBooks & calendar',
	'Sets up ads & review requests',
	'Trains Rivus on your voice',
	'Stays on call for your first weeks',
];

export interface Stat {
	value: string;
	label: string;
}

export const onboardingStats: Stat[] = [
	{ value: '1 day', label: 'to go live' },
	{ value: '$0', label: 'setup cost' },
	{ value: 'Real', label: 'human' },
];

export interface Platform {
	label: string;
	icon: IconName;
}

export const platforms: Platform[] = [
	{ label: 'Web app', icon: 'desktop' },
	{ label: 'iPhone', icon: 'apple' },
	{ label: 'Android', icon: 'android' },
];

export interface Testimonial {
	quote: string;
	name: string;
	business: string;
	initials: string;
	tint: 'cyan' | 'violet' | 'green';
}

export const testimonials: Testimonial[] = [
	{
		quote:
			"Rivus booked 11 jobs the first weekend — while I was at my kid's game. It paid for itself before I'd even finished setup.",
		name: 'Marcus T.',
		business: 'Cascade Plumbing & Heating',
		initials: 'MT',
		tint: 'cyan',
	},
	{
		quote:
			'We stopped missing calls completely. Our Google rating climbed from 4.2 to 4.8 in two months — Rivus asks every happy client for a review.',
		name: 'Renee O.',
		business: 'Glow Hair Studio',
		initials: 'RO',
		tint: 'violet',
	},
	{
		quote:
			'The free setup sold me — my specialist did everything. Now I just approve the big quotes and show up to the work.',
		name: 'Dev P.',
		business: 'Summit Heating & Air',
		initials: 'DP',
		tint: 'green',
	},
];

export interface PricingTier {
	name: string;
	audience: string;
	price: string;
	period?: string;
	cta: string;
	/** Where the tier's CTA goes; defaults to the sign-up section. */
	ctaHref?: string;
	features: string[];
	featured?: boolean;
	badge?: string;
}

export const pricingTiers: PricingTier[] = [
	{
		name: 'Solo',
		audience: 'For owner-operators',
		price: '$149',
		period: '/mo',
		cta: 'Start free',
		features: [
			'All channels answered 24/7',
			'Scheduling & reminders',
			'QuickBooks billing',
			'Reviews & FAQs',
		],
	},
	{
		name: 'Team',
		audience: 'For growing crews',
		price: '$349',
		period: '/mo',
		cta: 'Start free',
		featured: true,
		badge: 'Most popular',
		features: [
			'Everything in Solo',
			'Up to 10 team members',
			'Google & Facebook ads',
			'Newsletter & campaigns',
		],
	},
	{
		name: 'Multi-location',
		audience: 'For franchises & chains',
		price: "Let's talk",
		cta: 'Contact sales',
		ctaHref: '/contact',
		features: [
			'Everything in Team',
			'Unlimited locations & seats',
			'Dedicated success manager',
			'SLA & priority support',
		],
	},
];

export interface FooterColumn {
	title: string;
	links: { label: string; href: string }[];
}

export const footerColumns: FooterColumn[] = [
	{
		title: 'Product',
		links: [
			{ label: 'Features', href: '/#features' },
			{ label: 'Pricing', href: '/#pricing' },
			{ label: 'Free setup', href: '/#onboarding' },
			{ label: 'Mobile apps', href: '/apps' },
		],
	},
	{
		title: 'Company',
		links: [
			{ label: 'About', href: '/about' },
			{ label: 'Careers', href: '/careers' },
			{ label: 'Contact', href: '/contact' },
		],
	},
	{
		title: 'Legal',
		links: [
			{ label: 'Privacy', href: '/privacy' },
			{ label: 'Terms', href: '/terms' },
			{ label: 'SMS terms', href: '/sms-terms' },
			{ label: 'SMS opt-in', href: '/sms-opt-in' },
			{ label: 'Acceptable use', href: '/acceptable-use' },
			{ label: 'Security', href: '/security' },
		],
	},
];

export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Base URL of the Rivus product app — where sign-in, signup, and demo booking
 * live. It's a separate deploy from this marketing site, so links to it are
 * absolute external URLs (plain anchors, not next/link).
 */
export const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.rivus.ai';
