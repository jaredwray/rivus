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
		// Pointer focus (mouse/touch): no outline.
		`${SELECTOR}:focus:not(:focus-visible){outline:none;}` +
		// Keyboard focus: a 2px brand ring sitting just outside the control.
		`${SELECTOR}:focus-visible{outline:2px solid ${colors.brandPurple};outline-offset:2px;}`;
	document.head.appendChild(style);
}
