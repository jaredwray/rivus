import { adminUser } from '../../lib/admin';
import { BrandImg } from '../marketing/brand-img';
import { BellIcon } from './admin-icons';

export function AdminMobileHeader() {
	return (
		<div className="admin-mobileheader">
			<div className="admin-mobileheader__brand">
				<BrandImg
					className="admin-mobileheader__logo"
					src="/assets/rivus-horizontal-white.svg"
					alt="Rivus"
				/>
				<span className="admin-badge">ADMIN</span>
			</div>
			<div className="admin-mobileheader__actions">
				<button
					type="button"
					className="admin-iconbtn admin-iconbtn--dark"
					aria-label="Notifications"
				>
					<BellIcon size={17} />
					<span className="admin-iconbtn__dot" />
				</button>
				<span className="admin-grad-avatar admin-mobileheader__avatar">{adminUser.initials}</span>
			</div>
		</div>
	);
}
