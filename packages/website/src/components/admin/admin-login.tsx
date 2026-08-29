import { useState } from 'react';
import { adminUser } from '../../lib/admin';
import { BrandImg } from '../marketing/brand-img';
import { ArrowRightIcon, CheckIcon } from '../marketing/icons';
import { ChevronLeftIcon, ClockIcon, GoogleIcon, LockIcon, UserIcon } from './admin-icons';

type Step = 'signin' | 'code' | 'done';

const OTP_SLOTS = ['1', '2', '3', '4', '5', '6'];

export function AdminLogin() {
	const [step, setStep] = useState<Step>('signin');

	return (
		// id="main" is the root layout's skip-link target.
		<div id="main" className="admin-login">
			<div className="admin-login__glow-a" aria-hidden="true" />
			<div className="admin-login__glow-b" aria-hidden="true" />

			<div className="admin-login__brand">
				<BrandImg
					className="admin-login__logo"
					src="/assets/rivus-horizontal-white.svg"
					alt="Rivus"
				/>
				<span className="admin-badge">ADMIN</span>
			</div>

			<div className="admin-login__card">
				{step === 'signin' ? (
					<>
						<h1 className="admin-login__title">Sign in to the console</h1>
						<p className="admin-login__sub">
							Use your Rivus team account. Passwordless — we'll send you a one-time code.
						</p>

						<button type="button" className="admin-login__oauth" onClick={() => setStep('done')}>
							<GoogleIcon size={19} />
							Continue with Google
						</button>

						<div className="admin-login__or">
							<span />
							<span>or</span>
							<span />
						</div>

						<label className="admin-login__field">
							<UserIcon size={18} />
							<input
								type="text"
								placeholder="Email or phone number"
								aria-label="Email or phone number"
							/>
						</label>

						<button type="button" className="admin-login__submit" onClick={() => setStep('code')}>
							Send code
							<ArrowRightIcon size={17} />
						</button>

						<div className="admin-login__note">
							<LockIcon size={14} />
							<span>SSO &amp; 2FA enforced for all team members</span>
						</div>
					</>
				) : null}

				{step === 'code' ? (
					<>
						<button type="button" className="admin-login__back" onClick={() => setStep('signin')}>
							<ChevronLeftIcon size={16} />
							Back
						</button>
						<h1 className="admin-login__title">Enter the code</h1>
						<p className="admin-login__sub">
							We sent a 6-digit code to <b>{adminUser.email}</b> ·{' '}
							<button type="button" className="admin-login__link" onClick={() => setStep('signin')}>
								Change
							</button>
						</p>

						<div className="admin-otp">
							{OTP_SLOTS.map((slot) => (
								<input
									key={slot}
									type="text"
									inputMode="numeric"
									maxLength={1}
									aria-label={`Digit ${slot}`}
								/>
							))}
						</div>

						<button type="button" className="admin-login__submit" onClick={() => setStep('done')}>
							Verify &amp; continue
						</button>

						<div className="admin-login__resend">
							<ClockIcon size={14} />
							<span>
								Resend code in <b>0:24</b>
							</span>
						</div>
					</>
				) : null}

				{step === 'done' ? (
					<div className="admin-login__done">
						<div className="admin-login__check">
							<CheckIcon size={38} />
						</div>
						<h1 className="admin-login__title">Welcome back, {adminUser.firstName}</h1>
						<p className="admin-login__sub">You're signed in to the Rivus team console.</p>
						<a className="admin-login__enter" href="/admin">
							Enter console
							<ArrowRightIcon size={17} />
						</a>
					</div>
				) : null}
			</div>
		</div>
	);
}
