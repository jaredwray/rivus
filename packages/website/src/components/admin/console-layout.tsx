import type { ReactNode } from 'react';
import { AdminBottomNav } from './admin-bottom-nav';
import { AdminMobileHeader } from './admin-mobile-header';
import { AdminSidebar } from './admin-sidebar';
import { AdminTopbar } from './admin-topbar';

export function ConsoleLayout({ children, pathname }: { children: ReactNode; pathname: string }) {
	return (
		<div className="admin">
			<AdminSidebar pathname={pathname} />
			{/* id="main" is the root layout's skip-link target. */}
			<div id="main" className="admin-main">
				<AdminMobileHeader />
				<AdminTopbar />
				<div className="admin-content">{children}</div>
				<AdminBottomNav pathname={pathname} />
			</div>
		</div>
	);
}
