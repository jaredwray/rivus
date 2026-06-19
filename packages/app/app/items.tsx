import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Item } from '@/src/api/client';
import { createApiClient } from '@/src/api/client';
import { getApiBaseUrl } from '@/src/api/config';

type LoadState =
	| { kind: 'loading' }
	| { kind: 'error'; message: string }
	| { kind: 'ready'; items: Item[] };

// The items endpoint is authenticated. A real app would read this from secure
// storage after login; for this slice we accept it from a public env var so the
// screen is demoable end-to-end against a running API.
function getDemoToken(): string {
	return process.env.EXPO_PUBLIC_DEMO_TOKEN ?? '';
}

export default function ItemsScreen() {
	const insets = useSafeAreaInsets();
	const [state, setState] = useState<LoadState>({ kind: 'loading' });
	const [refreshing, setRefreshing] = useState(false);
	// Ignore a late response after unmount or once superseded.
	const activeRef = useRef(true);

	useEffect(() => {
		activeRef.current = true;
		return () => {
			activeRef.current = false;
		};
	}, []);

	const load = useCallback(async () => {
		const token = getDemoToken();
		if (token.length === 0) {
			if (activeRef.current) {
				setState({
					kind: 'error',
					message: 'Sign in required. Set EXPO_PUBLIC_DEMO_TOKEN to preview real items.',
				});
			}
			return;
		}

		try {
			const client = createApiClient(getApiBaseUrl());
			const { data } = await client.listItems(token);
			if (activeRef.current) {
				setState({ kind: 'ready', items: data });
			}
		} catch (error) {
			if (activeRef.current) {
				setState({
					kind: 'error',
					message: error instanceof Error ? error.message : 'Failed to load items.',
				});
			}
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const onRefresh = useCallback(async () => {
		setRefreshing(true);
		await load();
		if (activeRef.current) {
			setRefreshing(false);
		}
	}, [load]);

	if (state.kind === 'loading') {
		return (
			<View style={styles.centered}>
				<ActivityIndicator size="large" color="#6366f1" />
				<Text style={styles.muted}>Loading items…</Text>
			</View>
		);
	}

	if (state.kind === 'error') {
		return (
			<View style={styles.centered}>
				<Text style={styles.errorTitle}>Could not load items</Text>
				<Text style={styles.muted}>{state.message}</Text>
			</View>
		);
	}

	return (
		<FlatList
			data={state.items}
			keyExtractor={(item) => item.id}
			contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
			refreshControl={
				<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
			}
			ListEmptyComponent={
				<View style={styles.centered}>
					<Text style={styles.errorTitle}>No items yet</Text>
					<Text style={styles.muted}>Create one from the API to see it here.</Text>
				</View>
			}
			renderItem={({ item }) => (
				<View style={styles.card}>
					<View style={styles.cardHeader}>
						<Text style={styles.cardTitle}>{item.name}</Text>
						<Text
							style={[
								styles.badge,
								item.status === 'active' ? styles.badgeActive : styles.badgeArchived,
							]}
						>
							{item.status}
						</Text>
					</View>
					{item.description.length > 0 ? (
						<Text style={styles.muted}>{item.description}</Text>
					) : null}
				</View>
			)}
		/>
	);
}

const styles = StyleSheet.create({
	centered: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		padding: 24,
		gap: 8,
		backgroundColor: '#0f172a',
	},
	list: {
		padding: 16,
		gap: 12,
		flexGrow: 1,
		backgroundColor: '#0f172a',
	},
	card: {
		backgroundColor: '#1e293b',
		borderRadius: 12,
		padding: 16,
		gap: 8,
	},
	cardHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: 12,
	},
	cardTitle: {
		fontSize: 18,
		fontWeight: '700',
		color: '#f8fafc',
		flexShrink: 1,
	},
	badge: {
		fontSize: 12,
		fontWeight: '600',
		textTransform: 'uppercase',
		paddingVertical: 4,
		paddingHorizontal: 8,
		borderRadius: 999,
		overflow: 'hidden',
	},
	badgeActive: {
		backgroundColor: '#065f46',
		color: '#d1fae5',
	},
	badgeArchived: {
		backgroundColor: '#374151',
		color: '#d1d5db',
	},
	errorTitle: {
		fontSize: 18,
		fontWeight: '700',
		color: '#f8fafc',
	},
	muted: {
		fontSize: 14,
		color: '#94a3b8',
		textAlign: 'center',
	},
});
