import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { type AddressSuggestion, fetchAddressSuggestions } from '@/src/api/places';
import { colors, font, radii, shadowCard } from '@/src/theme/tokens';
import { TextField, Txt } from './ui';

const DEBOUNCE_MS = 250;

/**
 * Address field with Google Places autocomplete. When no API key is configured
 * it degrades to a plain text input, so the form always works. The network call
 * lives in `src/api/places` (pure, tested); this component only debounces input
 * and renders the suggestion list.
 */
export function AddressAutocomplete({
	label,
	value,
	onChangeText,
	placeholder,
	apiKey,
}: {
	label: string;
	value: string;
	onChangeText: (value: string) => void;
	placeholder?: string;
	apiKey: string | null;
}) {
	const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
	const [open, setOpen] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	async function runQuery(query: string, key: string) {
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		try {
			const results = await fetchAddressSuggestions(query, {
				apiKey: key,
				signal: controller.signal,
			});
			setSuggestions(results);
			setOpen(results.length > 0);
		} catch {
			setSuggestions([]);
			setOpen(false);
		}
	}

	function handleChange(next: string) {
		onChangeText(next);
		if (!apiKey) {
			return;
		}
		if (timer.current) {
			clearTimeout(timer.current);
		}
		timer.current = setTimeout(() => {
			void runQuery(next, apiKey);
		}, DEBOUNCE_MS);
	}

	function choose(suggestion: AddressSuggestion) {
		onChangeText(suggestion.description);
		setSuggestions([]);
		setOpen(false);
	}

	return (
		<View style={styles.wrap}>
			<TextField
				label={label}
				value={value}
				onChangeText={handleChange}
				placeholder={placeholder}
				autoCapitalize="words"
				autoCorrect={false}
			/>
			{open ? (
				<View style={styles.dropdown}>
					{suggestions.map((suggestion) => (
						<Pressable
							key={suggestion.placeId}
							onPress={() => choose(suggestion)}
							style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
						>
							<Txt style={styles.rowTxt}>{suggestion.description}</Txt>
						</Pressable>
					))}
				</View>
			) : null}
		</View>
	);
}

const styles = StyleSheet.create({
	wrap: {
		position: 'relative',
		zIndex: 10,
	},
	dropdown: {
		marginTop: 4,
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radii.md,
		overflow: 'hidden',
		...shadowCard,
	},
	row: {
		paddingVertical: 11,
		paddingHorizontal: 12,
	},
	rowPressed: {
		backgroundColor: colors.field,
	},
	rowTxt: {
		fontFamily: font.regular,
		fontSize: 13.5,
		color: colors.textSub,
	},
});
