import { describe, expect, it } from 'vitest';
import {
	SMS_CONSENT_DISCLOSURE,
	SMS_MESSAGE_CATEGORIES,
	SMS_PRIVACY_URL,
	SMS_PROGRAM_NAME,
	SMS_TERMS_URL,
} from './sms-consent';

/**
 * Carrier-audit guards (Twilio A2P 10DLC, Plivo/TCR): the consent disclosure
 * must carry each of these elements verbatim, and the surfaces that embed it
 * rely on the enumeration staying identical. Failing one of these is a
 * compliance regression, not a copy tweak.
 */
describe('sms consent copy', () => {
	it('discloses every element carrier vetting requires', () => {
		for (const required of [
			'recurring automated text messages',
			SMS_MESSAGE_CATEGORIES,
			'Consent is not a condition of purchase',
			'Message frequency varies',
			'Message and data rates may apply',
			'Reply HELP for help',
			'Reply STOP to unsubscribe',
		]) {
			expect(SMS_CONSENT_DISCLOSURE).toContain(required);
		}
	});

	it('names the registered program', () => {
		expect(SMS_PROGRAM_NAME).toBe('Rivus Notifications & Reminders');
	});

	it('links the legal pages on the production marketing domain over https', () => {
		expect(SMS_TERMS_URL).toBe('https://rivus.ai/sms-terms');
		expect(SMS_PRIVACY_URL).toBe('https://rivus.ai/privacy');
	});
});
