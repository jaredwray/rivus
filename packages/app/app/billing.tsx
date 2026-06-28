import { Redirect } from 'expo-router';

/**
 * Billing has moved into the Settings screen as a "Plan & billing" section.
 * Keep this route as a redirect so existing links and bookmarks to /billing
 * still land in the right place.
 */
export default function BillingScreen() {
	return <Redirect href="/settings" />;
}
