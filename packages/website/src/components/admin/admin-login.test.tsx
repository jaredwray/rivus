import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdminLogin } from './admin-login';

describe('admin login', () => {
	it('walks sign-in → code → done', () => {
		render(<AdminLogin />);
		expect(screen.getByRole('heading', { name: 'Sign in to the console' })).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: /Send code/ }));
		expect(screen.getByRole('heading', { name: 'Enter the code' })).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: /Verify & continue/ }));
		expect(screen.getByRole('heading', { name: /Welcome back/ })).toBeTruthy();
		expect(screen.getByRole('link', { name: /Enter console/ }).getAttribute('href')).toBe('/admin');
	});

	it('Google sign-in jumps straight to the signed-in state', () => {
		render(<AdminLogin />);
		fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }));
		expect(screen.getByRole('heading', { name: /Welcome back/ })).toBeTruthy();
	});

	it('can return from the code step to sign-in', () => {
		render(<AdminLogin />);
		fireEvent.click(screen.getByRole('button', { name: /Send code/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Back' }));
		expect(screen.getByRole('heading', { name: 'Sign in to the console' })).toBeTruthy();
	});
});
