import { BellIcon, ChevronDownIcon, GlobeIcon, SearchIcon } from './admin-icons';

export function AdminTopbar() {
	return (
		<header className="admin-topbar">
			<div className="admin-search" aria-hidden="true">
				<SearchIcon size={16} />
				<span>Search accounts, specialists, escalations…</span>
			</div>
			<div className="admin-topbar__right">
				<div className="admin-chip">
					<GlobeIcon size={14} />
					<span>All regions</span>
					<ChevronDownIcon size={13} />
				</div>
				<div className="admin-env">
					<span className="admin-env__dot" />
					<span>Production</span>
				</div>
				<button type="button" className="admin-iconbtn" aria-label="Notifications">
					<BellIcon size={18} />
					<span className="admin-iconbtn__dot" />
				</button>
			</div>
		</header>
	);
}
