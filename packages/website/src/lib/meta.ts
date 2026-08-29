import { findIndustry, industries } from './industries';
import { siteConfig } from './site';

export interface PageMeta {
	title: string;
	description: string;
	canonical?: string;
	robots?: { index: boolean; follow: boolean };
	openGraph?: {
		url?: string;
		siteName?: string;
		locale?: string;
		title?: string;
		description?: string;
		type?: string;
	};
}

/**
 * The canonical URL each static public page declares. rivus.ai serves both
 * the apex and www, so every indexable page pins its canonical (resolved
 * absolute via the layout's metadataBase).
 */
export const pageMeta: Record<string, PageMeta> = {
	'/': {
		title: siteConfig.title,
		description: siteConfig.description,
		canonical: '/',
		openGraph: {
			title: siteConfig.title,
			description: siteConfig.description,
			url: '/',
			type: 'website',
			siteName: siteConfig.name,
			locale: 'en_US',
		},
	},
	'/about': {
		title: 'About — Rivus',
		description:
			'Rivus is the AI agent that runs the front office for local businesses — built by a small team in Seattle so owners can get back to the work they love.',
		canonical: '/about',
	},
	'/careers': {
		title: 'Careers — Rivus',
		description:
			'Help build the AI agent that runs the front office for the local businesses that keep our towns running.',
		canonical: '/careers',
	},
	'/contact': {
		title: 'Contact — Rivus',
		description:
			'Talk to the Rivus team — sales, support, press, privacy, and security. We reply within one business day.',
		canonical: '/contact',
	},
	'/apps': {
		title: 'Mobile apps — Rivus',
		description:
			'Run your front office from anywhere. Rivus is live on the web today, with native iPhone and Android apps on the way.',
		canonical: '/apps',
	},
	'/compare': {
		title: 'Rivus vs. the alternatives — hire, answering service, or voicemail',
		description:
			'How Rivus compares with hiring a front desk, using an answering service, or letting voicemail catch it — coverage, channels, booking, and cost shape.',
		canonical: '/compare',
	},
	'/demo': {
		title: 'Book a demo — Rivus',
		description:
			'See Rivus answer calls, book jobs, and run a front office live. Request a demo and a specialist will reach out within one business day.',
		canonical: '/demo',
	},
	'/faq': {
		title: 'FAQ — Rivus',
		description:
			'Answers about Rivus pricing, the free human onboarding, channels and phone numbers, how the AI agent hands off to humans, and how your data is protected.',
		canonical: '/faq',
	},
	'/press': {
		title: 'Press & brand — Rivus',
		description:
			'Company facts, boilerplate, and the official Rivus logo pack and brand guidelines for press and partners.',
		canonical: '/press',
	},
	'/privacy': {
		title: 'Privacy Policy — Rivus',
		description: 'How Rivus collects, uses, shares, and protects your information.',
		canonical: '/privacy',
	},
	'/terms': {
		title: 'Terms of Service — Rivus',
		description: 'The terms for using Rivus and the Rivus AI agent.',
		canonical: '/terms',
	},
	'/security': {
		title: 'Security — Rivus',
		description: 'How Rivus keeps your data, conversations, and customers safe.',
		canonical: '/security',
	},
	'/sms-terms': {
		title: 'SMS Messaging Terms — Rivus',
		description:
			'The terms for text messages sent through Rivus: program description, message frequency, rates, and how to opt out (STOP) or get help (HELP).',
		canonical: '/sms-terms',
	},
	'/sms-opt-in': {
		title: 'SMS opt-in — Rivus',
		description:
			'How people opt in to text messages sent through Rivus, the exact consent they give, and how to opt out at any time.',
		canonical: '/sms-opt-in',
	},
	'/acceptable-use': {
		title: 'Acceptable Use Policy — Rivus',
		description:
			'The rules for messaging through Rivus: consent requirements, carrier-prohibited content, and how we enforce them.',
		canonical: '/acceptable-use',
	},
};

export const customerJoinMeta: PageMeta = {
	title: 'Join as a customer — Rivus',
	description: 'Add your details so Rivus can book your appointment with this business over email.',
	robots: { index: false, follow: false },
};

export const notFoundMeta: PageMeta = {
	title: 'Page not found — Rivus',
	description: 'This page is off the schedule.',
};

export const adminMeta = {
	login: {
		title: 'Sign in — Rivus Console',
		robots: { index: false, follow: false },
	},
	overview: { title: 'Overview — Rivus Console', robots: { index: false, follow: false } },
	accounts: { title: 'Accounts — Rivus Console', robots: { index: false, follow: false } },
	onboarding: { title: 'Onboarding — Rivus Console', robots: { index: false, follow: false } },
	escalations: { title: 'Escalations — Rivus Console', robots: { index: false, follow: false } },
} as const;

/** Every trade page is statically generated from the industries data. */
export function industryStaticParams(): { slug: string }[] {
	return industries.map((industry) => ({ slug: industry.slug }));
}

export function industryPageMeta(slug: string): PageMeta {
	const industry = findIndustry(slug);
	if (!industry) {
		return { title: 'Page not found — Rivus', description: notFoundMeta.description };
	}
	return {
		title: `Rivus for ${industry.name} — the AI agent that runs your front office`,
		description: industry.metaDescription,
		canonical: `/industries/${industry.slug}`,
	};
}
