import { AnnouncementBar } from '../components/marketing/announcement-bar';
import { CrossPlatform } from '../components/marketing/cross-platform';
import { FeaturesSection } from '../components/marketing/features-section';
import { FinalCta } from '../components/marketing/final-cta';
import { Hero } from '../components/marketing/hero';
import { HowItWorks } from '../components/marketing/how-it-works';
import { OnboardingSection } from '../components/marketing/onboarding-section';
import { Pricing } from '../components/marketing/pricing';
import { ProblemSection } from '../components/marketing/problem-section';
import { SiteFooter } from '../components/marketing/site-footer';
import { SiteNav } from '../components/marketing/site-nav';
import { Testimonials } from '../components/marketing/testimonials';

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
				<Testimonials />
				<Pricing />
				<FinalCta />
			</main>
			<SiteFooter />
		</>
	);
}
