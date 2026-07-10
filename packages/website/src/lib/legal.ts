/**
 * Plain-language legal content for the Rivus marketing site. Each document is a
 * list of sections; sections are made of text blocks and bullet lists so a
 * single `LegalPage` component can render all three pages.
 *
 * These are starting-point policies tailored to what Rivus does; have counsel
 * review them before relying on them in production.
 */

import { SMS_CONSENT_DISCLOSURE, SMS_MESSAGE_CATEGORIES, SMS_PROGRAM_NAME } from '@rivus/core';

export type LegalBlock = { kind: 'text'; text: string } | { kind: 'list'; items: string[] };

export interface LegalSection {
	heading: string;
	blocks: LegalBlock[];
}

export interface LegalDoc {
	slug: 'privacy' | 'terms' | 'security' | 'sms-terms' | 'sms-opt-in' | 'acceptable-use';
	eyebrow: string;
	title: string;
	updated: string;
	intro: string[];
	sections: LegalSection[];
	contactEmail: string;
}

const text = (value: string): LegalBlock => ({ kind: 'text', text: value });
const list = (...items: string[]): LegalBlock => ({ kind: 'list', items });

const UPDATED = 'July 10, 2026';

/**
 * The SMS program's carrier-compliance copy lives in @rivus/core so this
 * site and the product app (which shows the consent where phone numbers are
 * actually collected) can never drift apart. Re-exported for the compliance
 * tests that guard these pages.
 */
export { SMS_MESSAGE_CATEGORIES, SMS_PROGRAM_NAME };

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
			heading: 'Mobile information and text messaging',
			blocks: [
				text(
					`When you provide your mobile phone number and opt in to receive SMS text messages from Rivus (the "${SMS_PROGRAM_NAME}" program), we use your mobile information to send you ${SMS_MESSAGE_CATEGORIES}. Mobile phone numbers and SMS opt-in data are used solely by Rivus and our communications service providers for the limited purpose of delivering the messages you have requested. Our [SMS Messaging Terms](/sms-terms) describe the program in full.`,
				),
				text(
					'No mobile information will be shared with third parties or affiliates for marketing or promotional purposes. Information sharing with subcontractors in support services, such as customer service, is permitted. All other categories of personal information described in this Privacy Policy exclude text messaging originator opt-in data and consent; this information will not be shared with any third parties or affiliates.',
				),
				text(
					'We do not share, sell, rent, lease, or otherwise provide your mobile phone number or messaging consent information to any third parties or affiliates for marketing or promotional purposes.',
				),
				text(
					'Message frequency varies based on your account activity and preferences. Message and data rates may apply. You may opt out of receiving SMS messages at any time by replying **STOP** to any message we send you; for help, reply **HELP** or contact us at support@rivus.ai.',
				),
			],
		},
		{
			heading: 'Automated calls and messages sent for businesses',
			blocks: [
				text(
					'Rivus also communicates with your customers on your behalf. You direct what it sends and to whom, and you are responsible for having the consent the law requires before contacting those customers — including for automated calls and texts.',
				),
				text(
					'Message and data rates may apply to recipients. Recipients can opt out of texts at any time by replying STOP, and can reply HELP for help. We honor opt-outs and pass them through to you. The same protections above apply to the mobile information of the people your business serves: it is never shared with third parties or affiliates for marketing or promotional purposes.',
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
				text(
					'You agree to use Rivus lawfully and not to misuse it. Our [Acceptable Use Policy](/acceptable-use) is part of these terms and spells out the rules — including the content carriers prohibit in text messages. In short, you will not:',
				),
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
				text(
					'Text messages sent through Rivus are governed by our [SMS Messaging Terms](/sms-terms), which are incorporated into these terms by reference. Recipients can opt out at any time by replying **STOP** and get help by replying **HELP**. Consent collected for one business or program is not transferable to another.',
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

export const smsTermsDoc: LegalDoc = {
	slug: 'sms-terms',
	eyebrow: 'SMS TERMS',
	title: 'SMS Messaging Terms',
	updated: UPDATED,
	contactEmail: 'support@rivus.ai',
	intro: [
		`These terms govern the text messages sent through Rivus. They cover two programs: messages Rivus sends you about your own account (the "${SMS_PROGRAM_NAME}" program), and messages a business you patronize sends you through its Rivus agent. They sit alongside our [Terms of Service](/terms) and [Privacy Policy](/privacy).`,
	],
	sections: [
		{
			heading: 'Program name and description',
			blocks: [
				text(
					`${SMS_PROGRAM_NAME}: by opting in, you agree to receive recurring automated text messages from Rivus at the mobile number you provided, including ${SMS_MESSAGE_CATEGORIES}.`,
				),
				text(
					'When a business you work with uses Rivus, the same kinds of messages — appointment confirmations and reminders, scheduling replies, quotes, invoices and receipts, review requests, and answers to your questions — are sent by that business through Rivus, using the consent you gave that business. See [How you opt in](/sms-opt-in) for details on both programs.',
				),
			],
		},
		{
			heading: 'Cancellation (opting out)',
			blocks: [
				text(
					'**You can cancel the SMS service at any time by replying STOP to any message you receive from us.** After you send STOP, we will send you one final message to confirm that you have been unsubscribed; after that, you will receive no further messages from that program. We also honor STOPALL, UNSUBSCRIBE, OPTOUT, CANCEL, END, REVOKE, and QUIT.',
				),
				text(
					'Opting out applies per program: replying STOP to a business that messages you through Rivus stops that business, and replying STOP to a Rivus account notification stops Rivus account texts. If you want to join again, just sign up as you did the first time and we will start sending SMS messages to you again.',
				),
			],
		},
		{
			heading: 'Help and support',
			blocks: [
				text(
					'If you are experiencing issues with the messaging program, **reply HELP to any message** for assistance, or contact us directly at support@rivus.ai.',
				),
			],
		},
		{
			heading: 'Message frequency and rates',
			blocks: [
				text(
					'Message frequency varies based on your account activity, appointments, and notification preferences. As always, message and data rates may apply for any messages sent to you from us and to us from you. If you have any questions about your text plan or data plan, it is best to contact your wireless provider.',
				),
			],
		},
		{
			heading: 'Supported carriers',
			blocks: [
				text(
					'The program is supported on major U.S. carriers, including AT&T, T-Mobile, Verizon, and others. Carriers are not liable for delayed or undelivered messages.',
				),
			],
		},
		{
			heading: 'Your mobile information',
			blocks: [
				text(
					'Mobile information collected through the SMS program is not shared with third parties or affiliates for marketing or promotional purposes. For details on how we handle your data, read our [Privacy Policy](/privacy).',
				),
			],
		},
		{
			heading: 'WhatsApp messaging',
			blocks: [
				text(
					'If you opt in to receive WhatsApp messages, you are opting in to receive communications from Rivus (or from the business you patronize, sent through Rivus) on WhatsApp. You can opt out of WhatsApp messages at any time by replying STOP or updating your notification preferences.',
				),
			],
		},
		{
			heading: 'Changes to these terms',
			blocks: [
				text(
					"We may update these SMS terms as the program evolves. When we make material changes, we'll update the date above. Continuing to receive messages after changes take effect means you accept them.",
				),
			],
		},
		{
			heading: 'Contact us',
			blocks: [text('Questions about text messages from Rivus? Email support@rivus.ai.')],
		},
	],
};

export const smsOptInDoc: LegalDoc = {
	slug: 'sms-opt-in',
	eyebrow: 'SMS PROGRAM',
	title: 'Text messages from Rivus: how you opt in',
	updated: UPDATED,
	contactEmail: 'support@rivus.ai',
	intro: [
		`This page describes how people give consent to receive text messages sent through Rivus — both the "${SMS_PROGRAM_NAME}" program (messages from Rivus about your own account) and the messages businesses send through Rivus — exactly what they agree to, and how to stop at any time. You will only ever get texts through Rivus because you asked for them.`,
	],
	sections: [
		{
			heading: 'How Rivus customers opt in',
			blocks: [
				text(
					'If you run a business on Rivus, you opt in by providing your mobile phone number where the app collects it — during signup or in your account settings. This consent is disclosed right at the phone field, on its own (never pre-selected, never buried in other terms):',
				),
				text(`"${SMS_CONSENT_DISCLOSURE}"`),
			],
		},
		{
			heading: "How a business's customers opt in",
			blocks: [
				text(
					'If you are a customer of a business that uses Rivus, that business may text you through Rivus only with your consent. You opt in when you:',
				),
				list(
					'Text the business first — Rivus replies in the same conversation you started.',
					'Provide your phone number on the business\'s booking or "join as a customer" form, which discloses that you agree to be texted and links these terms.',
					'Ask the business, in person or on a call, to send you appointment texts.',
				),
				text(
					'Consent applies to that business only — it is never transferred to another business or program. Every message flow includes opt-out instructions, and consent is never a condition of purchase.',
				),
			],
		},
		{
			heading: 'SMS program terms',
			blocks: [
				list(
					`Program name: ${SMS_PROGRAM_NAME}.`,
					`Messages you may receive: ${SMS_MESSAGE_CATEGORIES}.`,
					'Message frequency: varies based on your account activity, appointments, and preferences.',
					"Cost: message and data rates may apply. Your carrier's standard messaging and data rates apply to all messages.",
					'Help: reply HELP to any message, or email support@rivus.ai.',
					'Cancellation: reply STOP to any message to unsubscribe at any time; we send one final confirmation message.',
					'Carriers: supported on major U.S. carriers including AT&T, T-Mobile, Verizon, and others. Carriers are not liable for delayed or undelivered messages.',
					'Privacy: mobile information and SMS opt-in data are never shared with third parties or affiliates for marketing or promotional purposes.',
				),
				text(
					'The full program terms are in our [SMS Messaging Terms](/sms-terms), and our [Privacy Policy](/privacy) covers how we handle your data.',
				),
			],
		},
		{
			heading: 'Contact us',
			blocks: [text('Questions about opting in or out? Email support@rivus.ai.')],
		},
	],
};

export const acceptableUseDoc: LegalDoc = {
	slug: 'acceptable-use',
	eyebrow: 'ACCEPTABLE USE',
	title: 'Acceptable Use Policy',
	updated: UPDATED,
	contactEmail: 'legal@rivus.ai',
	intro: [
		'Rivus sends real messages to real people on your behalf — over phone calls, SMS, email, and WhatsApp. That only works if every business on Rivus plays by the same rules: the law, carrier and platform policies, and plain respect for the people you message. This policy is part of our [Terms of Service](/terms).',
	],
	sections: [
		{
			heading: 'The short version',
			blocks: [
				text(
					"Message people who asked to hear from you, about the things they asked to hear about, and stop the moment they say stop. If you would be annoyed to receive it, don't send it.",
				),
			],
		},
		{
			heading: 'Consent comes first',
			blocks: [
				list(
					'Only contact people who have given you the consent the law requires — for automated texts and calls, that means prior express consent, and for marketing, prior express written consent.',
					'Keep records of when and how each person opted in.',
					'Honor opt-outs immediately. Rivus processes STOP and related keywords automatically, and you may not message someone who has opted out.',
					'Identify your business in the messages you send.',
					'Never buy, rent, or share contact lists, and never transfer consent from one business or program to another.',
				),
			],
		},
		{
			heading: 'Prohibited content',
			blocks: [
				text(
					'Wireless carriers prohibit certain content on their networks outright. You may not use Rivus messaging in connection with:',
				),
				list(
					'Sex, hate, alcohol, firearms, or tobacco content ("SHAFT"), including vaping.',
					'Cannabis, CBD, or illegal drugs of any kind.',
					'Gambling, sweepstakes, or contests.',
					'Payday loans, third-party debt collection, or debt-relief services.',
					'Get-rich-quick schemes, multi-level marketing, or deceptive offers.',
					'Third-party lead generation or the resale of contact data.',
					'Phishing, fraud, malware, or any unlawful content.',
				),
			],
		},
		{
			heading: 'Prohibited behavior',
			blocks: [
				list(
					'No spam: unsolicited bulk messaging, snowshoeing across numbers, or evading carrier filtering.',
					'No misleading sender identity — messages must come from your business, about your business.',
					'No burying consent inside unrelated terms or pre-checked boxes.',
					'No harassing, threatening, or abusive conversations, even with people who opted in.',
					'No interfering with the Service itself — probing, overloading, or accessing accounts that are not yours.',
				),
			],
		},
		{
			heading: 'Enforcement',
			blocks: [
				text(
					'We monitor for abuse and investigate reports. Violations can lead to warnings, message blocking, suspension, or termination of your account, depending on severity — and carriers may independently filter or block traffic that breaks their rules. Where the law requires it, we may also report activity to authorities.',
				),
			],
		},
		{
			heading: 'Reporting abuse',
			blocks: [
				text(
					'If you received a message sent through Rivus that you believe violates this policy, email legal@rivus.ai with the details (sender, number, and message) and we will investigate.',
				),
			],
		},
	],
};

export const legalDocs: Record<LegalDoc['slug'], LegalDoc> = {
	privacy: privacyDoc,
	terms: termsDoc,
	security: securityDoc,
	'sms-terms': smsTermsDoc,
	'sms-opt-in': smsOptInDoc,
	'acceptable-use': acceptableUseDoc,
};
