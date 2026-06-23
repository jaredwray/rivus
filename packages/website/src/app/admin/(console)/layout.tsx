import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AdminBottomNav } from '../../../components/admin/admin-bottom-nav';
import { AdminMobileHeader } from '../../../components/admin/admin-mobile-header';
import { AdminSidebar } from '../../../components/admin/admin-sidebar';
import { AdminTopbar } from '../../../components/admin/admin-topbar';
import '../admin.css';

export const metadata: Metadata = {
	title: 'Console — Rivus',
	// Staff-only surface; keep it out of search indexes.
	robots: { index: false, follow: false },
};

export default function ConsoleLayout({ children }: { children: ReactNode }) {
	return (
		<div className="admin">
			<AdminSidebar />
			<div className="admin-main">
				<AdminMobileHeader />
				<AdminTopbar />
				<div className="admin-content">{children}</div>
				<AdminBottomNav />
			</div>
		</div>
	);
}
