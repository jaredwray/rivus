'use client';

import Link from 'next/link';
import { useState } from 'react';
import { appUrl, navLinks } from '../../lib/site';
import { BrandImg } from './brand-img';
import { MenuIcon } from './icons';

export function SiteNav() {
	const [open, setOpen] = useState(false);
	const close = () => setOpen(false);

	return (
		<nav className={open ? 'nav nav--open' : 'nav'}>
			<div className="nav__inner">
				<Link href="/" aria-label="Rivus home">
					<BrandImg
						className="nav__logo"
						src="/assets/rivus-horizontal.svg"
						alt="Rivus"
						height={28}
					/>
				</Link>
				<div className="nav__links">
					{navLinks.map((link) => (
						<Link key={link.href} className="nav__link" href={link.href}>
							{link.label}
						</Link>
					))}
				</div>
				<a className="nav__signin" href={`${appUrl}/login`}>
					Sign in
				</a>
				<div className="nav__actions">
					<Link className="btn btn--primary nav__cta" href="/#cta">
						Get started
					</Link>
					<button
						type="button"
						className="nav__menu-btn"
						aria-label="Toggle menu"
						aria-expanded={open}
						aria-controls="nav-mobile"
						onClick={() => setOpen((o) => !o)}
					>
						<MenuIcon size={20} />
					</button>
				</div>
			</div>
			<div className="nav__mobile" id="nav-mobile">
				{navLinks.map((link) => (
					<Link key={link.href} href={link.href} onClick={close}>
						{link.label}
					</Link>
				))}
				<a href={`${appUrl}/login`} onClick={close}>
					Sign in
				</a>
			</div>
		</nav>
	);
}
