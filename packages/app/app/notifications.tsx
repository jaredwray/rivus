import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { useAuth } from '@/src/auth/AuthContext';
import { Card, Txt } from '@/src/components/ui';
import { NotificationsView } from '@/src/notifications/NotificationsView';
import { colors, font } from '@/src/theme/tokens';

export default function NotificationsScreen() {
	const router = useRouter();
	const { session } = useAuth();

	if (!session) {
		return null;
	}

	return (
		<ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
			<Txt style={styles.h1}>Notifications</Txt>
			<Txt style={styles.subtitle}>
				Jobs, invites, and account activity that need your attention.
			</Txt>

			<Card style={styles.card}>
				<NotificationsView onNavigate={(href) => router.push(href)} />
			</Card>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	content: {
		padding: 26,
		gap: 16,
		maxWidth: 760,
		width: '100%',
		alignSelf: 'center',
	},
	h1: {
		fontFamily: font.bold,
		fontSize: 22,
		color: colors.text,
	},
	subtitle: {
		fontFamily: font.regular,
		fontSize: 13.5,
		color: colors.textMuted,
		marginTop: -8,
	},
	card: {
		paddingVertical: 6,
	},
});
