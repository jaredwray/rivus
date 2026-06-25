import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import {
	ApiError,
	type Invite,
	type InviteSummary,
	type Member,
	type Role,
} from '@/src/api/client';
import { initialsOf, roleLabel, useAuth } from '@/src/auth/AuthContext';
import {
	Avatar,
	Card,
	GradientButton,
	Pill,
	SectionLabel,
	Segmented,
	TextField,
	Txt,
} from '@/src/components/ui';
import { colors, font, radii } from '@/src/theme/tokens';

function rolePillColors(role: Role): { color: string; background: string } {
	if (role === 'owner') {
		return { color: colors.purpleTintInk, background: colors.purpleTint };
	}
	if (role === 'manager') {
		return { color: colors.brandPurpleInk, background: 'rgba(110,30,200,0.08)' };
	}
	return { color: colors.textSub, background: colors.chipBg };
}

export default function TeamScreen() {
	const { session, client } = useAuth();
	const token = session?.token;
	const canInvite = session?.role === 'owner' || session?.role === 'manager';
	// Owners may grant any role; managers may only add Members.
	const roleOptions: { label: string; value: Role }[] =
		session?.role === 'owner'
			? [
					{ label: 'Owner', value: 'owner' },
					{ label: 'Manager', value: 'manager' },
					{ label: 'Member', value: 'member' },
				]
			: [{ label: 'Member', value: 'member' }];

	const [members, setMembers] = useState<Member[]>([]);
	const [invites, setInvites] = useState<InviteSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [inviteName, setInviteName] = useState('');
	const [inviteEmail, setInviteEmail] = useState('');
	const [inviteRole, setInviteRole] = useState<Role>('member');
	const [inviteError, setInviteError] = useState<string | null>(null);
	const [lastInvite, setLastInvite] = useState<Invite | null>(null);
	const [sending, setSending] = useState(false);

	const load = useCallback(async () => {
		if (!token) {
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const data = await client.listMembers(token);
			setMembers(data.members);
			setInvites(data.invites);
		} catch (caught) {
			setError(caught instanceof ApiError ? caught.message : 'Could not load your team.');
		} finally {
			setLoading(false);
		}
	}, [client, token]);

	useEffect(() => {
		load();
	}, [load]);

	async function onInvite() {
		if (!token || sending) {
			return;
		}
		setInviteError(null);
		setSending(true);
		try {
			const invite = await client.inviteMember(token, {
				email: inviteEmail.trim(),
				name: inviteName.trim(),
				role: inviteRole,
			});
			setLastInvite(invite);
			setInviteName('');
			setInviteEmail('');
			await load();
		} catch (caught) {
			setInviteError(caught instanceof ApiError ? caught.message : 'Could not send the invite.');
		} finally {
			setSending(false);
		}
	}

	if (!session) {
		return null;
	}

	return (
		<ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
			<Txt style={styles.h1}>Team</Txt>
			<Txt style={styles.subtitle}>
				Everyone at {session.account.name} and the roles that control what they can do.
			</Txt>

			<Card style={styles.card}>
				<SectionLabel>Members</SectionLabel>
				{loading ? (
					<ActivityIndicator color={colors.brandPurple} style={styles.loading} />
				) : error ? (
					<Txt style={styles.errorTxt}>{error}</Txt>
				) : (
					members.map((member) => {
						const pill = rolePillColors(member.role);
						return (
							<View key={member.userId} style={styles.row}>
								<Avatar initials={initialsOf(member.name)} size={38} />
								<View style={styles.rowMain}>
									<Txt style={styles.rowName}>{member.name}</Txt>
									<Txt style={styles.rowSub}>{member.email}</Txt>
								</View>
								<Pill
									label={roleLabel(member.role)}
									color={pill.color}
									background={pill.background}
								/>
							</View>
						);
					})
				)}
			</Card>

			{invites.length > 0 ? (
				<Card style={styles.card}>
					<SectionLabel>Pending invites</SectionLabel>
					{invites.map((invite) => (
						<View key={invite.id} style={styles.row}>
							<Avatar initials={initialsOf(invite.name)} size={38} background={colors.chipBg} />
							<View style={styles.rowMain}>
								<Txt style={styles.rowName}>{invite.name}</Txt>
								<Txt style={styles.rowSub}>{invite.email}</Txt>
							</View>
							<Pill
								label={`${roleLabel(invite.role)} · pending`}
								color={colors.amberInk}
								background="rgba(240,160,32,0.12)"
							/>
						</View>
					))}
				</Card>
			) : null}

			{canInvite ? (
				<Card style={styles.card}>
					<SectionLabel>Invite a teammate</SectionLabel>
					<View style={styles.form}>
						<TextField
							label="Name"
							value={inviteName}
							onChangeText={setInviteName}
							placeholder="Jordan Rivera"
							autoCapitalize="words"
						/>
						<TextField
							label="Email"
							value={inviteEmail}
							onChangeText={setInviteEmail}
							placeholder="jordan@business.com"
							autoCapitalize="none"
							keyboardType="email-address"
						/>
						<View style={styles.fieldWrap}>
							<Txt style={styles.fieldLabel}>Role</Txt>
							<Segmented options={roleOptions} value={inviteRole} onChange={setInviteRole} />
						</View>

						{inviteError ? <Txt style={styles.errorTxt}>{inviteError}</Txt> : null}

						<GradientButton
							label={sending ? 'Sending…' : 'Send invite'}
							icon="user-plus"
							onPress={onInvite}
						/>

						{lastInvite ? (
							<View style={styles.callout}>
								<Txt style={styles.calloutTitle}>Invitation sent to {lastInvite.email}</Txt>
								<Txt style={styles.calloutBody}>
									We’ve emailed them a link to accept and join {session.account.name}. Prefer to
									share it yourself? They can also join with this code:
								</Txt>
								<Txt selectable style={styles.code}>
									{lastInvite.token}
								</Txt>
							</View>
						) : null}
					</View>
				</Card>
			) : (
				<Card style={styles.card}>
					<Txt style={styles.rowSub}>
						Only Owners and Managers can invite new members. Ask an Owner to add someone.
					</Txt>
				</Card>
			)}
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
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
	},
	rowMain: {
		flex: 1,
		minWidth: 0,
	},
	rowName: {
		fontFamily: font.semibold,
		fontSize: 14,
		color: colors.text,
	},
	rowSub: {
		fontFamily: font.regular,
		fontSize: 12.5,
		color: colors.textMuted,
	},
	form: {
		gap: 13,
	},
	fieldWrap: {
		gap: 6,
	},
	fieldLabel: {
		fontFamily: font.semibold,
		fontSize: 12.5,
		color: colors.textSub,
	},
	errorTxt: {
		fontFamily: font.medium,
		fontSize: 12.5,
		color: colors.redInk,
	},
	callout: {
		backgroundColor: colors.fieldSoft,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radii.md,
		padding: 14,
		gap: 6,
	},
	calloutTitle: {
		fontFamily: font.semibold,
		fontSize: 13,
		color: colors.text,
	},
	calloutBody: {
		fontFamily: font.regular,
		fontSize: 12.5,
		color: colors.textMuted,
	},
	code: {
		fontFamily: font.medium,
		fontSize: 12.5,
		color: colors.brandPurpleInk,
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radii.sm,
		paddingVertical: 8,
		paddingHorizontal: 10,
	},
});
