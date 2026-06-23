'use client';

import { usePathname } from 'next/navigation';
import { adminNav, adminUser } from '../../lib/admin';
import { BrandImg } from '../marketing/brand-img';
import { AdminNavIcon, ChevronDownIcon } from './admin-icons';

export function AdminSidebar() {
	const pathname = usePathname();

	return (
		<aside className="admin-sidebar">
			<div className="admin-sidebar__brand">
				<BrandImg
					className="admin-sidebar__logo"
					src="/assets/rivus-horizontal-white.svg"
					alt="Rivus"
				/>
				<span className="admin-badge">ADMIN</span>
			</div>

			<nav className="admin-nav">
				{adminNav.map((item) => {
					const active = pathname === item.href;
					return (
						<a
							key={item.href}
							href={item.href}
							className={active ? 'admin-navitem admin-navitem--active' : 'admin-navitem'}
							aria-current={active ? 'page' : undefined}
						>
							<AdminNavIcon name={item.icon} size={18} />
							<span className="admin-navitem__label">{item.label}</span>
							{item.count ? <span className="admin-navitem__count">{item.count}</span> : null}
							{item.badge ? (
								<span className={`admin-navitem__badge admin-navitem__badge--${item.badgeTone}`}>
									{item.badge}
								</span>
							) : null}
						</a>
					);
				})}

				<div className="admin-sidebar__divider" />
				<div className="admin-sidebar__label">SYSTEM</div>
				<div className="admin-status">
					<span className="admin-status__dot" />
					All channels operational
				</div>
				<div className="admin-status">
					<span className="admin-status__dot" />
					QuickBooks sync healthy
				</div>
			</nav>

			<div className="admin-sidebar__foot">
				<button type="button" className="admin-user">
					<span className="admin-grad-avatar admin-user__avatar">{adminUser.initials}</span>
					<span className="admin-user__meta">
						<span className="admin-user__name">{adminUser.name}</span>
						<span className="admin-user__role">{adminUser.role}</span>
					</span>
					<ChevronDownIcon className="admin-user__chev" size={15} />
				</button>
			</div>
		</aside>
	);
}
