import { type AccountStatus, accountStatusLabels, accounts } from '../../lib/admin';
import { PlusIcon, SearchIcon } from './admin-icons';

const pillVariant: Record<AccountStatus, 'good' | 'warn' | 'bad'> = {
	active: 'good',
	trial: 'warn',
	risk: 'bad',
};

export function AccountsScreen() {
	return (
		<div className="admin-page">
			<div className="admin-head">
				<div>
					<h1 className="admin-h1 admin-h1--sm">Accounts</h1>
					<div className="admin-subtitle">1,284 businesses on Rivus · {accounts.length} shown</div>
				</div>
				<div className="admin-actions admin-head-tools">
					<div className="admin-tabs">
						<span className="admin-tab admin-tab--active">All</span>
						<span className="admin-tab">Active</span>
						<span className="admin-tab">Trials</span>
						<span className="admin-tab">
							<span className="admin-tab__dot" />
							At risk
						</span>
					</div>
					<button type="button" className="admin-btn admin-btn--primary admin-btn--sm">
						<PlusIcon size={15} />
						Add account
					</button>
				</div>
			</div>

			{/* Desktop table */}
			<div className="admin-table">
				<div className="admin-trow admin-trow--head">
					<span>Account</span>
					<span>Plan</span>
					<span className="admin-cell-r">MRR</span>
					<span>Channels</span>
					<span>Specialist</span>
					<span className="admin-cell-r">Status</span>
				</div>
				{accounts.map((account) => (
					<div key={account.name} className="admin-trow admin-trow--body">
						<div className="admin-trow__name">
							<span className="admin-sq admin-sq--account admin-trow__av">{account.initials}</span>
							<div style={{ minWidth: 0 }}>
								<div className="admin-rowtitle">{account.name}</div>
								<div className="admin-rowsub">{account.loc}</div>
							</div>
						</div>
						<span className="admin-cell-plan">{account.plan}</span>
						<span className="admin-cell-mrr">{account.mrr}</span>
						<span className="admin-cell-channels">{account.channels}</span>
						<div className="admin-cell-spec">
							<span className="admin-dot-good" />
							<span>{account.specialist}</span>
						</div>
						<span className={`admin-pill admin-pill--${pillVariant[account.status]}`}>
							{accountStatusLabels[account.status]}
						</span>
					</div>
				))}
			</div>

			{/* Mobile cards */}
			<div className="admin-acctcards">
				<div className="admin-searchbar" aria-hidden="true">
					<SearchIcon size={16} />
					<span>Search accounts…</span>
				</div>
				{accounts.map((account) => (
					<div key={account.name} className="admin-acctcard">
						<span className="admin-sq admin-sq--account admin-acctcard__av">
							{account.initials}
						</span>
						<div style={{ flex: 1, minWidth: 0 }}>
							<div className="admin-rowtitle">{account.name}</div>
							<div className="admin-rowsub">
								{account.plan} · {account.mrr}/mo · {account.loc}
							</div>
						</div>
						<span
							className={`admin-pill admin-pill--sm admin-pill--${pillVariant[account.status]}`}
						>
							{accountStatusLabels[account.status]}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
