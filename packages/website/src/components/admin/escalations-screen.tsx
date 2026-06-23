import { escalations, escalationTone } from '../../lib/admin';

export function EscalationsScreen() {
	return (
		<div className="admin-page admin-page--mid">
			<div className="admin-head">
				<div>
					<h1 className="admin-h1 admin-h1--sm">Escalations</h1>
					<div className="admin-subtitle">
						37 open · 8 urgent · things Rivus flagged for a human
					</div>
				</div>
				<div className="admin-head-tools">
					<div className="admin-tabs">
						<span className="admin-tab admin-tab--active">All</span>
						<span className="admin-tab">Urgent</span>
						<span className="admin-tab">Unassigned</span>
					</div>
				</div>
			</div>

			<div className="admin-stack">
				{escalations.map((item) => (
					<div key={`${item.account}-${item.detail}`} className="admin-esc">
						<span className={`admin-tag admin-tag--block admin-tag--${escalationTone(item.type)}`}>
							{item.type}
						</span>
						<div className="admin-esc__body">
							<div className="admin-esc__account">{item.account}</div>
							<div className="admin-esc__detail">{item.detail}</div>
						</div>
						<span
							className={
								item.urgent
									? 'admin-pill admin-pill--sm admin-pill--bad admin-esc__urgent'
									: 'admin-pill admin-pill--sm admin-pill--muted admin-esc__urgent'
							}
						>
							{item.urgent ? 'Urgent' : 'Normal'}
						</span>
						<span
							className={
								item.owner === 'Unassigned'
									? 'admin-esc__owner admin-esc__owner--unassigned'
									: 'admin-esc__owner'
							}
						>
							{item.owner}
						</span>
						<span className="admin-esc__time">{item.time}</span>
						<button type="button" className="admin-btn admin-btn--dark admin-esc__action">
							Review
						</button>
					</div>
				))}
			</div>
		</div>
	);
}
