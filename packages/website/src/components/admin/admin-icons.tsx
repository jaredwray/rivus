import type { ComponentType } from 'react';
import type { IconProps } from '../marketing/icons';

/**
 * Icon set for the staff console. Stroke icons draw with `currentColor` so CSS
 * controls them; the Google mark keeps its brand colors. Decorative — meaning is
 * carried by adjacent text — so all are aria-hidden.
 */

function Stroke({ size = 24, strokeWidth = 1.8, children, ...rest }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
			{...rest}
		>
			{children}
		</svg>
	);
}

export const GridIcon = (props: IconProps) => (
	<Stroke {...props}>
		<rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
		<rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
		<rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
		<rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
	</Stroke>
);

export const BuildingIcon = (props: IconProps) => (
	<Stroke {...props}>
		<path d="M3 21h18" />
		<path d="M5 21V7l7-4 7 4v14" />
		<path d="M9 9h0M9 13h0M9 17h0M15 9h0M15 13h0M15 17h0" />
	</Stroke>
);

export const LeafIcon = (props: IconProps) => (
	<Stroke {...props}>
		<path d="M12 2.5c3.5 1.5 6 5 6 9.5 0 2-1 4.5-2 6H8c-1-1.5-2-4-2-6 0-4.5 2.5-8 6-9.5z" />
		<circle cx="12" cy="10" r="2" />
		<path d="M9 18l-1.5 3M15 18l1.5 3" />
	</Stroke>
);

export const AlertIcon = (props: IconProps) => (
	<Stroke {...props}>
		<path d="M12 3l9 16H3z" />
		<path d="M12 10v4M12 17h.01" />
	</Stroke>
);

export const SearchIcon = (props: IconProps) => (
	<Stroke {...props}>
		<circle cx="11" cy="11" r="7" />
		<path d="M20 20l-3.5-3.5" />
	</Stroke>
);

export const BellIcon = (props: IconProps) => (
	<Stroke {...props}>
		<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
		<path d="M13.7 21a2 2 0 0 1-3.4 0" />
	</Stroke>
);

export const GlobeIcon = (props: IconProps) => (
	<Stroke {...props}>
		<circle cx="12" cy="12" r="9" />
		<path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
	</Stroke>
);

export const ChevronDownIcon = (props: IconProps) => (
	<Stroke {...props}>
		<path d="M6 9l6 6 6-6" />
	</Stroke>
);

export const ChevronLeftIcon = (props: IconProps) => (
	<Stroke {...props}>
		<path d="M15 6l-6 6 6 6" />
	</Stroke>
);

export const PlusIcon = (props: IconProps) => (
	<Stroke strokeWidth={2} {...props}>
		<path d="M12 5v14M5 12h14" />
	</Stroke>
);

export const DownloadIcon = (props: IconProps) => (
	<Stroke {...props}>
		<path d="M12 3v12M7 10l5 5 5-5" />
		<path d="M5 21h14" />
	</Stroke>
);

export const LockIcon = (props: IconProps) => (
	<Stroke strokeWidth={2} {...props}>
		<rect x="4" y="10" width="16" height="11" rx="2" />
		<path d="M8 10V7a4 4 0 0 1 8 0v3" />
	</Stroke>
);

export const ClockIcon = (props: IconProps) => (
	<Stroke strokeWidth={2} {...props}>
		<circle cx="12" cy="12" r="9" />
		<path d="M12 7v5l3 2" />
	</Stroke>
);

export const UserIcon = (props: IconProps) => (
	<Stroke strokeWidth={1.7} {...props}>
		<circle cx="12" cy="8" r="3.4" />
		<path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
	</Stroke>
);

export const GoogleIcon = ({ size = 19, ...rest }: IconProps) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		aria-hidden="true"
		focusable="false"
		{...rest}
	>
		<path
			fill="#4285F4"
			d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
		/>
		<path
			fill="#34A853"
			d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
		/>
		<path
			fill="#FBBC05"
			d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
		/>
		<path
			fill="#EA4335"
			d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
		/>
	</svg>
);

export type AdminIconName = 'grid' | 'building' | 'leaf' | 'alert';

const navIcons: Record<AdminIconName, ComponentType<IconProps>> = {
	grid: GridIcon,
	building: BuildingIcon,
	leaf: LeafIcon,
	alert: AlertIcon,
};

/** Render a nav icon by its content-data name. */
export function AdminNavIcon({ name, ...props }: IconProps & { name: AdminIconName }) {
	const Glyph = navIcons[name];
	return <Glyph {...props} />;
}
