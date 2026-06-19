import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function HomeScreen() {
	const insets = useSafeAreaInsets();

	return (
		<View style={[styles.container, { paddingBottom: insets.bottom }]}>
			<View style={styles.hero}>
				<Text style={styles.title}>Rivus</Text>
				<Text style={styles.tagline}>A modern product platform — on every screen.</Text>
			</View>

			<Link href="/items" style={styles.button}>
				<Text style={styles.buttonLabel}>Browse items →</Text>
			</Link>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		padding: 24,
		gap: 32,
		backgroundColor: '#0f172a',
	},
	hero: {
		alignItems: 'center',
		gap: 12,
	},
	title: {
		fontSize: 48,
		fontWeight: '800',
		color: '#f8fafc',
		letterSpacing: 1,
	},
	tagline: {
		fontSize: 16,
		color: '#94a3b8',
		textAlign: 'center',
	},
	button: {
		backgroundColor: '#6366f1',
		paddingVertical: 14,
		paddingHorizontal: 28,
		borderRadius: 12,
	},
	buttonLabel: {
		color: '#ffffff',
		fontSize: 16,
		fontWeight: '600',
	},
});
