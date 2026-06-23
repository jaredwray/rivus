import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { appUrl } from '../../lib/site';
import { FinalCta } from './final-cta';

describe('FinalCta', () => {
	it('points both conversion CTAs at the product app', () => {
		render(<FinalCta />);
		expect(screen.getByRole('link', { name: /get started free/i }).getAttribute('href')).toBe(
			`${appUrl}/signup`,
		);
		expect(screen.getByRole('link', { name: /book a demo/i }).getAttribute('href')).toBe(
			`${appUrl}/demo`,
		);
	});
});
