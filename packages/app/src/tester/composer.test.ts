import { describe, expect, it } from 'vitest';
import { isSendKeyPress } from './composer';

/** A react-native-web keydown: the modifier and IME flags live on the event. */
function webPress(
	key: string,
	options: { shiftKey?: boolean; isComposing?: boolean; keyCode?: number } = {},
) {
	const { shiftKey = false, isComposing, keyCode } = options;
	return { key, shiftKey, nativeEvent: { key, isComposing, keyCode } };
}

describe('isSendKeyPress', () => {
	it('sends on a bare Enter', () => {
		expect(isSendKeyPress(webPress('Enter'))).toBe(true);
	});

	it('writes a newline on Shift+Enter', () => {
		expect(isSendKeyPress(webPress('Enter', { shiftKey: true }))).toBe(false);
	});

	it('ignores every other key', () => {
		for (const key of ['a', ' ', 'Escape', 'Backspace', 'Tab', 'ArrowUp']) {
			expect(isSendKeyPress(webPress(key))).toBe(false);
		}
	});

	it('leaves an IME candidate to the keyboard', () => {
		expect(isSendKeyPress(webPress('Enter', { isComposing: true }))).toBe(false);
	});

	it('leaves an IME candidate to the keyboard without the isComposing flag', () => {
		expect(isSendKeyPress(webPress('Enter', { keyCode: 229 }))).toBe(false);
	});

	it('reads the key off a native event, which carries no modifiers', () => {
		expect(isSendKeyPress({ nativeEvent: { key: 'Enter' } })).toBe(true);
		expect(isSendKeyPress({ nativeEvent: { key: 'a' } })).toBe(false);
	});

	it('ignores an event with no key at all', () => {
		expect(isSendKeyPress({})).toBe(false);
	});
});
