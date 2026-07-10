'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { apiUrl } from '../../lib/site';
import { CheckIcon } from './icons';

interface PublicAccount {
	name: string;
	slug: string;
}

type Lookup =
	| { phase: 'loading' }
	| { phase: 'not-found' }
	| { phase: 'unreachable' }
	| { phase: 'loaded'; account: PublicAccount };

type Submission =
	| { phase: 'idle' }
	| { phase: 'submitting' }
	| { phase: 'error'; message: string }
	| { phase: 'done' };

const RETRY_MESSAGE = 'Something went wrong on our end. Check your connection and try again.';

/**
 * The public "add yourself as a customer" form. The Rivus scheduling agent
 * links unrecognized email senders here; after registering, the visitor goes
 * back to their inbox and replies to Rivus to pick a time.
 *
 * Uses `useSearchParams` (to prefill the email the agent already saw), so the
 * page wraps it in a `<Suspense>` boundary as Next requires.
 */
export function CustomerJoin({ slug }: { slug: string }) {
	const searchParams = useSearchParams();
	const [lookup, setLookup] = useState<Lookup>({ phase: 'loading' });
	const [submission, setSubmission] = useState<Submission>({ phase: 'idle' });
	const [name, setName] = useState('');
	const [email, setEmail] = useState(searchParams.get('email') ?? '');
	const [phone, setPhone] = useState('');
	const [address, setAddress] = useState('');

	useEffect(() => {
		let active = true;
		fetch(`${apiUrl}/v1/public/accounts/${encodeURIComponent(slug)}`)
			.then(async (response) => {
				if (response.status === 404) {
					// Only a definitive 404 means the business doesn't exist — an
					// outage must not tell the visitor the link is dead.
					if (active) {
						setLookup({ phase: 'not-found' });
					}
					return;
				}
				if (!response.ok) {
					throw new Error('lookup failed');
				}
				const account = (await response.json()) as PublicAccount;
				if (active) {
					setLookup({ phase: 'loaded', account });
				}
			})
			.catch(() => {
				if (active) {
					setLookup({ phase: 'unreachable' });
				}
			});
		return () => {
			active = false;
		};
	}, [slug]);

	if (lookup.phase === 'loading') {
		return (
			<p className="join__status" role="status">
				Looking up the business…
			</p>
		);
	}

	if (lookup.phase === 'not-found') {
		return (
			<div className="join-card join-card--center">
				<h1 className="join-card__title">We couldn't find this business</h1>
				<p className="join-card__lead">
					The link may be out of date, or the business may no longer use Rivus. Double-check the
					link in your email, or reply to the business directly.
				</p>
			</div>
		);
	}

	if (lookup.phase === 'unreachable') {
		return (
			<div className="join-card join-card--center" role="alert">
				<h1 className="join-card__title">We couldn't load this page</h1>
				<p className="join-card__lead">{RETRY_MESSAGE}</p>
			</div>
		);
	}

	const { account } = lookup;

	if (submission.phase === 'done') {
		return (
			// role="status" announces the success to screen readers — the submit
			// button the user just activated is unmounted with the form, so without
			// a live region the outcome would be silent.
			<div className="join-card join-card--center" role="status">
				<div className="tile tile--lg tile--green join-card__check" aria-hidden="true">
					<CheckIcon size={22} />
				</div>
				<h1 className="join-card__title">You're all set</h1>
				<p className="join-card__lead">
					{account.name} has your details. Now go back to your email and reply to Rivus to pick a
					time that works for you — it'll take care of the rest.
				</p>
			</div>
		);
	}

	const submitting = submission.phase === 'submitting';

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setSubmission({ phase: 'submitting' });
		fetch(`${apiUrl}/v1/public/accounts/${encodeURIComponent(account.slug)}/customers`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				name: name.trim(),
				email: email.trim(),
				phone: phone.trim(),
				address: address.trim(),
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
			<p className="eyebrow">Join as a customer</p>
			<h1 className="join-card__title">Join {account.name}</h1>
			<p className="join-card__lead">
				{account.name} uses Rivus to book appointments over email. Add your details once, and Rivus
				can find you a time, send reminders, and keep everything on the schedule.
			</p>

			<form className="join-form" aria-label="Join as a customer" onSubmit={handleSubmit}>
				<div className="join-form__field">
					<label htmlFor="join-name">Full name</label>
					<input
						id="join-name"
						type="text"
						required
						autoComplete="name"
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</div>
				<div className="join-form__field">
					<label htmlFor="join-email">Email</label>
					<input
						id="join-email"
						type="email"
						required
						autoComplete="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
					/>
				</div>
				<div className="join-form__field">
					<label htmlFor="join-phone">Phone (optional)</label>
					<input
						id="join-phone"
						type="tel"
						autoComplete="tel"
						aria-describedby="join-phone-consent"
						value={phone}
						onChange={(event) => setPhone(event.target.value)}
					/>
					{/* SMS opt-in disclosure — carrier (A2P/CTIA) compliance requires it
					    at the point where the number is collected. */}
					<p id="join-phone-consent" className="join-form__consent">
						By providing your phone number, you agree that {account.name} may text or call you about
						your appointments and services, including automated texts sent through Rivus. Consent is
						not a condition of purchase. Message frequency varies; message and data rates may apply.
						Reply STOP to opt out or HELP for help. See our <Link href="/sms-terms">SMS terms</Link>{' '}
						and <Link href="/privacy">privacy policy</Link>.
					</p>
				</div>
				<div className="join-form__field">
					<label htmlFor="join-address">Address (optional)</label>
					<input
						id="join-address"
						type="text"
						autoComplete="street-address"
						value={address}
						onChange={(event) => setAddress(event.target.value)}
					/>
				</div>

				{submission.phase === 'error' ? (
					<p className="join-form__error" role="alert">
						{submission.message}
					</p>
				) : null}

				<button type="submit" className="btn btn--primary" disabled={submitting}>
					{submitting ? 'Adding you…' : 'Add me as a customer'}
				</button>
			</form>
		</div>
	);
}
