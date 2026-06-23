'use client';

import { useState } from 'react';
import { navLinks } from '../../lib/site';
import { BrandImg } from './brand-img';
import { MenuIcon } from './icons';

export function SiteNav() {
	const [open, setOpen] = useState(false);
	const close = () => setOpen(false);

	return (
		<nav className={open ? 'nav nav--open' : 'nav'}>
			<div className="nav__inner">
				<a href="/" aria-label="Rivus home">
					<BrandImg
						className="nav__logo"
						src="/assets/rivus-horizontal.svg"
						alt="Rivus"
						height={28}
					/>
				</a>
				<div className="nav__links">
					{navLinks.map((link) => (
						<a key={link.href} className="nav__link" href={link.href}>
							{link.label}
						</a>
					))}
				</div>
				<a className="nav__signin" href="/login">
					Sign in
				</a>
				<div className="nav__actions">
					<a className="btn btn--primary nav__cta" href="/#cta">
						Get started
					</a>
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
					<a key={link.href} href={link.href} onClick={close}>
						{link.label}
					</a>
				))}
				<a href="/login" onClick={close}>
					Sign in
				</a>
			</div>
		</nav>
	);
}
