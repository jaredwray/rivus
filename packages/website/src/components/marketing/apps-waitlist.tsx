'use client';

import { type FormEvent, useState } from 'react';
import { apiUrl } from '../../lib/site';
import { CheckIcon } from './icons';

type Submission =
	| { phase: 'idle' }
	| { phase: 'submitting' }
	| { phase: 'error'; message: string }
	| { phase: 'done' };

const RETRY_MESSAGE = 'Something went wrong on our end. Check your connection and try again.';

/**
 * Email capture for the native-app waitlist on /apps. Reuses the public leads
 * endpoint with the 'apps-waitlist' source, so signups land in the same
 * sales-visible queue as demo requests.
 */
export function AppsWaitlist() {
	const [submission, setSubmission] = useState<Submission>({ phase: 'idle' });
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');

	if (submission.phase === 'done') {
		return (
			// role="status" announces the outcome — the submit button the user just
			// activated unmounts with the form.
			<div className="join-card join-card--center" role="status">
				<div className="tile tile--lg tile--green join-card__check" aria-hidden="true">
					<CheckIcon size={22} />
				</div>
				<h3 className="join-card__title">You're on the list</h3>
				<p className="join-card__lead">
					We'll email you the moment the iPhone and Android apps ship. Until then, everything runs
					in the web app.
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
				email: email.trim(),
				source: 'apps-waitlist',
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
			<h3 className="join-card__title">Get the apps first</h3>
			<p className="join-card__lead">
				Join the waitlist and we'll email you the day the native iPhone and Android apps are ready —
				nothing else, no newsletter.
			</p>
			<form className="join-form" aria-label="Join the apps waitlist" onSubmit={handleSubmit}>
				<div className="join-form__field">
					<label htmlFor="waitlist-name">Full name</label>
					<input
						id="waitlist-name"
						type="text"
						required
						autoComplete="name"
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</div>
				<div className="join-form__field">
					<label htmlFor="waitlist-email">Email</label>
					<input
						id="waitlist-email"
						type="email"
						required
						autoComplete="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
					/>
				</div>

				{submission.phase === 'error' ? (
					<p className="join-form__error" role="alert">
						{submission.message}
					</p>
				) : null}

				<button type="submit" className="btn btn--primary" disabled={submitting}>
					{submitting ? 'Adding you…' : 'Join the waitlist'}
				</button>
			</form>
		</div>
	);
}
