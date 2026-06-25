import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { ApiError, type Billing } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { Card, Pill, SectionLabel, Txt } from '@/src/components/ui';
import { colors, font } from '@/src/theme/tokens';

const PLAN_LABELS: Record<Billing['plan'], string> = {
	free: 'Free',
};

export default function BillingScreen() {
	const { session, client } = useAuth();
	const token = session?.token;
	const isOwner = session?.role === 'owner';

	const [billing, setBilling] = useState<Billing | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!token || !isOwner) {
			setLoading(false);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			setBilling(await client.getBilling(token));
		} catch (caught) {
			setError(caught instanceof ApiError ? caught.message : 'Could not load billing.');
		} finally {
			setLoading(false);
		}
	}, [client, token, isOwner]);

	useEffect(() => {
		load();
	}, [load]);

	if (!session) {
		return null;
	}

	if (!isOwner) {
		return (
			<ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
				<Txt style={styles.h1}>Billing</Txt>
				<Card style={styles.card}>
					<Txt style={styles.rowSub}>
						Only the account Owner can view or manage billing. Ask an Owner if you need access.
					</Txt>
				</Card>
			</ScrollView>
		);
	}

	return (
		<ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
			<Txt style={styles.h1}>Billing</Txt>
			<Txt style={styles.subtitle}>Your plan and usage for {session.account.name}.</Txt>

			<Card style={styles.card}>
				<SectionLabel>Current plan</SectionLabel>
				{loading ? (
					<ActivityIndicator color={colors.brandPurple} style={styles.loading} />
				) : error ? (
					<Txt style={styles.errorTxt}>{error}</Txt>
				) : billing ? (
					<>
						<View style={styles.planRow}>
							<Txt style={styles.plan}>{PLAN_LABELS[billing.plan]}</Txt>
							<Pill
								label={billing.status === 'active' ? 'Active' : 'Canceled'}
								color={colors.brandPurpleInk}
								background="rgba(110,30,200,0.08)"
							/>
						</View>
						<View style={styles.statRow}>
							<Txt style={styles.statLabel}>Seats in use</Txt>
							<Txt style={styles.statValue}>{billing.seats}</Txt>
						</View>
						<Txt style={styles.note}>
							Paid plans aren’t available yet — every account is on the free plan while we finish
							wiring up billing.
						</Txt>
					</>
				) : null}
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
		gap: 12,
	},
	loading: {
		paddingVertical: 12,
	},
	planRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	plan: {
		fontFamily: font.bold,
		fontSize: 20,
		color: colors.text,
	},
	statRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		borderTopWidth: 1,
		borderTopColor: colors.border,
		paddingTop: 12,
	},
	statLabel: {
		fontFamily: font.regular,
		fontSize: 13,
		color: colors.textMuted,
	},
	statValue: {
		fontFamily: font.semibold,
		fontSize: 15,
		color: colors.text,
	},
	rowSub: {
		fontFamily: font.regular,
		fontSize: 12.5,
		color: colors.textMuted,
	},
	errorTxt: {
		fontFamily: font.medium,
		fontSize: 12.5,
		color: colors.redInk,
	},
	note: {
		fontFamily: font.regular,
		fontSize: 12,
		color: colors.textFaint,
	},
});
