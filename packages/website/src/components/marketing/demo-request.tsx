'use client';

import { SMS_CONSENT_DISCLOSURE } from '@rivus/core';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { apiUrl } from '../../lib/site';
import { CheckIcon } from './icons';

type Submission =
	| { phase: 'idle' }
	| { phase: 'submitting' }
	| { phase: 'error'; message: string }
	| { phase: 'done' };

const RETRY_MESSAGE = 'Something went wrong on our end. Check your connection and try again.';

export const SALES_EMAIL = 'sales@rivus.ai';

/**
 * The demo-request form on /demo. Posts to the public leads endpoint; the
 * mailto fallback stays visible in every state so an API outage never leaves a
 * would-be customer without a way to reach sales.
 */
export function DemoRequest() {
	const [submission, setSubmission] = useState<Submission>({ phase: 'idle' });
	const [name, setName] = useState('');
	const [business, setBusiness] = useState('');
	const [email, setEmail] = useState('');
	const [phone, setPhone] = useState('');
	const [trade, setTrade] = useState('');

	if (submission.phase === 'done') {
		return (
			// role="status" announces the success to screen readers — the submit
			// button the user just activated is unmounted with the form, so without
			// a live region the outcome would be silent.
			<div className="join-card join-card--center" role="status">
				<div className="tile tile--lg tile--green join-card__check" aria-hidden="true">
					<CheckIcon size={22} />
				</div>
				<h2 className="join-card__title">Request received</h2>
				<p className="join-card__lead">
					A Rivus specialist will reach out within one business day to set up your demo. In a hurry?
					Email <a href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a> and we'll move faster.
				</p>
			</div>
		);
	}

	const submitting = submission.phase === 'submitting';

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setSubmission({ phase: 'submitting' });
		fetch(`${apiUrl}/v1/leads/demo`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				name: name.trim(),
				business: business.trim(),
				email: email.trim(),
				phone: phone.trim(),
				trade: trade.trim(),
			}),
		})
			.then(async (response) => {
				if (response.ok) {
					setSubmission({ phase: 'done' });
					return;
				}
				const body = (await response.json().catch(() => null)) as { message?: string } | null;
				setSubmission({ phase: 'error', message: body?.message ?? RETRY_MESSAGE });
			})
			.catch(() => {
				setSubmission({ phase: 'error', message: RETRY_MESSAGE });
			});
	};

	return (
		<div className="join-card">
			<h2 className="join-card__title">Tell us where to reach you</h2>
			<p className="join-card__lead">
				A real person — not a bot — will get back to you within one business day, walk you through
				Rivus live, and answer anything about your setup.
			</p>

			<form className="join-form" aria-label="Request a demo" onSubmit={handleSubmit}>
				<div className="join-form__field">
					<label htmlFor="demo-name">Full name</label>
					<input
						id="demo-name"
						type="text"
						required
						autoComplete="name"
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</div>
				<div className="join-form__field">
					<label htmlFor="demo-business">Business name (optional)</label>
					<input
						id="demo-business"
						type="text"
						autoComplete="organization"
						value={business}
						onChange={(event) => setBusiness(event.target.value)}
					/>
				</div>
				<div className="join-form__field">
					<label htmlFor="demo-email">Email</label>
					<input
						id="demo-email"
						type="email"
						required
						autoComplete="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
					/>
				</div>
				<div className="join-form__field">
					<label htmlFor="demo-phone">Phone (optional)</label>
					<input
						id="demo-phone"
						type="tel"
						autoComplete="tel"
						aria-describedby="demo-phone-consent"
						value={phone}
						onChange={(event) => setPhone(event.target.value)}
					/>
					{/* The canonical SMS consent disclosure from @rivus/core — carrier
					    vetting requires the identical text on every surface where Rivus
					    collects a mobile number. */}
					<p id="demo-phone-consent" className="join-form__consent">
						{SMS_CONSENT_DISCLOSURE} See our <Link href="/sms-terms">SMS terms</Link> and{' '}
						<Link href="/privacy">privacy policy</Link>.
					</p>
				</div>
				<div className="join-form__field">
					<label htmlFor="demo-trade">What kind of business? (optional)</label>
					<input
						id="demo-trade"
						type="text"
						placeholder="Plumbing, salon, clinic, …"
						value={trade}
						onChange={(event) => setTrade(event.target.value)}
					/>
				</div>

				{submission.phase === 'error' ? (
					<p className="join-form__error" role="alert">
						{submission.message}
					</p>
				) : null}

				<button type="submit" className="btn btn--primary" disabled={submitting}>
					{submitting ? 'Sending…' : 'Request my demo'}
				</button>

				<p className="join-form__consent">
					Prefer email? Write to <a href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a> and we'll set
					it up from there.
				</p>
			</form>
		</div>
	);
}
