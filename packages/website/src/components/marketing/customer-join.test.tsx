import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiUrl } from '../../lib/site';
import { CustomerJoin } from './customer-join';

const account = { name: 'Cascade Plumbing', slug: 'cascade-plumbing' };

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

/** Stubs global fetch to answer the mount-time account lookup with `response`. */
function stubLookup(response: Response | Promise<Response>) {
	const mock = vi.fn<typeof globalThis.fetch>().mockReturnValue(Promise.resolve(response));
	vi.stubGlobal('fetch', mock);
	return mock;
}

async function renderLoaded() {
	const mock = stubLookup(jsonResponse(account, 200));
	render(<CustomerJoin slug={account.slug} />);
	await screen.findByRole('heading', { name: `Join ${account.name}` });
	return mock;
}

function fillAndSubmit(fields: { name: string; email?: string; phone?: string; address?: string }) {
	fireEvent.change(screen.getByLabelText('Full name'), { target: { value: fields.name } });
	if (fields.email !== undefined) {
		fireEvent.change(screen.getByLabelText('Email'), { target: { value: fields.email } });
	}
	if (fields.phone !== undefined) {
		fireEvent.change(screen.getByLabelText('Phone (optional)'), {
			target: { value: fields.phone },
		});
	}
	if (fields.address !== undefined) {
		fireEvent.change(screen.getByLabelText('Address (optional)'), {
			target: { value: fields.address },
		});
	}
	fireEvent.submit(screen.getByRole('form', { name: 'Join as a customer' }));
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('CustomerJoin', () => {
	it('shows the loading state, then the business name once the lookup resolves', async () => {
		const mock = stubLookup(jsonResponse(account, 200));

		render(<CustomerJoin slug="cascade-plumbing" />);

		expect(screen.getByRole('status').textContent).toContain('Looking up the business…');
		await screen.findByRole('heading', { name: 'Join Cascade Plumbing' });
		expect(mock).toHaveBeenCalledWith(`${apiUrl}/v1/public/accounts/cascade-plumbing`);
		expect(screen.getByLabelText('Full name')).toBeTruthy();
	});

	it('shows the not-found panel (and no form) when the business does not exist', async () => {
		stubLookup(
			jsonResponse({ error: 'Not Found', message: 'Business not found', statusCode: 404 }, 404),
		);

		render(<CustomerJoin slug="nope" />);

		await screen.findByRole('heading', { name: /couldn't find this business/i });
		expect(screen.queryByRole('form')).toBeNull();
	});

	it('shows a retry panel — not "not found" — when the lookup fails on the network', async () => {
		vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('down')));

		render(<CustomerJoin slug="cascade-plumbing" />);

		// An outage must not tell the visitor the business doesn't exist.
		await screen.findByRole('heading', { name: /couldn't load this page/i });
		expect(screen.queryByText(/couldn't find this business/i)).toBeNull();
	});

	it('shows the retry panel when the lookup gets a server error', async () => {
		stubLookup(jsonResponse({ error: 'Internal Server Error', statusCode: 500 }, 500));

		render(<CustomerJoin slug="cascade-plumbing" />);

		await screen.findByRole('heading', { name: /couldn't load this page/i });
	});

	it('announces the success panel to assistive technology', async () => {
		const mock = await renderLoaded();
		mock.mockResolvedValueOnce(jsonResponse({ status: 'registered' }, 201));

		fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Dana Fox' } });
		fireEvent.change(screen.getByLabelText('Email'), {
			target: { value: 'dana@customer.example' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Add me as a customer' }));

		const status = await screen.findByRole('status');
		expect(status.textContent).toContain("You're all set");
	});

	it('POSTs the trimmed details to the account and shows the success panel', async () => {
		const mock = await renderLoaded();
		mock.mockResolvedValueOnce(jsonResponse({ status: 'registered' }, 201));

		fillAndSubmit({
			name: '  Dana Fox ',
			email: ' dana@example.com ',
			phone: '555-0100',
			address: '12 Ballard Ave',
		});

		// While the POST is in flight the submit is disabled and relabelled.
		const pending = screen.getByRole('button', { name: 'Adding you…' }) as HTMLButtonElement;
		expect(pending.disabled).toBe(true);

		await screen.findByRole('heading', { name: "You're all set" });
		expect(screen.getByText(/reply to Rivus/i)).toBeTruthy();

		const [url, init] = mock.mock.calls[1] as [string, RequestInit];
		expect(url).toBe(`${apiUrl}/v1/public/accounts/cascade-plumbing/customers`);
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({ 'content-type': 'application/json' });
		expect(JSON.parse(init.body as string)).toEqual({
			name: 'Dana Fox',
			email: 'dana@example.com',
			phone: '555-0100',
			address: '12 Ballard Ave',
		});
	});

	it('shows the server message inline on a 400 and keeps the form up', async () => {
		const mock = await renderLoaded();
		mock.mockResolvedValueOnce(
			jsonResponse(
				{ error: 'Bad Request', message: 'Email must be a valid address.', statusCode: 400 },
				400,
			),
		);

		fillAndSubmit({ name: 'Dana Fox', email: 'dana@example' });

		await screen.findByRole('alert');
		expect(screen.getByRole('alert').textContent).toBe('Email must be a valid address.');
		expect(screen.getByRole('button', { name: 'Add me as a customer' })).toBeTruthy();
	});

	it('shows a friendly retry message when the submit fails on the network', async () => {
		const mock = await renderLoaded();
		mock.mockRejectedValueOnce(new Error('offline'));

		fillAndSubmit({ name: 'Dana Fox', email: 'dana@example.com' });

		await screen.findByRole('alert');
		expect(screen.getByRole('alert').textContent).toContain('try again');
	});

	it('falls back to the retry message when an error response has no usable body', async () => {
		const mock = await renderLoaded();
		mock.mockResolvedValueOnce(new Response('nope', { status: 500 }));

		fillAndSubmit({ name: 'Dana Fox', email: 'dana@example.com' });

		await screen.findByRole('alert');
		expect(screen.getByRole('alert').textContent).toContain('try again');
	});

	it('prefills the email field from the emailPrefill prop', async () => {
		const mock = stubLookup(jsonResponse(account, 200));
		render(<CustomerJoin slug={account.slug} emailPrefill="dana@example.com" />);
		await screen.findByRole('heading', { name: `Join ${account.name}` });
		expect(mock).toHaveBeenCalled();

		const input = screen.getByLabelText('Email') as HTMLInputElement;
		expect(input.value).toBe('dana@example.com');
	});
});
