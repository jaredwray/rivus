import { useEffect } from 'react';
import { Platform } from 'react-native';

const BRAND = 'Rivus';

/**
 * Sets the browser tab title to "Rivus · <title>" on web, so the tab reflects
 * the active screen instead of the bare URL. No-op on native and during static
 * rendering, where there's no `document`.
 */
export function useDocumentTitle(title: string): void {
	useEffect(() => {
		if (Platform.OS !== 'web' || typeof document === 'undefined') {
			return;
		}
		document.title = `${BRAND} · ${title}`;
	}, [title]);
}
