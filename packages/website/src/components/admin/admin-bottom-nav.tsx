'use client';

import { usePathname } from 'next/navigation';
import { adminNav, urgentEscalations } from '../../lib/admin';
import { AdminNavIcon } from './admin-icons';

export function AdminBottomNav() {
	const pathname = usePathname();

	return (
		<nav className="admin-bottomnav">
			{adminNav.map((item) => {
				const active = pathname === item.href;
				return (
					<a
						key={item.href}
						href={item.href}
						className={
							active
								? 'admin-bottomnav__item admin-bottomnav__item--active'
								: 'admin-bottomnav__item'
						}
						aria-current={active ? 'page' : undefined}
					>
						{item.href === '/admin/escalations' ? (
							<span className="admin-bottomnav__badge">{urgentEscalations}</span>
						) : null}
						<AdminNavIcon name={item.icon} size={22} />
						<span>{item.label}</span>
					</a>
				);
			})}
		</nav>
	);
}
