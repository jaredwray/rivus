/**
 * Key handling for the Agent Tester's composer, kept out of the screen so it can
 * be unit-tested under Node — the screen itself needs a React Native renderer.
 */

/**
 * The parts of a keypress the composer reads.
 *
 * React Native's own type for `onKeyPress` names only `nativeEvent.key`, but on
 * web react-native-web hands the handler the browser's keydown event, which
 * carries the modifier and the IME flags too. Everything is optional so a plain
 * native event (`{ nativeEvent: { key } }`) satisfies it as well.
 */
export type ComposerKeyPress = {
	key?: string;
	shiftKey?: boolean;
	nativeEvent?: { key?: string; isComposing?: boolean; keyCode?: number };
};

/**
 * Whether a keypress means "send this message" rather than "type a newline":
 * Enter on its own sends, Shift+Enter writes a newline — the convention every
 * chat composer follows.
 *
 * An Enter that commits an input-method editor's candidate (Japanese, Chinese,
 * Korean typing) belongs to the keyboard, not to us: `isComposing` says so, and
 * `keyCode` 229 is how a browser without that flag says the same thing.
 */
export function isSendKeyPress(event: ComposerKeyPress): boolean {
	const key = event.key ?? event.nativeEvent?.key;
	if (key !== 'Enter' || event.shiftKey === true) {
		return false;
	}
	const native = event.nativeEvent;
	return native?.isComposing !== true && native?.keyCode !== 229;
}
