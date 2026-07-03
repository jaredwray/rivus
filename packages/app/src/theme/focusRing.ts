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

// Text-entry fields only: real text inputs and textareas. These already sit inside a
// bordered field, so the brand ring just draws a second box around the box — it's
// removed from every textbox view. Non-text <input>s (checkbox, radio, range, file,
// and the button-like submit/reset/image/button) are deliberately excluded: they have
// no field of their own, so they keep a visible focus indicator (WCAG 2.4.7 — in
// react-native-web a <Switch> renders as <input type="checkbox">, for instance).
const TEXT_FIELDS =
	':where(input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=image]):not([type=file]):not([type=range]):not([type=reset]),textarea)';

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
		// Keyboard focus: a 2px brand ring sitting just outside the control.
		`${SELECTOR}:focus-visible{outline:2px solid ${colors.brandPurple};outline-offset:2px;}` +
		// Text inputs already have a bordered field, so suppress the ring for them only.
		// Appended after the ring rule so it wins at equal specificity; non-text inputs
		// (checkbox/radio/…) keep the ring drawn above.
		`${TEXT_FIELDS}:focus,${TEXT_FIELDS}:focus-visible{outline:none;}` +
		// Opt-out: any other control carrying data-no-focus-ring never gets the ring.
		// Appended last so it wins over the ring rule above at equal specificity.
		`:where([data-no-focus-ring]):focus,:where([data-no-focus-ring]):focus-visible{outline:none;}`;
	document.head.appendChild(style);
}
