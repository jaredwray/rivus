import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiUrl } from '../../lib/site';
import { AppsWaitlist } from './apps-waitlist';

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

function fillAndSubmit(name: string, email: string) {
	fireEvent.change(screen.getByLabelText('Full name'), { target: { value: name } });
	fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
	fireEvent.submit(screen.getByRole('form', { name: 'Join the apps waitlist' }));
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('AppsWaitlist', () => {
	it('POSTs the lead with the apps-waitlist source and confirms', async () => {
		const mock = stubFetch();
		mock.mockResolvedValueOnce(jsonResponse({ status: 'received' }, 201));
		render(<AppsWaitlist />);

		fillAndSubmit(' Dana Fox ', ' dana@example.com ');

		const pending = screen.getByRole('button', { name: 'Adding you…' }) as HTMLButtonElement;
		expect(pending.disabled).toBe(true);

		const status = await screen.findByRole('status');
		expect(status.textContent).toContain("You're on the list");

		const [url, init] = mock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${apiUrl}/v1/leads/demo`);
		expect(JSON.parse(init.body as string)).toEqual({
			name: 'Dana Fox',
			email: 'dana@example.com',
			source: 'apps-waitlist',
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
		render(<AppsWaitlist />);

		fillAndSubmit('Dana Fox', 'dana@example');

		await screen.findByRole('alert');
		expect(screen.getByRole('alert').textContent).toBe('Email address is required.');
		expect(screen.getByRole('button', { name: 'Join the waitlist' })).toBeTruthy();
	});

	it('shows a friendly retry message when the submit fails on the network', async () => {
		const mock = stubFetch();
		mock.mockRejectedValueOnce(new Error('offline'));
		render(<AppsWaitlist />);

		fillAndSubmit('Dana Fox', 'dana@example.com');

		await screen.findByRole('alert');
		expect(screen.getByRole('alert').textContent).toContain('try again');
	});

	it('falls back to the retry message when an error response has no usable body', async () => {
		const mock = stubFetch();
		mock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
		render(<AppsWaitlist />);

		fillAndSubmit('Dana Fox', 'dana@example.com');

		await screen.findByRole('alert');
		expect(screen.getByRole('alert').textContent).toContain('try again');
	});
});
