import type { AnchorHTMLAttributes, ReactNode } from 'react';

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
	href: string;
	children?: ReactNode;
}

/**
 * Site-internal navigation. The marketing site is a multi-page Astro build, so
 * this is a real `<a>` — no client-side router.
 */
export function Link({ href, children, ...rest }: LinkProps) {
	return (
		<a href={href} {...rest}>
			{children}
		</a>
	);
}
