import { LegalPage } from '../components/marketing/legal-page';
import {
	acceptableUseDoc,
	privacyDoc,
	securityDoc,
	smsOptInDoc,
	smsTermsDoc,
	termsDoc,
} from '../lib/legal';

export function PrivacyPage() {
	return <LegalPage doc={privacyDoc} />;
}

export function TermsPage() {
	return <LegalPage doc={termsDoc} />;
}

export function SecurityPage() {
	return <LegalPage doc={securityDoc} />;
}

export function SmsTermsPage() {
	return <LegalPage doc={smsTermsDoc} />;
}

export function SmsOptInPage() {
	return <LegalPage doc={smsOptInDoc} />;
}

export function AcceptableUsePage() {
	return <LegalPage doc={acceptableUseDoc} />;
}
