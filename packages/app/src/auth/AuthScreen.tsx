import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ApiError, type SignupBody } from '@/src/api/client';
import { GradientButton, RivusBadge, TextField, Txt } from '@/src/components/ui';
import { colors, font, radii } from '@/src/theme/tokens';
import { useAuth } from './AuthContext';

type Mode = 'signup' | 'signin' | 'invite';

const COPY: Record<Mode, { title: string; subtitle: string; submit: string }> = {
	signup: {
		title: 'Create your business account',
		subtitle: 'Set up Rivus for your business in under a minute.',
		submit: 'Create account',
	},
	signin: {
		title: 'Welcome back',
		subtitle: 'Sign in to your Rivus account.',
		submit: 'Sign in',
	},
	invite: {
		title: 'Join your team',
		subtitle: 'Paste the invite code you were sent and pick a password.',
		submit: 'Join the team',
	},
};

function messageFor(error: unknown): string {
	if (error instanceof ApiError) {
		return error.message;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return 'Something went wrong. Please try again.';
}

export function AuthScreen() {
	const { signUp, signIn, acceptInvite } = useAuth();
	const [mode, setMode] = useState<Mode>('signup');

	const [businessName, setBusinessName] = useState('');
	const [phone, setPhone] = useState('');
	const [address, setAddress] = useState('');
	const [website, setWebsite] = useState('');
	const [timezone, setTimezone] = useState('');
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [inviteToken, setInviteToken] = useState('');

	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	function switchMode(next: Mode) {
		setMode(next);
		setError(null);
	}

	async function onSubmit() {
		if (submitting) {
			return;
		}
		setError(null);
		setSubmitting(true);
		try {
			if (mode === 'signup') {
				const business: SignupBody['business'] = { businessName: businessName.trim() };
				if (phone.trim()) business.phone = phone.trim();
				if (address.trim()) business.address = address.trim();
				if (website.trim()) business.website = website.trim();
				if (timezone.trim()) business.timezone = timezone.trim();
				await signUp({ name: name.trim(), email: email.trim(), password, business });
			} else if (mode === 'signin') {
				await signIn({ email: email.trim(), password });
			} else {
				await acceptInvite(inviteToken.trim(), password);
			}
		} catch (caught) {
			setError(messageFor(caught));
		} finally {
			setSubmitting(false);
		}
	}

	const copy = COPY[mode];

	return (
		<View style={styles.screen}>
			<ScrollView
				contentContainerStyle={styles.scroll}
				keyboardShouldPersistTaps="handled"
				showsVerticalScrollIndicator={false}
			>
				<View style={styles.card}>
					<RivusBadge size={46} />
					<Txt style={styles.title}>{copy.title}</Txt>
					<Txt style={styles.subtitle}>{copy.subtitle}</Txt>

					<View style={styles.form}>
						{mode === 'signup' ? (
							<>
								<TextField
									label="Business name"
									value={businessName}
									onChangeText={setBusinessName}
									placeholder="Cascade Plumbing & Heating"
									autoCapitalize="words"
								/>
								<TextField
									label="Your name"
									value={name}
									onChangeText={setName}
									placeholder="Marcus Thompson"
									autoCapitalize="words"
								/>
							</>
						) : null}

						{mode !== 'invite' ? (
							<TextField
								label="Email"
								value={email}
								onChangeText={setEmail}
								placeholder="you@business.com"
								autoCapitalize="none"
								autoComplete="email"
								keyboardType="email-address"
							/>
						) : null}

						{mode === 'invite' ? (
							<TextField
								label="Invite code"
								value={inviteToken}
								onChangeText={setInviteToken}
								placeholder="Paste your invite code"
								autoCapitalize="none"
							/>
						) : null}

						<TextField
							label="Password"
							value={password}
							onChangeText={setPassword}
							placeholder="At least 8 characters"
							secureTextEntry
							autoCapitalize="none"
						/>

						{mode === 'signup' ? (
							<>
								<Txt style={styles.sectionLabel}>Business details (optional)</Txt>
								<TextField
									label="Phone"
									value={phone}
									onChangeText={setPhone}
									placeholder="+1 (206) 555-0100"
									keyboardType="phone-pad"
								/>
								<TextField
									label="Address"
									value={address}
									onChangeText={setAddress}
									placeholder="123 Main St, Seattle, WA"
								/>
								<TextField
									label="Website"
									value={website}
									onChangeText={setWebsite}
									placeholder="https://yourbusiness.com"
									autoCapitalize="none"
									keyboardType="url"
								/>
								<TextField
									label="Time zone"
									value={timezone}
									onChangeText={setTimezone}
									placeholder="America/Los_Angeles"
									autoCapitalize="none"
									hint="Defaults to UTC if left blank."
								/>
							</>
						) : null}

						{error ? (
							<View style={styles.errorBox}>
								<Txt style={styles.errorTxt}>{error}</Txt>
							</View>
						) : null}

						<GradientButton
							label={submitting ? 'Please wait…' : copy.submit}
							icon="arrow-right"
							onPress={onSubmit}
						/>
					</View>

					<View style={styles.links}>
						{mode !== 'signin' ? (
							<Link label="Already have an account? Sign in" onPress={() => switchMode('signin')} />
						) : null}
						{mode !== 'signup' ? (
							<Link
								label="New here? Create a business account"
								onPress={() => switchMode('signup')}
							/>
						) : null}
						{mode !== 'invite' ? (
							<Link label="Have an invite code? Join a team" onPress={() => switchMode('invite')} />
						) : null}
					</View>
				</View>

				<Txt style={styles.legal}>Rivus · Your AI teammate for local business</Txt>
			</ScrollView>
		</View>
	);
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
	return (
		<Pressable onPress={onPress} style={({ pressed }) => pressed && styles.linkPressed}>
			<Txt style={styles.link}>{label}</Txt>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	screen: {
		flex: 1,
		backgroundColor: colors.appBg,
	},
	scroll: {
		flexGrow: 1,
		alignItems: 'center',
		justifyContent: 'center',
		paddingVertical: 48,
		paddingHorizontal: 20,
		gap: 18,
	},
	card: {
		width: '100%',
		maxWidth: 420,
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radii.card,
		padding: 26,
		gap: 6,
	},
	title: {
		marginTop: 14,
		fontFamily: font.bold,
		fontSize: 21,
		color: colors.text,
	},
	subtitle: {
		fontFamily: font.regular,
		fontSize: 13.5,
		color: colors.textMuted,
	},
	form: {
		marginTop: 16,
		gap: 13,
	},
	sectionLabel: {
		marginTop: 4,
		fontFamily: font.semibold,
		fontSize: 12,
		letterSpacing: 0.6,
		textTransform: 'uppercase',
		color: colors.textFaint,
	},
	errorBox: {
		backgroundColor: 'rgba(240,88,75,0.08)',
		borderWidth: 1,
		borderColor: 'rgba(240,88,75,0.25)',
		borderRadius: radii.md,
		paddingVertical: 10,
		paddingHorizontal: 12,
	},
	errorTxt: {
		fontFamily: font.medium,
		fontSize: 12.5,
		color: colors.redInk,
	},
	links: {
		marginTop: 18,
		gap: 10,
		alignItems: 'center',
	},
	link: {
		fontFamily: font.semibold,
		fontSize: 12.5,
		color: colors.brandPurple,
	},
	linkPressed: {
		opacity: 0.7,
	},
	legal: {
		fontFamily: font.regular,
		fontSize: 11.5,
		color: colors.textFaint,
	},
});
