import type { ComponentType, SVGProps } from 'react';

/**
 * Brand icon set for the marketing site. Every icon draws with `currentColor`
 * so callers control color via CSS, and is `aria-hidden` because the icons are
 * decorative — their meaning is always carried by adjacent text.
 */

export type IconName =
	| 'phone'
	| 'phone-off'
	| 'chat'
	| 'inbox'
	| 'mail'
	| 'whatsapp'
	| 'calendar'
	| 'card'
	| 'clock'
	| 'list'
	| 'trend-up'
	| 'doc'
	| 'newsletter'
	| 'check'
	| 'arrow-right'
	| 'play'
	| 'bolt'
	| 'sparkle'
	| 'star'
	| 'desktop'
	| 'apple'
	| 'android'
	| 'shield'
	| 'heart'
	| 'users'
	| 'pin'
	| 'menu';

export interface IconProps extends SVGProps<SVGSVGElement> {
	/** Pixel width/height of the square icon. Defaults to 24. */
	size?: number;
}

function Line({ size = 24, strokeWidth = 1.9, children, ...rest }: IconProps) {
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

function Solid({ size = 24, children, ...rest }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
			focusable="false"
			{...rest}
		>
			{children}
		</svg>
	);
}

export const PhoneIcon = (props: IconProps) => (
	<Line {...props}>
		<path d="M5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5V18a2 2 0 0 1-2 2A14 14 0 0 1 4 6a2 2 0 0 1 1-2z" />
	</Line>
);

export const PhoneOffIcon = (props: IconProps) => (
	<Line {...props}>
		<path d="M5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5V18a2 2 0 0 1-2 2A14 14 0 0 1 4 6a2 2 0 0 1 1-2z" />
		<path d="M2 2l20 20" />
	</Line>
);

export const ChatIcon = (props: IconProps) => (
	<Line {...props}>
		<path d="M4 5h16v11H10l-5 4v-4H4z" />
	</Line>
);

export const InboxIcon = (props: IconProps) => (
	<Line {...props}>
		<path d="M4 5h16v14H4z" />
		<path d="M4 13h4l2 3h4l2-3h4" />
	</Line>
);

export const MailIcon = (props: IconProps) => (
	<Line {...props}>
		<rect x="3" y="5" width="18" height="14" rx="2.5" />
		<path d="M4 7l8 5 8-5" />
	</Line>
);

export const WhatsappIcon = (props: IconProps) => (
	<Line {...props}>
		<path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3z" />
	</Line>
);

export const CalendarIcon = (props: IconProps) => (
	<Line {...props}>
		<rect x="3.5" y="4.5" width="17" height="16" rx="2" />
		<path d="M3.5 9h17M8 3v4M16 3v4" />
	</Line>
);

export const CardIcon = (props: IconProps) => (
	<Line {...props}>
		<path d="M3 7h18v12H3z" />
		<path d="M3 11h18" />
	</Line>
);

export const ClockIcon = (props: IconProps) => (
	<Line {...props}>
		<circle cx="12" cy="12" r="9" />
		<path d="M12 7v5l3 2" />
	</Line>
);

export const ListIcon = (props: IconProps) => (
	<Line {...props}>
		<path d="M4 5h16M4 12h16M4 19h10" />
	</Line>
);

export const TrendUpIcon = (props: IconProps) => (
	<Line {...props}>
		<path d="M3 17l5-5 3 3 7-7" />
		<path d="M16 8h5v5" />
	</Line>
);

export const DocIcon = (props: IconProps) => (
	<Line {...props}>
		<path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 0-2 2z" />
		<path d="M10 9h5M10 12.5h5" />
	</Line>
);

export const NewsletterIcon = (props: IconProps) => (
	<Line {...props}>
		<path d="M3 5h18v14H3z" />
		<path d="M3 8h18M7 12h10M7 15h6" />
	</Line>
);

export const CheckIcon = (props: IconProps) => (
	<Line strokeWidth={2.2} {...props}>
		<path d="M5 12l5 5L20 6" />
	</Line>
);

export const ArrowRightIcon = (props: IconProps) => (
	<Line strokeWidth={2.2} {...props}>
		<path d="M5 12h14M13 6l6 6-6 6" />
	</Line>
);

export const PlayIcon = (props: IconProps) => (
	<Solid {...props}>
		<path d="M8 5v14l11-7z" />
	</Solid>
);

export const BoltIcon = (props: IconProps) => (
	<Line strokeWidth={2.3} {...props}>
		<path d="M13 2 4 14h7l-1 8 9-12h-7z" />
	</Line>
);

export const SparkleIcon = (props: IconProps) => (
	<Line {...props}>
		<path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2-6.3-4.6L5.7 21l2.3-7.2-6-4.4h7.6z" />
	</Line>
);

export const StarIcon = (props: IconProps) => (
	<Solid {...props}>
		<path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17.8 5.9 20.4l1.5-6.8L2.2 9l6.9-.7z" />
	</Solid>
);

export const DesktopIcon = (props: IconProps) => (
	<Line {...props}>
		<rect x="2.5" y="4" width="19" height="13" rx="2" />
		<path d="M8 21h8M12 17v4" />
	</Line>
);

export const AppleIcon = (props: IconProps) => (
	<Solid {...props}>
		<path d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.02-3.76-2.05-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.89-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.79 1.3 10.34.86 1.25 1.88 2.65 3.22 2.6 1.29-.05 1.78-.83 3.34-.83 1.56 0 2 .83 3.37.81 1.39-.03 2.27-1.27 3.12-2.53.98-1.45 1.39-2.85 1.41-2.93-.03-.01-2.71-1.04-2.74-4.13zM14.6 4.59c.71-.86 1.19-2.06 1.06-3.25-1.02.04-2.26.68-2.99 1.54-.66.76-1.23 1.98-1.08 3.15 1.14.09 2.3-.58 3.01-1.44z" />
	</Solid>
);

export const AndroidIcon = (props: IconProps) => (
	<Solid {...props}>
		<path d="M5 8l-1.5-2.6a.5.5 0 0 1 .87-.5L5.93 7.5a8 8 0 0 1 6.14 0l1.59-2.6a.5.5 0 0 1 .87.5L13 8a7.5 7.5 0 0 1 3.5 6h-13A7.5 7.5 0 0 1 7 8.5zm3 3.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm6 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
	</Solid>
);

export const ShieldIcon = (props: IconProps) => (
	<Line {...props}>
		<path d="M12 3l7 3v5c0 4.6-3 8.2-7 10-4-1.8-7-5.4-7-10V6z" />
		<path d="M9 12l2 2 4-4" />
	</Line>
);

export const HeartIcon = (props: IconProps) => (
	<Line {...props}>
		<path d="M12 20.5S4 15 4 9.5A4.5 4.5 0 0 1 12 6.6a4.5 4.5 0 0 1 8 2.9c0 5.5-8 11-8 11z" />
	</Line>
);

export const UsersIcon = (props: IconProps) => (
	<Line {...props}>
		<circle cx="9" cy="8.5" r="3.5" />
		<path d="M3 20a6 6 0 0 1 12 0" />
		<path d="M16 5.6a3.5 3.5 0 0 1 0 5.8M17.5 14.5A6 6 0 0 1 21 20" />
	</Line>
);

export const PinIcon = (props: IconProps) => (
	<Line {...props}>
		<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
		<circle cx="12" cy="10" r="2.4" />
	</Line>
);

export const MenuIcon = (props: IconProps) => (
	<Line strokeWidth={2} {...props}>
		<path d="M4 7h16M4 12h16M4 17h16" />
	</Line>
);

/** Lookup table for icons referenced by name in the content data. */
export const icons: Record<IconName, ComponentType<IconProps>> = {
	phone: PhoneIcon,
	'phone-off': PhoneOffIcon,
	chat: ChatIcon,
	inbox: InboxIcon,
	mail: MailIcon,
	whatsapp: WhatsappIcon,
	calendar: CalendarIcon,
	card: CardIcon,
	clock: ClockIcon,
	list: ListIcon,
	'trend-up': TrendUpIcon,
	doc: DocIcon,
	newsletter: NewsletterIcon,
	check: CheckIcon,
	'arrow-right': ArrowRightIcon,
	play: PlayIcon,
	bolt: BoltIcon,
	sparkle: SparkleIcon,
	star: StarIcon,
	desktop: DesktopIcon,
	apple: AppleIcon,
	android: AndroidIcon,
	shield: ShieldIcon,
	heart: HeartIcon,
	users: UsersIcon,
	pin: PinIcon,
	menu: MenuIcon,
};

/** Render an icon by its content-data name. */
export function Icon({ name, ...props }: IconProps & { name: IconName }) {
	const Glyph = icons[name];
	return <Glyph {...props} />;
}
