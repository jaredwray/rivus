import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	acceptableUseDoc,
	type LegalDoc,
	legalDocs,
	privacyDoc,
	SMS_MESSAGE_CATEGORIES,
	securityDoc,
	smsOptInDoc,
	smsTermsDoc,
	termsDoc,
} from '../lib/legal';
import AcceptableUsePage from './acceptable-use/page';
import PrivacyPage from './privacy/page';
import SecurityPage from './security/page';
import SmsOptInPage from './sms-opt-in/page';
import SmsTermsPage from './sms-terms/page';
import TermsPage from './terms/page';

beforeEach(() => {
	// The shared footer mounts ApiStatus, which fetches on mount; hold it pending.
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise<Response>(() => {})),
	);
});

const pages = [
	{ name: 'privacy', Page: PrivacyPage, doc: privacyDoc },
	{ name: 'terms', Page: TermsPage, doc: termsDoc },
	{ name: 'security', Page: SecurityPage, doc: securityDoc },
	{ name: 'sms-terms', Page: SmsTermsPage, doc: smsTermsDoc },
	{ name: 'sms-opt-in', Page: SmsOptInPage, doc: smsOptInDoc },
	{ name: 'acceptable-use', Page: AcceptableUsePage, doc: acceptableUseDoc },
];

describe('legal pages', () => {
	it.each(pages)('$name renders its title, every section, and a contact link', ({ Page, doc }) => {
		render(<Page />);
		expect(screen.getByRole('heading', { level: 1, name: doc.title })).toBeTruthy();
		for (const section of doc.sections) {
			expect(screen.getByRole('heading', { level: 2, name: section.heading })).toBeTruthy();
		}
		expect(screen.getByRole('link', { name: doc.contactEmail }).getAttribute('href')).toBe(
			`mailto:${doc.contactEmail}`,
		);
	});

	it('serves a document for every slug with a rivus.ai contact email', () => {
		const slugs = Object.keys(legalDocs) as LegalDoc['slug'][];
		expect(slugs).toHaveLength(6);
		for (const slug of slugs) {
			expect(legalDocs[slug].slug).toBe(slug);
			expect(legalDocs[slug].contactEmail).toMatch(/@rivus\.ai$/);
			expect(legalDocs[slug].sections.length).toBeGreaterThan(0);
		}
	});
});

/**
 * Carrier-audit guards. Twilio (A2P 10DLC campaign vetting, errors 30908 and
 * 30932) and Plivo/TCR reject registrations whose public site lacks these
 * exact disclosures, so losing any of them is a compliance regression, not a
 * copy tweak.
 */
describe('carrier compliance language', () => {
	const docText = (doc: LegalDoc): string =>
		JSON.stringify(doc.sections) + JSON.stringify(doc.intro);

	it('privacy policy carries the mobile no-sharing clauses', () => {
		const textContent = docText(privacyDoc);
		expect(textContent).toContain(
			'No mobile information will be shared with third parties or affiliates for marketing or promotional purposes.',
		);
		expect(textContent).toContain(
			'exclude text messaging originator opt-in data and consent; this information will not be shared with any third parties or affiliates',
		);
		expect(textContent).toContain('Message frequency varies');
		expect(textContent).toContain('Message and data rates may apply');
	});

	it('sms terms carry every mandatory program disclosure', () => {
		const textContent = docText(smsTermsDoc);
		expect(textContent).toContain('replying STOP');
		expect(textContent).toContain('reply HELP to any message');
		expect(textContent).toContain('message and data rates may apply');
		expect(textContent).toContain('Message frequency varies');
		expect(textContent).toContain('Carriers are not liable for delayed or undelivered messages');
		expect(textContent).toContain('[Privacy Policy](/privacy)');
	});

	it('opt-in page states consent is not a condition of purchase', () => {
		const textContent = docText(smsOptInDoc);
		expect(textContent).toContain('Consent is not a condition of purchase');
		expect(textContent).toContain('Reply STOP to unsubscribe');
		expect(textContent).toContain('Reply HELP for help');
	});

	it('keeps the message-category enumeration identical across every surface', () => {
		for (const doc of [privacyDoc, smsTermsDoc, smsOptInDoc]) {
			expect(docText(doc)).toContain(SMS_MESSAGE_CATEGORIES);
		}
	});

	it('acceptable use prohibits the carrier-forbidden content categories', () => {
		const textContent = docText(acceptableUseDoc);
		for (const category of ['SHAFT', 'Cannabis', 'Gambling', 'Payday loans', 'lead generation']) {
			expect(textContent).toContain(category);
		}
	});
});
