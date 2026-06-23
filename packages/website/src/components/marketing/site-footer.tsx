import Link from 'next/link';
import { footerColumns, siteConfig } from '../../lib/site';
import { ApiStatus } from '../api-status';
import { BrandImg } from './brand-img';

export function SiteFooter() {
	return (
		<footer className="footer">
			<div className="footer__inner">
				<div className="footer__top">
					<div className="footer__brand">
						<BrandImg
							className="footer__logo"
							src="/assets/rivus-horizontal-negative.svg"
							alt="Rivus"
							height={28}
						/>
						<p className="footer__tagline">
							The AI agent that runs your front office — so you can run your business.
						</p>
					</div>
					<div className="footer__cols">
						{footerColumns.map((column) => (
							<div key={column.title}>
								<div className="footer__col-title">{column.title}</div>
								<div className="footer__col-links">
									{column.links.map((link) => (
										<Link key={link.label} href={link.href}>
											{link.label}
										</Link>
									))}
								</div>
							</div>
						))}
					</div>
				</div>
				<div className="footer__bottom">
					<span>© {new Date().getFullYear()} Rivus. All rights reserved.</span>
					<ApiStatus />
					<span>{siteConfig.domains}</span>
				</div>
			</div>
		</footer>
	);
}
