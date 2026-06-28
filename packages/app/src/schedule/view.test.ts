import { describe, expect, it } from 'vitest';
import { SIDEBAR_BREAKPOINT } from '../theme/tokens';
import { defaultScheduleView } from './view';

describe('defaultScheduleView', () => {
	it('opens the day view on the narrow (mobile) layout', () => {
		expect(defaultScheduleView(0)).toBe('day');
		expect(defaultScheduleView(375)).toBe('day');
		expect(defaultScheduleView(SIDEBAR_BREAKPOINT - 1)).toBe('day');
	});

	it('opens the week view once the sidebar layout fits', () => {
		expect(defaultScheduleView(SIDEBAR_BREAKPOINT)).toBe('week');
		expect(defaultScheduleView(1024)).toBe('week');
		expect(defaultScheduleView(1440)).toBe('week');
	});
});
