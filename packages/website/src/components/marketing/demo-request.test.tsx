import { SMS_CONSENT_DISCLOSURE } from '@rivus/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiUrl } from '../../lib/site';
import { DemoRequest, SALES_EMAIL } from './demo-request';

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function stubFetch() {
	const mock = vi.fn<typeof globalThis.fetch>();
	vi.stubGlobal('fetch', mock);
	return mock;
}

function fillAndSubmit(fields: {
	name: string;
	email: string;
	business?: string;
	phone?: string;
	trade?: string;
}) {
	fireEvent.change(screen.getByLabelText('Full name'), { target: { value: fields.name } });
	fireEvent.change(screen.getByLabelText('Email'), { target: { value: fields.email } });
	if (fields.business !== undefined) {
		fireEvent.change(screen.getByLabelText('Business name (optional)'), {
			target: { value: fields.business },
		});
	}
	if (fields.phone !== undefined) {
		fireEvent.change(screen.getByLabelText('Phone (optional)'), {
			target: { value: fields.phone },
		});
	}
	if (fields.trade !== undefined) {
		fireEvent.change(screen.getByLabelText('What kind of business? (optional)'), {
			target: { value: fields.trade },
		});
	}
	fireEvent.submit(screen.getByRole('form', { name: 'Request a demo' }));
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('DemoRequest', () => {
	it('renders the form with the always-visible sales-email fallback', () => {
		stubFetch();
		render(<DemoRequest />);

		expect(screen.getByRole('form', { name: 'Request a demo' })).toBeTruthy();
		const mailtos = screen
			.getAllByRole('link')
			.filter((link) => link.getAttribute('href') === `mailto:${SALES_EMAIL}`);
		expect(mailtos.length).toBeGreaterThanOrEqual(1);
	});

	it('shows the canonical SMS consent disclosure where the phone number is collected', () => {
		stubFetch();
		render(<DemoRequest />);

		const phone = screen.getByLabelText('Phone (optional)');
		expect(phone.getAttribute('aria-describedby')).toBe('demo-phone-consent');
		// Carrier vetting requires the identical disclosure on every collection
		// surface, so assert the canonical text verbatim rather than a paraphrase.
		const consent = document.getElementById('demo-phone-consent');
		expect(consent?.textContent).toContain(SMS_CONSENT_DISCLOSURE);
		expect(screen.getByRole('link', { name: 'SMS terms' }).getAttribute('href')).toBe('/sms-terms');
		expect(screen.getByRole('link', { name: 'privacy policy' }).getAttribute('href')).toBe(
			'/privacy',
		);
	});

	it('POSTs the trimmed details to the leads endpoint and shows the success panel', async () => {
		const mock = stubFetch();
		mock.mockResolvedValueOnce(jsonResponse({ status: 'received' }, 201));
		render(<DemoRequest />);

		fillAndSubmit({
			name: '  Dana Fox ',
			email: ' dana@example.com ',
			business: ' Fox Plumbing ',
			phone: '555-0100',
			trade: 'Plumbing',
		});

		// While the POST is in flight the submit is disabled and relabelled.
		const pending = screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement;
		expect(pending.disabled).toBe(true);

		// role="status" so the outcome is announced after the form unmounts.
		const status = await screen.findByRole('status');
		expect(status.textContent).toContain('Request received');
		expect(status.textContent).toContain(SALES_EMAIL);

		const [url, init] = mock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${apiUrl}/v1/leads/demo`);
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({ 'content-type': 'application/json' });
		expect(JSON.parse(init.body as string)).toEqual({
			name: 'Dana Fox',
			email: 'dana@example.com',
			business: 'Fox Plumbing',
			phone: '555-0100',
			trade: 'Plumbing',
		});
	});

	it('shows the server message inline on a 400 and keeps the form up', async () => {
		const mock = stubFetch();
		mock.mockResolvedValueOnce(
			jsonResponse(
				{ error: 'Bad Request', message: 'Email address is required.', statusCode: 400 },
				400,
			),
		);
		render(<DemoRequest />);

		fillAndSubmit({ name: 'Dana Fox', email: 'dana@example' });

		await screen.findByRole('alert');
		expect(screen.getByRole('alert').textContent).toBe('Email address is required.');
		expect(screen.getByRole('button', { name: 'Request my demo' })).toBeTruthy();
	});

	it('shows a friendly retry message when the submit fails on the network', async () => {
		const mock = stubFetch();
		mock.mockRejectedValueOnce(new Error('offline'));
		render(<DemoRequest />);

		fillAndSubmit({ name: 'Dana Fox', email: 'dana@example.com' });

		await screen.findByRole('alert');
		expect(screen.getByRole('alert').textContent).toContain('try again');
	});

	it('falls back to the retry message when an error response has no usable body', async () => {
		const mock = stubFetch();
		mock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
		render(<DemoRequest />);

		fillAndSubmit({ name: 'Dana Fox', email: 'dana@example.com' });

		await screen.findByRole('alert');
		expect(screen.getByRole('alert').textContent).toContain('try again');
	});
});
