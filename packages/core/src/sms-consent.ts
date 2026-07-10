/**
 * The single source of truth for the Rivus SMS program's carrier-compliance
 * copy. Twilio (A2P 10DLC) and Plivo/TCR vetting expect the program name, the
 * message-category enumeration, and the consent disclosure to be *identical*
 * on every surface that shows them — the marketing site's privacy policy, SMS
 * terms, and opt-in pages, and the product forms that actually collect a
 * phone number. Both the website and the app import these values so the
 * surfaces cannot drift.
 */

/** The program name registered with carriers. */
export const SMS_PROGRAM_NAME = 'Rivus Notifications & Reminders';

/** What subscribers may receive — enumerated identically everywhere. */
export const SMS_MESSAGE_CATEGORIES =
	'account and phone verification codes, appointment and service reminders, scheduling replies, invoice and billing notifications, review requests, and other notifications you have requested';

/**
 * The canonical consent disclosure, shown wherever Rivus collects a mobile
 * number from its own customers. Contains every element carrier vetting
 * checks for: recurring-automated-messages consent, the category list,
 * consent-not-a-condition-of-purchase, frequency, rates, HELP, and STOP.
 */
export const SMS_CONSENT_DISCLOSURE = `By providing your mobile phone number, you agree to receive recurring automated text messages from Rivus at the number provided, including ${SMS_MESSAGE_CATEGORIES}. Consent is not a condition of purchase. Message frequency varies. Message and data rates may apply. Reply HELP for help. Reply STOP to unsubscribe at any time.`;

/** Marketing-site URLs of the SMS legal pages, linked next to the consent. */
export const SMS_TERMS_URL = 'https://rivus.ai/sms-terms';
export const SMS_PRIVACY_URL = 'https://rivus.ai/privacy';
