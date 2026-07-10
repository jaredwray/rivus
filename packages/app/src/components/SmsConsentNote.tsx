import { SMS_CONSENT_DISCLOSURE, SMS_PRIVACY_URL, SMS_TERMS_URL } from '@rivus/core';
import { Linking, StyleSheet } from 'react-native';
import { Txt } from '@/src/components/ui';
import { colors, font } from '@/src/theme/tokens';

/**
 * The carrier-required SMS consent disclosure, rendered directly under any
 * field that collects a mobile number from a Rivus customer (signup, account
 * settings). Carrier vetting (Twilio A2P 10DLC, Plivo/TCR) verifies that this
 * exact language — shared via @rivus/core with the marketing site's opt-in
 * page — appears at the point of collection, alongside links to the SMS
 * terms and privacy policy.
 */
export function SmsConsentNote() {
	return (
		<Txt style={styles.note}>
			{SMS_CONSENT_DISCLOSURE} See our{' '}
			<Txt
				accessibilityRole="link"
				style={styles.link}
				onPress={() => Linking.openURL(SMS_TERMS_URL)}
			>
				SMS terms
			</Txt>{' '}
			and{' '}
			<Txt
				accessibilityRole="link"
				style={styles.link}
				onPress={() => Linking.openURL(SMS_PRIVACY_URL)}
			>
				privacy policy
			</Txt>
			.
		</Txt>
	);
}

const styles = StyleSheet.create({
	note: {
		fontFamily: font.regular,
		fontSize: 11.5,
		lineHeight: 16,
		color: colors.textFaint,
	},
	link: {
		fontFamily: font.semibold,
		fontSize: 11.5,
		lineHeight: 16,
		color: colors.brandPurple,
	},
});
