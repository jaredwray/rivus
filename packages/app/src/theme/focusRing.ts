import { Platform } from 'react-native';
import { colors } from './tokens';

// react-native-web renders Pressables and inputs as focusable DOM nodes, so on
// web the browser paints its default focus outline when you tab (or click) to
// them. On a rounded button that outline is a square that pokes out past the
// corners — the "line around it" you see when tabbing to a gradient button.
//
// We can't express `:focus-visible` through RN's StyleSheet, so install one tiny
// stylesheet: hide the default outline for pointer focus, and draw a clean,
// on-brand ring for keyboard focus only. `outline` follows each element's
// border-radius in modern browsers, so the ring matches the control's shape.
//
// No-op off the web (and during static rendering, where there's no `document`).

const STYLE_ID = 'rivus-focus-ring';

// Scope to genuinely interactive nodes: Pressables with accessibilityRole="button"
// render as a native <button>, links as <a>, inputs as <input>/<textarea>, and
// every other Pressable carries a tabindex.
const SELECTOR = ':where(button,a,input,select,textarea,[tabindex])';

// The brand ring is only for controls without their own visible frame — buttons,
// links, and other focusable Pressables. Text inputs already sit inside a bordered
// field, so a ring there just draws a second box around the box; browsers also treat
// text inputs as `:focus-visible` whenever focused, so it would show even on a click.
// The purple highlight is therefore removed from every textbox view (input/textarea).
const RING_TARGETS = ':where(button,a,select,[tabindex])';
const TEXT_FIELDS = ':where(input,textarea)';

export function installFocusRing(): void {
	if (Platform.OS !== 'web' || typeof document === 'undefined') {
		return;
	}
	if (document.getElementById(STYLE_ID)) {
		return;
	}
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent =
		// Pointer focus (mouse/touch): no outline anywhere.
		`${SELECTOR}:focus:not(:focus-visible){outline:none;}` +
		// Keyboard focus: a 2px brand ring sitting just outside non-text controls.
		`${RING_TARGETS}:focus-visible{outline:2px solid ${colors.brandPurple};outline-offset:2px;}` +
		// Text inputs never get the ring. Appended after the ring rule so it wins at
		// equal specificity for any input that also happens to carry a tabindex.
		`${TEXT_FIELDS}:focus,${TEXT_FIELDS}:focus-visible{outline:none;}` +
		// Opt-out: any other control carrying data-no-focus-ring never gets the ring.
		// Appended last so it wins over the ring rule above at equal specificity.
		`:where([data-no-focus-ring]):focus,:where([data-no-focus-ring]):focus-visible{outline:none;}`;
	document.head.appendChild(style);
}
