/**
 * Standalone error UI. Astro's static build has no route-level error boundary
 * like Next's `error.tsx`; this remains the on-brand fallback the tests pin,
 * and a page can render it if a client island fails.
 */
export function ErrorPage({ reset }: { error: Error; reset: () => void }) {
	return (
		<main id="main" className="join">
			<div className="join__container">
				<div className="join-card join-card--center" role="alert">
					<p className="eyebrow">SOMETHING BROKE</p>
					<h1 className="join-card__title">That wasn't supposed to happen.</h1>
					<p className="join-card__lead">
						An unexpected error interrupted this page. Try again — and if it keeps happening, email{' '}
						<a href="mailto:support@rivus.ai">support@rivus.ai</a> and a human will dig in.
					</p>
					<div className="page-hero__actions">
						<button type="button" className="btn btn--primary" onClick={reset}>
							Try again
						</button>
						<a className="btn btn--outline" href="/">
							Back to the home page
						</a>
					</div>
				</div>
			</div>
		</main>
	);
}
