import {
	type OnboardingStatus,
	onboarding,
	onboardingStats,
	onboardingStatusLabels,
} from '../../lib/admin';

const pillVariant: Record<OnboardingStatus, 'good' | 'warn' | 'bad'> = {
	'on-track': 'good',
	waiting: 'warn',
	blocked: 'bad',
};

function initialsOf(name: string): string {
	return name
		.split(' ')
		.map((word) => word.charAt(0))
		.join('')
		.slice(0, 2)
		.toUpperCase();
}

export function OnboardingScreen() {
	return (
		<div className="admin-page admin-page--mid">
			<div className="admin-head">
				<div>
					<h1 className="admin-h1 admin-h1--sm">Onboarding</h1>
					<div className="admin-subtitle">
						24 businesses in setup · avg 1.2 days to live · free specialist on each
					</div>
				</div>
				<div className="admin-actions admin-head-tools">
					<button type="button" className="admin-btn admin-btn--primary admin-btn--sm">
						Assign specialist
					</button>
				</div>
			</div>

			<div className="admin-onbstats">
				{onboardingStats.map((stat) => (
					<div key={stat.label} className="admin-onbstat">
						<div className="admin-onbstat__label">{stat.label}</div>
						<div
							className={
								stat.tone === 'danger'
									? 'admin-onbstat__value admin-onbstat__value--danger'
									: 'admin-onbstat__value'
							}
						>
							{stat.value}
						</div>
					</div>
				))}
			</div>

			<div className="admin-table">
				{onboarding.map((entry) => (
					<div key={entry.name} className="admin-onb">
						<span className="admin-sq admin-sq--onboarding admin-onb__av">{entry.initials}</span>
						<div className="admin-onb__id">
							<div className="admin-rowtitle">{entry.name}</div>
							<div className="admin-rowsub">{entry.loc}</div>
						</div>
						<div className="admin-onb__progress">
							<div className="admin-onb__progress-top">
								<span className="admin-onb__stage">{entry.stage}</span>
								<span className="admin-onb__pct">{entry.pct}</span>
							</div>
							<div className="admin-progress">
								<div className="admin-progress__fill" style={{ width: entry.pct }} />
							</div>
						</div>
						<div className="admin-onb__spec">
							<span className="admin-sq admin-sq--specialist admin-onb__spec-av">
								{initialsOf(entry.specialist)}
							</span>
							<span>{entry.specialist}</span>
						</div>
						<div className="admin-onb__eta">
							<div className="admin-onb__eta-d">{entry.eta}</div>
							<span
								className={`admin-pill admin-pill--sm admin-pill--${pillVariant[entry.status]}`}
							>
								{onboardingStatusLabels[entry.status]}
							</span>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
