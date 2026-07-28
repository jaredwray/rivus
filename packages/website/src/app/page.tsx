import type { Metadata } from 'next';
import { AnnouncementBar } from '../components/marketing/announcement-bar';
import { CrossPlatform } from '../components/marketing/cross-platform';
import { FeaturesSection } from '../components/marketing/features-section';
import { FinalCta } from '../components/marketing/final-cta';
import { FoundingCustomers } from '../components/marketing/founding-customers';
import { Hero } from '../components/marketing/hero';
import { HowItWorks } from '../components/marketing/how-it-works';
import { JsonLd } from '../components/marketing/json-ld';
import { OnboardingSection } from '../components/marketing/onboarding-section';
import { Pricing } from '../components/marketing/pricing';
import { ProblemSection } from '../components/marketing/problem-section';
import { SiteFooter } from '../components/marketing/site-footer';
import { SiteNav } from '../components/marketing/site-nav';
import { siteConfig } from '../lib/site';
import { baseUrl } from './sitemap';

export const metadata: Metadata = {
	alternates: { canonical: '/' },
};

/**
 * Organization + WebSite structured data for the home page, built from the
 * same site config the visible copy uses.
 */
const organizationJsonLd = {
	'@context': 'https://schema.org',
	'@graph': [
		{
			'@type': 'Organization',
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
		},
	],
};

export default function HomePage() {
	return (
		<>
			<AnnouncementBar />
			<SiteNav />
			<main id="main">
				<Hero />
				<ProblemSection />
				<HowItWorks />
				<FeaturesSection />
				<OnboardingSection />
				<CrossPlatform />
				<FoundingCustomers />
				<Pricing />
				<FinalCta />
			</main>
			<SiteFooter />
			<JsonLd data={organizationJsonLd} />
		</>
	);
}
