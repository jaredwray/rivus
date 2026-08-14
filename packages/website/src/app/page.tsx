import type { Metadata } from 'next';
import { AnnouncementBar } from '../components/marketing/announcement-bar';
import { CrossPlatform } from '../components/marketing/cross-platform';
import { FeaturesSection } from '../components/marketing/features-section';
import { FinalCta } from '../components/marketing/final-cta';
import { FoundingCustomers } from '../components/marketing/founding-customers';
import { Hero } from '../components/marketing/hero';
import { HowItWorks } from '../components/marketing/how-it-works';
import { IndustriesSection } from '../components/marketing/industries-section';
import { JsonLd } from '../components/marketing/json-ld';
import { OnboardingSection } from '../components/marketing/onboarding-section';
import { Pricing } from '../components/marketing/pricing';
import { ProblemSection } from '../components/marketing/problem-section';
import { SiteFooter } from '../components/marketing/site-footer';
import { SiteNav } from '../components/marketing/site-nav';
import { homeFaqTeasers } from '../lib/faq';
import { pricingTiers, siteConfig } from '../lib/site';
import { baseUrl } from './sitemap';

export const metadata: Metadata = {
	title: siteConfig.title,
	description: siteConfig.description,
	alternates: { canonical: '/' },
	openGraph: {
		title: siteConfig.title,
		description: siteConfig.description,
		url: '/',
		type: 'website',
	},
};

const organizationId = `${baseUrl}/#organization`;

const monthlyPrices = pricingTiers.map((tier) => Number(tier.price.replace(/[^0-9.]/g, '')));
const lowPrice = Math.min(...monthlyPrices);
const highPrice = Math.max(...monthlyPrices);

/**
 * Organization + WebSite + SoftwareApplication structured data for the home
 * page, built from the same site config and pricing the visible copy uses.
 */
const homeJsonLd = {
	'@context': 'https://schema.org',
	'@graph': [
		{
			'@type': 'Organization',
			'@id': organizationId,
			name: siteConfig.name,
			url: baseUrl,
			logo: `${baseUrl}/press/rivus-symbol.svg`,
			description: siteConfig.description,
			email: 'hello@rivus.ai',
		},
		{
			'@type': 'WebSite',
			name: siteConfig.name,
			url: baseUrl,
			description: siteConfig.description,
			publisher: { '@id': organizationId },
			inLanguage: 'en',
		},
		{
			'@type': 'SoftwareApplication',
			name: siteConfig.name,
			applicationCategory: 'BusinessApplication',
			operatingSystem: 'Web',
			url: baseUrl,
			description: siteConfig.description,
			publisher: { '@id': organizationId },
			offers: {
				'@type': 'AggregateOffer',
				priceCurrency: 'USD',
				lowPrice: String(lowPrice),
				highPrice: String(highPrice),
				offerCount: String(pricingTiers.length),
			},
		},
	],
};

/** FAQPage structured data for the questions actually rendered on this page. */
const homeFaqJsonLd = {
	'@context': 'https://schema.org',
	'@type': 'FAQPage',
	mainEntity: homeFaqTeasers.map((entry) => ({
		'@type': 'Question',
		name: entry.question,
		acceptedAnswer: { '@type': 'Answer', text: entry.answer },
	})),
};

export default function HomePage() {
	return (
		<>
			<AnnouncementBar />
			<SiteNav />
			<main id="main">
				<Hero />
				<ProblemSection />
				<IndustriesSection />
				<HowItWorks />
				<FeaturesSection />
				<OnboardingSection />
				<CrossPlatform />
				<FoundingCustomers />
				<Pricing />
				<FinalCta />
			</main>
			<SiteFooter />
			<JsonLd data={homeJsonLd} />
			<JsonLd data={homeFaqJsonLd} />
		</>
	);
}
