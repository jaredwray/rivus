import {
	accountsByPlan,
	adminUser,
	conversationBars,
	escalations,
	escalationTone,
	kpis,
	onboarding,
} from '../../lib/admin';
import { DownloadIcon, PlusIcon } from './admin-icons';

export function Overview() {
	const today = new Date().toLocaleDateString('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
	});
	return (
		<div className="admin-page">
			<div className="admin-head">
				<div>
					<div className="admin-eyebrow">{today}</div>
					<h1 className="admin-h1">Good morning, {adminUser.firstName}</h1>
				</div>
				<div className="admin-actions">
					<button type="button" className="admin-btn admin-btn--ghost">
						<DownloadIcon size={15} />
						Export
					</button>
					<button type="button" className="admin-btn admin-btn--primary">
						<PlusIcon size={15} />
						Add account
					</button>
				</div>
			</div>

			<div className="admin-kpis">
				{kpis.map((kpi) => (
					<div
						key={kpi.label}
						className={kpi.desktopOnly ? 'admin-kpi admin-kpi--desktop' : 'admin-kpi'}
					>
						<div className="admin-kpi__label">{kpi.label}</div>
						<div className="admin-kpi__value">
							<b>{kpi.value}</b>
							{kpi.delta ? (
								<span className={`admin-kpi__delta admin-kpi__delta--${kpi.deltaTone}`}>
									{kpi.delta}
								</span>
							) : null}
						</div>
						<div className="admin-kpi__sub">{kpi.sub}</div>
					</div>
				))}
			</div>

			<div className="admin-charts">
				<div className="admin-card">
					<div className="admin-card__head">
						<h3>Conversations handled</h3>
						<span className="admin-muted">Last 14 days</span>
					</div>
					<div className="admin-bars">
						{conversationBars.map((height, index) => {
							const isToday = index === conversationBars.length - 1;
							return (
								<div key={`bar-${height}`} className="admin-bar">
									<div
										className={
											isToday ? 'admin-bar__fill admin-bar__fill--today' : 'admin-bar__fill'
										}
										style={{ height: `${height}%` }}
									/>
								</div>
							);
						})}
					</div>
					<div className="admin-chart__foot">
						<span>612K conversations</span>
						<b>+22% vs prior 14d</b>
					</div>
				</div>

				<div className="admin-card admin-card--desktop">
					<div className="admin-card__head">
						<h3>Accounts by plan</h3>
					</div>
					{accountsByPlan.map((plan) => (
						<div key={plan.name} className="admin-plan__row">
							<div className="admin-plan__top">
								<span>{plan.name}</span>
								<span>{plan.count}</span>
							</div>
							<div className={`admin-plan__bar admin-plan__bar--${plan.tone}`}>
								<i style={{ width: `${plan.pct}%` }} />
							</div>
						</div>
					))}
					<div className="admin-plan__foot">
						<div>
							<small>Net revenue retention</small>
							<div>112%</div>
						</div>
						<div style={{ textAlign: 'right' }}>
							<small>Churn</small>
							<div className="up">1.4%</div>
						</div>
					</div>
				</div>
			</div>

			<div className="admin-queues">
				<div className="admin-card admin-queue--onboarding">
					<div className="admin-card__head">
						<h3>Onboarding queue</h3>
						<a className="admin-viewall" href="/admin/onboarding">
							View all
						</a>
					</div>
					<div className="admin-stack">
						{onboarding.slice(0, 4).map((entry) => (
							<div key={entry.name} className="admin-onbrow">
								<span className="admin-sq admin-sq--onboarding admin-onbrow__av">
									{entry.initials}
								</span>
								<div className="admin-onbrow__meta">
									<div className="admin-rowtitle">{entry.name}</div>
									<div className="admin-rowsub">
										{entry.specialist} · {entry.stage}
									</div>
								</div>
								<div className="admin-onbrow__bar">
									<div className="admin-progress admin-progress--sm">
										<div className="admin-progress__fill" style={{ width: entry.pct }} />
									</div>
								</div>
							</div>
						))}
					</div>
				</div>

				<div className="admin-card">
					<div className="admin-card__head">
						<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
							<span
								className="admin-status__dot"
								style={{ background: '#f0584b', boxShadow: 'none' }}
							/>
							<h3>Recent escalations</h3>
						</div>
						<a className="admin-viewall" href="/admin/escalations">
							View all
						</a>
					</div>
					<div className="admin-stack">
						{escalations.slice(0, 3).map((item) => (
							<a key={item.account} className="admin-escrow" href="/admin/escalations">
								<span className={`admin-tag admin-tag--${escalationTone(item.type)}`}>
									{item.type}
								</span>
								<div className="admin-esc__body">
									<div className="admin-esc__account">{item.account}</div>
									<div className="admin-esc__detail">{item.detail}</div>
								</div>
								<span className="admin-escrow__time">{item.time}</span>
							</a>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
