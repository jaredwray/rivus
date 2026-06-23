/**
 * Plain-language legal content for the Rivus marketing site. Each document is a
 * list of sections; sections are made of text blocks and bullet lists so a
 * single `LegalPage` component can render all three pages.
 *
 * These are starting-point policies tailored to what Rivus does; have counsel
 * review them before relying on them in production.
 */

export type LegalBlock = { kind: 'text'; text: string } | { kind: 'list'; items: string[] };

export interface LegalSection {
	heading: string;
	blocks: LegalBlock[];
}

export interface LegalDoc {
	slug: 'privacy' | 'terms' | 'security';
	eyebrow: string;
	title: string;
	updated: string;
	intro: string[];
	sections: LegalSection[];
	contactEmail: string;
}

const text = (value: string): LegalBlock => ({ kind: 'text', text: value });
const list = (...items: string[]): LegalBlock => ({ kind: 'list', items });

const UPDATED = 'June 23, 2026';

export const privacyDoc: LegalDoc = {
	slug: 'privacy',
	eyebrow: 'PRIVACY',
	title: 'Privacy Policy',
	updated: UPDATED,
	contactEmail: 'privacy@rivus.ai',
	intro: [
		'Rivus helps local businesses run their front office with an AI agent that answers calls, texts, emails, and messages, books jobs, and handles billing and marketing. This policy explains what information we collect, why, and what you can do about it — in plain language.',
		'It covers two groups: the business owners and teams who use Rivus ("customers"), and the people who contact those businesses and are helped by Rivus ("end customers"). Where the distinction matters, we call it out.',
	],
	sections: [
		{
			heading: 'Information we collect',
			blocks: [
				text(
					"We collect information you give us, information that flows through Rivus as it does its job, and a small amount that's gathered automatically:",
				),
				list(
					'Account information — your name, business name, email, phone number, and login credentials for the people on your team.',
					'Business content — the FAQs, services, pricing, availability, and brand voice you train Rivus on.',
					"Conversations — the calls, texts, emails, and chat messages Rivus handles for you, including recordings and transcripts where you've enabled them.",
					'Customer records — contact details and job history for the end customers you serve, including anything imported during onboarding.',
					'Billing and payment details — invoices, amounts, and payment status synced from your accounting tools. We do not store full card numbers; payments are handled by our payment partners.',
					'Usage and device data — log data, IP address, browser type, and how you use the app, gathered automatically to keep the service running and secure.',
				),
			],
		},
		{
			heading: 'How we use information',
			blocks: [
				text('We use information to provide Rivus and make it work well for you:'),
				list(
					'Answer and route conversations, book jobs, send reminders, and follow up on your behalf.',
					'Generate and send invoices, take payment, and answer billing questions through your connected accounts.',
					'Run and optimize the ads, review requests, and newsletters you ask Rivus to manage.',
					"Train Rivus on your business so its replies stay on-brand — using your own content, not other businesses' data.",
					'Keep the service secure, troubleshoot problems, and provide support — including your free onboarding specialist.',
					'Send you product and account updates, and improve Rivus over time.',
				),
			],
		},
		{
			heading: 'Automated calls, texts, and messages',
			blocks: [
				text(
					'Rivus communicates with your customers on your behalf. You direct what it sends and to whom, and you are responsible for having the consent the law requires before contacting those customers — including for automated calls and texts.',
				),
				text(
					'Message and data rates may apply to recipients. Recipients can opt out of texts at any time by replying STOP, and can reply HELP for help. We honor opt-outs and pass them through to you.',
				),
			],
		},
		{
			heading: 'How we share information',
			blocks: [
				text(
					"We do not sell your information or your customers' information. We share it only in these situations:",
				),
				list(
					'Service providers — telephony, messaging, email, hosting, analytics, and payment partners who process data on our behalf under contract.',
					'Integrations you connect — when you link accounting, calendar, ad, or review tools, we exchange data with them to do the work you asked for.',
					'Your own team — the people you invite to your Rivus account.',
					'Legal and safety — when required by law, or to protect the rights, safety, and property of Rivus, our customers, or the public.',
					'Business transfers — if Rivus is involved in a merger, acquisition, or sale of assets, with notice to you.',
				),
			],
		},
		{
			heading: 'Integrations and third parties',
			blocks: [
				text(
					"Rivus is more useful connected to the tools you already use. When you connect a third-party service, that service's own terms and privacy policy govern what it does with your data. You can disconnect an integration at any time from your settings.",
				),
			],
		},
		{
			heading: 'Data retention',
			blocks: [
				text(
					'We keep information for as long as your account is active and as long as we need it to provide the service, meet our legal obligations, resolve disputes, and enforce our agreements. When you close your account, we delete or de-identify your data within a reasonable period, except where we are required to keep it.',
				),
			],
		},
		{
			heading: 'Your choices and rights',
			blocks: [
				text(
					'Depending on where you live, you may have the right to access, correct, export, or delete personal information, and to object to or limit certain processing:',
				),
				list(
					'Account data — you can review and update most information directly in the app.',
					"Requests — to make a privacy request, email us and we'll respond as the law requires.",
					"End customers — if you're an end customer of a business that uses Rivus, that business controls your data; we'll route your request to them.",
					'Marketing — you can unsubscribe from our product emails at any time.',
				),
			],
		},
		{
			heading: 'Security',
			blocks: [
				text(
					'We protect your information with encryption in transit and at rest, access controls, and ongoing monitoring. No system is perfectly secure, but we work hard to keep yours safe. See our Security page for details.',
				),
			],
		},
		{
			heading: 'Cookies and analytics',
			blocks: [
				text(
					'Our website and app use cookies and similar technologies to keep you signed in, remember preferences, and understand how the product is used so we can improve it. You can control cookies through your browser settings.',
				),
			],
		},
		{
			heading: "Children's privacy",
			blocks: [
				text(
					"Rivus is built for businesses and isn't directed to children. We don't knowingly collect personal information from anyone under 16. If you believe a child has provided us information, contact us and we'll remove it.",
				),
			],
		},
		{
			heading: 'Changes to this policy',
			blocks: [
				text(
					"We'll update this policy as Rivus evolves. When we make material changes, we'll update the date above and, where appropriate, let you know in the app or by email.",
				),
			],
		},
		{
			heading: 'Contact us',
			blocks: [text('Questions about privacy? Email privacy@rivus.ai and we will help.')],
		},
	],
};

export const termsDoc: LegalDoc = {
	slug: 'terms',
	eyebrow: 'TERMS',
	title: 'Terms of Service',
	updated: UPDATED,
	contactEmail: 'legal@rivus.ai',
	intro: [
		'These terms are the agreement between you and Rivus for use of our websites, apps, and the Rivus AI agent (the "Service"). Please read them — by using Rivus, you agree to them.',
		"If you're using Rivus on behalf of a business, you're agreeing on that business's behalf and confirming you have the authority to do so.",
	],
	sections: [
		{
			heading: 'The Service',
			blocks: [
				text(
					'Rivus is an AI agent that helps you run your front office — answering calls, texts, emails, and messages, booking jobs, handling billing through your connected accounts, and managing reviews, ads, and newsletters. Features may change as we improve the product.',
				),
			],
		},
		{
			heading: 'Your account',
			blocks: [
				text(
					'You are responsible for your account, the people you invite to it, and keeping your login credentials secure. Tell us right away if you suspect unauthorized use. You must be at least 18 and able to enter into a contract to use Rivus.',
				),
			],
		},
		{
			heading: 'Free onboarding',
			blocks: [
				text(
					'Every plan includes setup help from a Rivus onboarding specialist who connects your tools and trains Rivus using the information you provide. You are responsible for the accuracy of that information and for reviewing how Rivus represents your business.',
				),
			],
		},
		{
			heading: 'Acceptable use',
			blocks: [
				text('You agree to use Rivus lawfully and not to misuse it. You will not:'),
				list(
					'Use Rivus to send spam or deceptive, harassing, or unlawful messages.',
					'Contact people without the consent the law requires.',
					'Violate the rules of any connected platform — for example carrier, email, ad, or review-site policies.',
					'Attempt to break, overload, reverse engineer, or gain unauthorized access to the Service.',
					'Use Rivus to handle data you have no right to share.',
				),
			],
		},
		{
			heading: 'The AI agent and your responsibility',
			blocks: [
				text(
					'Rivus automates communication and tasks on your behalf, but you remain responsible for what is sent from your accounts. Rivus can make mistakes, so you should review important messages, quotes, and bookings, and a human on your team can step in at any time. Do not rely on Rivus for advice that requires a licensed professional.',
				),
			],
		},
		{
			heading: 'Messaging and consent',
			blocks: [
				text(
					'When Rivus sends calls or texts to your customers, you confirm you have the consent the law requires to contact them, and that you will honor opt-out requests. Standard message and data rates may apply to recipients. You are responsible for the content of messages sent on your behalf.',
				),
			],
		},
		{
			heading: 'Third-party integrations',
			blocks: [
				text(
					'Rivus works with services like accounting tools, calendars, ad platforms, and review sites. Your use of those services is governed by their terms, and we are not responsible for them. If an integration changes or becomes unavailable, some features may stop working.',
				),
			],
		},
		{
			heading: 'Billing and subscriptions',
			blocks: [
				text(
					'Paid plans are billed in advance on a recurring basis until canceled, at the fees described when you sign up. Unless the law requires otherwise, fees are non-refundable. We may change pricing with advance notice; changes take effect at your next billing cycle. Payments from your customers to your business are processed by third-party payment partners, not by Rivus.',
				),
			],
		},
		{
			heading: 'Intellectual property',
			blocks: [
				text(
					'Rivus and its software, design, and brand belong to us. Your business content and your customers’ data belong to you — you grant us the limited license we need to operate the Service for you. Feedback you share with us may be used to improve Rivus.',
				),
			],
		},
		{
			heading: 'Disclaimers',
			blocks: [
				text(
					'The Service is provided "as is" and "as available." To the fullest extent permitted by law, we disclaim all warranties, including merchantability, fitness for a particular purpose, and non-infringement. We do not guarantee that Rivus will be uninterrupted or error-free, or that it will book every job or answer every message perfectly.',
				),
			],
		},
		{
			heading: 'Limitation of liability',
			blocks: [
				text(
					'To the fullest extent permitted by law, Rivus will not be liable for indirect, incidental, special, or consequential damages, or for lost profits, revenue, data, or goodwill. Our total liability for any claim is limited to the amount you paid us in the 12 months before the claim.',
				),
			],
		},
		{
			heading: 'Indemnification',
			blocks: [
				text(
					'You agree to defend and indemnify Rivus against claims arising from your use of the Service, the messages sent on your behalf, your content, or your violation of these terms or the law.',
				),
			],
		},
		{
			heading: 'Termination',
			blocks: [
				text(
					'You can cancel anytime. We may suspend or end your access if you violate these terms or use Rivus in a way that creates risk. The parts of these terms that should survive termination — like payment, disclaimers, and limitations — will.',
				),
			],
		},
		{
			heading: 'Governing law',
			blocks: [
				text(
					'These terms are governed by the laws of the State of Washington, U.S.A., without regard to its conflict-of-laws rules, and disputes will be handled in the courts located there, unless the law where you live requires otherwise.',
				),
			],
		},
		{
			heading: 'Changes to these terms',
			blocks: [
				text(
					"We may update these terms as Rivus changes. When we make material changes, we'll update the date above and let you know. Continuing to use Rivus after changes take effect means you accept them.",
				),
			],
		},
		{
			heading: 'Contact us',
			blocks: [text('Questions about these terms? Email legal@rivus.ai.')],
		},
	],
};

export const securityDoc: LegalDoc = {
	slug: 'security',
	eyebrow: 'SECURITY',
	title: 'Security at Rivus',
	updated: UPDATED,
	contactEmail: 'security@rivus.ai',
	intro: [
		'Rivus sits at the center of your front office — your conversations, your calendar, your customers, and your money flow through it. Protecting that trust is part of the product, not an afterthought. Here is how we keep your data safe.',
	],
	sections: [
		{
			heading: 'Encryption',
			blocks: [
				text(
					'We encrypt your data in transit with TLS and at rest with strong, industry-standard encryption. Connections between your device and our servers are encrypted, in the app and in the API.',
				),
			],
		},
		{
			heading: 'Infrastructure',
			blocks: [
				text(
					'Rivus runs on reputable cloud providers with physical and network security, redundancy, and continuous patching. We separate environments and limit what each part of the system can reach.',
				),
			],
		},
		{
			heading: 'Access controls',
			blocks: [
				text(
					'Access to production systems is restricted to the people who need it, protected by strong authentication and reviewed regularly. Within your account, you control who on your team can see and do what.',
				),
			],
		},
		{
			heading: 'How the AI agent handles your data',
			blocks: [
				text(
					"Rivus is trained on your business content to serve your business — your data helps you, and is not pooled to train a shared model on other companies' information. Sensitive actions, like sending invoices or messages, follow the rules and limits you set, and a human on your team can step in at any time.",
				),
			],
		},
		{
			heading: 'Payments',
			blocks: [
				text(
					'Payments are processed by established payment partners. Rivus does not store full card numbers; we work with PCI-compliant providers so sensitive payment details never sit on our servers.',
				),
			],
		},
		{
			heading: 'Integrations',
			blocks: [
				text(
					'When you connect a third-party tool, we use scoped, revocable access wherever possible, requesting only the permissions a feature needs. You can disconnect any integration from your settings at any time.',
				),
			],
		},
		{
			heading: 'Monitoring and incident response',
			blocks: [
				text(
					"We monitor our systems for unusual activity and maintain an incident-response plan. If a security incident affects your data, we'll act quickly to contain it and notify you as required by law.",
				),
			],
		},
		{
			heading: 'Backups and availability',
			blocks: [
				text(
					'We back up data regularly and design for resilience so your front office keeps running. No service is immune to downtime, but we work to keep Rivus available around the clock.',
				),
			],
		},
		{
			heading: 'Your part',
			blocks: [
				text(
					'Security is shared. Use a strong, unique password, turn on any available extra verification, keep your team’s access current, and only grant integrations you trust. Tell us right away if something looks off.',
				),
			],
		},
		{
			heading: 'Responsible disclosure',
			blocks: [
				text(
					"If you believe you've found a security vulnerability, we want to hear from you. Email security@rivus.ai with the details, and please give us a reasonable chance to fix it before sharing it publicly. We appreciate the security community's help.",
				),
			],
		},
		{
			heading: 'Contact us',
			blocks: [text('Security questions or reports? Email security@rivus.ai.')],
		},
	],
};

export const legalDocs: Record<LegalDoc['slug'], LegalDoc> = {
	privacy: privacyDoc,
	terms: termsDoc,
	security: securityDoc,
};
