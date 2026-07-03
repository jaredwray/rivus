import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, font, radii } from '@/src/theme/tokens';
import { Txt } from './ui';

/**
 * Copy a value to the system clipboard. Backed by `expo-clipboard` so it works
 * on web and native alike. Resolves `true` when the write succeeds — native
 * always resolves `true`; web reflects the real outcome (it can be denied in an
 * insecure context or without permission), in which case callers leave the
 * value as selectable text to copy by hand.
 */
export async function copyToClipboard(value: string): Promise<boolean> {
	try {
		return await Clipboard.setStringAsync(value);
	} catch {
		return false;
	}
}

/**
 * A read-only value shown in a field with a one-tap copy button. Used for
 * shareable strings the user needs to hand off verbatim — an invite link, the
 * account's inbound agent email address — where the value is selectable text
 * (so it copies by hand if the clipboard write is denied) with a copy button
 * that flips to a "Copied" confirmation.
 */
export function CopyField({ label, value }: { label: string; value: string }) {
	const [copied, setCopied] = useState(false);
	const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (resetTimer.current) {
				clearTimeout(resetTimer.current);
			}
		},
		[],
	);

	async function onCopy() {
		const ok = await copyToClipboard(value);
		if (!ok) {
			return;
		}
		setCopied(true);
		if (resetTimer.current) {
			clearTimeout(resetTimer.current);
		}
		resetTimer.current = setTimeout(() => setCopied(false), 1800);
	}

	return (
		<View style={styles.fieldWrap}>
			<Txt style={styles.fieldLabel}>{label}</Txt>
			<View style={styles.copyRow}>
				<Txt selectable numberOfLines={1} style={styles.copyValue}>
					{value}
				</Txt>
				<Pressable
					onPress={onCopy}
					accessibilityRole="button"
					accessibilityLabel={`Copy ${label.toLowerCase()}`}
					style={({ pressed }) => [
						styles.copyBtn,
						copied && styles.copyBtnDone,
						pressed && styles.pressed,
					]}
				>
					<Feather
						name={copied ? 'check' : 'copy'}
						size={13}
						color={copied ? colors.green : colors.brandPurple}
					/>
					<Txt style={[styles.copyBtnTxt, copied && styles.copyBtnTxtDone]}>
						{copied ? 'Copied' : 'Copy'}
					</Txt>
				</Pressable>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	fieldWrap: {
		gap: 6,
	},
	fieldLabel: {
		fontFamily: font.semibold,
		fontSize: 12,
		letterSpacing: 0.3,
		color: colors.textSub,
	},
	copyRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		backgroundColor: colors.field,
		borderWidth: 1,
		borderColor: colors.borderField,
		borderRadius: radii.md,
		paddingVertical: 9,
		paddingLeft: 12,
		paddingRight: 8,
	},
	copyValue: {
		flex: 1,
		minWidth: 0,
		fontFamily: font.medium,
		fontSize: 13,
		color: colors.brandPurpleInk,
	},
	copyBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 5,
		paddingVertical: 6,
		paddingHorizontal: 10,
		borderRadius: radii.sm,
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.border,
	},
	copyBtnDone: {
		borderColor: 'rgba(31,181,115,0.4)',
	},
	copyBtnTxt: {
		fontFamily: font.semibold,
		fontSize: 12,
		color: colors.brandPurple,
	},
	copyBtnTxtDone: {
		color: colors.green,
	},
	pressed: {
		opacity: 0.7,
	},
});
