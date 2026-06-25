import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ApiError, type SignupBody } from '@/src/api/client';
import { getGoogleMapsApiKey } from '@/src/api/config';
import { deviceTimezone, listTimezones } from '@/src/api/timezones';
import { AddressAutocomplete } from '@/src/components/AddressAutocomplete';
import { GradientButton, RivusBadge, Select, TextField, Txt } from '@/src/components/ui';
import { colors, font, radii } from '@/src/theme/tokens';
import { useAuth } from './AuthContext';

type Mode = 'signup' | 'signin' | 'invite';
type Step = 'form' | 'code';

const COPY: Record<Mode, { title: string; subtitle: string; submit: string }> = {
	signup: {
		title: 'Create your business account',
		subtitle: 'Set up Rivus for your business in under a minute.',
		submit: 'Create account',
	},
	signin: {
		title: 'Welcome back',
		subtitle: 'Enter your email and we’ll send you a sign-in code.',
		submit: 'Send code',
	},
	invite: {
		title: 'Join your team',
		subtitle: 'Paste the invite code you were sent to join your team.',
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
	const { signUp, signIn, verifyCode, acceptInvite } = useAuth();
	const [mode, setMode] = useState<Mode>('signup');
	const [step, setStep] = useState<Step>('form');

	const [businessName, setBusinessName] = useState('');
	const [phone, setPhone] = useState('');
	const [address, setAddress] = useState('');
	const [website, setWebsite] = useState('');
	const [timezone, setTimezone] = useState(() => deviceTimezone());
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [inviteToken, setInviteToken] = useState('');
	const [code, setCode] = useState('');
	const [pendingEmail, setPendingEmail] = useState('');

	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const mapsApiKey = useMemo(() => getGoogleMapsApiKey(), []);
	const timezoneOptions = useMemo(
		() => listTimezones().map((zone) => ({ label: zone.replace(/_/g, ' '), value: zone })),
		[],
	);

	function switchMode(next: Mode) {
		setMode(next);
		setStep('form');
		setError(null);
		setCode('');
	}

	function buildBusiness(): SignupBody['business'] {
		const business: SignupBody['business'] = { businessName: businessName.trim() };
		if (phone.trim()) business.phone = phone.trim();
		if (address.trim()) business.address = address.trim();
		if (website.trim()) business.website = website.trim();
		if (timezone.trim()) business.timezone = timezone.trim();
		return business;
	}

	/** Send (or resend) the one-time code for signup / signin. */
	async function sendCode() {
		if (mode === 'signup') {
			await signUp({ name: name.trim(), email: email.trim(), business: buildBusiness() });
		} else {
			await signIn({ email: email.trim() });
		}
	}

	async function onSubmitForm() {
		if (submitting) return;
		setError(null);
		setSubmitting(true);
		try {
			if (mode === 'invite') {
				await acceptInvite(inviteToken.trim());
			} else {
				await sendCode();
				setPendingEmail(email.trim());
				setStep('code');
			}
		} catch (caught) {
			setError(messageFor(caught));
		} finally {
			setSubmitting(false);
		}
	}

	async function onSubmitCode() {
		if (submitting) return;
		setError(null);
		setSubmitting(true);
		try {
			await verifyCode({ email: pendingEmail, code: code.trim() });
			// On success the provider sets the session and this screen unmounts.
		} catch (caught) {
			setError(messageFor(caught));
		} finally {
			setSubmitting(false);
		}
	}

	async function onResend() {
		setError(null);
		try {
			await sendCode();
		} catch (caught) {
			setError(messageFor(caught));
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

					{step === 'code' ? (
						<>
							<Txt style={styles.title}>Enter your code</Txt>
							<Txt style={styles.subtitle}>
								We emailed a 6-digit code to {pendingEmail}. It expires in 10 minutes.
							</Txt>

							<View style={styles.form}>
								<TextField
									label="Verification code"
									value={code}
									onChangeText={(next) => setCode(next.replace(/\D/g, '').slice(0, 6))}
									placeholder="123456"
									keyboardType="number-pad"
									autoComplete="one-time-code"
									textContentType="oneTimeCode"
									maxLength={6}
									style={styles.codeInput}
								/>

								{error ? (
									<View style={styles.errorBox}>
										<Txt style={styles.errorTxt}>{error}</Txt>
									</View>
								) : null}

								<GradientButton
									label={submitting ? 'Verifying…' : 'Verify & continue'}
									icon="arrow-right"
									onPress={onSubmitCode}
								/>
							</View>

							<View style={styles.links}>
								<Link label="Resend code" onPress={onResend} />
								<Link label="Use a different email" onPress={() => switchMode(mode)} />
							</View>
						</>
					) : (
						<>
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
										<AddressAutocomplete
											label="Address"
											value={address}
											onChangeText={setAddress}
											placeholder="Start typing your address…"
											apiKey={mapsApiKey}
										/>
										<TextField
											label="Website"
											value={website}
											onChangeText={setWebsite}
											placeholder="https://yourbusiness.com"
											autoCapitalize="none"
											keyboardType="url"
										/>
										<Select
											label="Time zone"
											value={timezone}
											onSelect={setTimezone}
											options={timezoneOptions}
											searchable
											hint="Defaulted from your device — change it if needed."
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
									onPress={onSubmitForm}
								/>
							</View>

							<View style={styles.links}>
								{mode !== 'signin' ? (
									<Link
										label="Already have an account? Sign in"
										onPress={() => switchMode('signin')}
									/>
								) : null}
								{mode !== 'signup' ? (
									<Link
										label="New here? Create a business account"
										onPress={() => switchMode('signup')}
									/>
								) : null}
								{mode !== 'invite' ? (
									<Link
										label="Have an invite code? Join a team"
										onPress={() => switchMode('invite')}
									/>
								) : null}
							</View>
						</>
					)}
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
	codeInput: {
		fontFamily: font.semibold,
		fontSize: 22,
		letterSpacing: 8,
		textAlign: 'center',
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
