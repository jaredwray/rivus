// View-mode helpers for the schedule screen. Kept free of React/RN imports so the
// "which view do we open in?" rule stays pure and unit-testable.

import { SIDEBAR_BREAKPOINT } from '../theme/tokens';

/** The calendar layouts the schedule screen can show. */
export type ScheduleView = 'week' | 'day' | 'list';

/**
 * The view the schedule should open in for a given viewport `width`. The narrow
 * (mobile) layout opens on a single day — the seven-column week is too cramped to
 * be the first thing a phone user lands on — while the wider (sidebar) layout has
 * room to open on the full week. Operators can still switch views afterward; this
 * only picks the default on open.
 */
export function defaultScheduleView(width: number): ScheduleView {
	return width < SIDEBAR_BREAKPOINT ? 'day' : 'week';
}
