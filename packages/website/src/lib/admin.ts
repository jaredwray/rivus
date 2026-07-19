import type { AdminIconName } from '../components/admin/admin-icons';

/**
 * Data for the Rivus staff console (admin). All values are illustrative sample
 * data; in production these come from the API. Statuses and tag types are
 * enums resolved to CSS classes in the components, keeping color out of the data.
 */

export interface AdminNavItem {
	label: string;
	href: string;
	icon: AdminIconName;
	/** Sidebar count shown muted (e.g. total accounts). */
	count?: string;
	/** Sidebar pill badge. */
	badge?: string;
	badgeTone?: 'brand' | 'danger';
}

export const adminNav: AdminNavItem[] = [
	{ label: 'Overview', href: '/admin', icon: 'grid' },
	{ label: 'Accounts', href: '/admin/accounts', icon: 'building', count: '1,284' },
	{ label: 'Onboarding', href: '/admin/onboarding', icon: 'leaf', badge: '24', badgeTone: 'brand' },
	{
		label: 'Escalations',
		href: '/admin/escalations',
		icon: 'alert',
		badge: '37',
		badgeTone: 'danger',
	},
];

/** Urgent escalations count, shown on the mobile bottom-nav badge. */
export const urgentEscalations = 8;

export interface Kpi {
	label: string;
	value: string;
	delta?: string;
	deltaTone?: 'up' | 'danger' | 'muted';
	sub: string;
	/** Hidden on the mobile overview, which shows a tighter set. */
	desktopOnly?: boolean;
}

export const kpis: Kpi[] = [
	{ label: 'Active accounts', value: '1,284', delta: '+34', deltaTone: 'up', sub: 'this week' },
	{ label: 'MRR', value: '$312K', delta: '+8.2%', deltaTone: 'up', sub: 'vs last month' },
	{ label: 'Conversations · 24h', value: '48.2K', sub: '94% handled by Rivus' },
	{
		label: 'Onboarding',
		value: '24',
		delta: 'in progress',
		deltaTone: 'muted',
		sub: 'avg 1.2 days to live',
		desktopOnly: true,
	},
	{
		label: 'Escalations open',
		value: '37',
		delta: '8 urgent',
		deltaTone: 'danger',
		sub: 'SLA 96% on time',
	},
];

/** Heights (in %) for the 14-day conversations bar chart; the last bar is "today". */
export const conversationBars = [44, 52, 40, 60, 70, 55, 66, 78, 62, 72, 80, 68, 88, 96];

export interface PlanShare {
	name: string;
	count: string;
	pct: number;
	tone: 'gradient' | 'cyan' | 'violet';
}

export const accountsByPlan: PlanShare[] = [
	{ name: 'Team', count: '724', pct: 57, tone: 'gradient' },
	{ name: 'Solo', count: '498', pct: 39, tone: 'cyan' },
	{ name: 'Multi-location', count: '62', pct: 14, tone: 'violet' },
];

export type AccountStatus = 'active' | 'trial' | 'risk';

export interface Account {
	name: string;
	loc: string;
	initials: string;
	plan: string;
	mrr: string;
	channels: string;
	specialist: string;
	status: AccountStatus;
}

export const accounts: Account[] = [
	{
		name: 'Cascade Plumbing & Heating',
		loc: 'Seattle, WA',
		initials: 'C',
		plan: 'Team',
		mrr: '$349',
		channels: 'Phone · SMS · Email · WA',
		specialist: 'Maya R.',
		status: 'active',
	},
	{
		name: 'Glow Hair Studio',
		loc: 'Austin, TX',
		initials: 'G',
		plan: 'Solo',
		mrr: '$149',
		channels: 'SMS · Email',
		specialist: 'Devon K.',
		status: 'active',
	},
	{
		name: 'Summit Heating & Air',
		loc: 'Denver, CO',
		initials: 'S',
		plan: 'Team',
		mrr: '$349',
		channels: 'Phone · SMS',
		specialist: 'Maya R.',
		status: 'risk',
	},
	{
		name: 'BrightSmile Dental',
		loc: 'Portland, OR',
		initials: 'B',
		plan: 'Team',
		mrr: '$349',
		channels: 'Phone · Email',
		specialist: 'Aisha N.',
		status: 'trial',
	},
	{
		name: 'GreenLeaf Landscaping',
		loc: 'Sacramento, CA',
		initials: 'G',
		plan: 'Solo',
		mrr: '$149',
		channels: 'SMS · WA',
		specialist: 'Devon K.',
		status: 'active',
	},
	{
		name: 'Apex Auto Repair',
		loc: 'Phoenix, AZ',
		initials: 'A',
		plan: 'Team',
		mrr: '$349',
		channels: 'Phone · SMS · Email',
		specialist: 'Tom B.',
		status: 'active',
	},
	{
		name: 'Riverside Vet Clinic',
		loc: 'Boise, ID',
		initials: 'R',
		plan: 'Multi-location',
		mrr: '$1,096',
		channels: 'Phone · SMS · Email · WA',
		specialist: 'Aisha N.',
		status: 'active',
	},
	{
		name: 'Coastal Electric',
		loc: 'San Diego, CA',
		initials: 'C',
		plan: 'Solo',
		mrr: '$149',
		channels: 'Phone',
		specialist: 'Tom B.',
		status: 'risk',
	},
	{
		name: 'Maple & Co Cleaning',
		loc: 'Minneapolis, MN',
		initials: 'M',
		plan: 'Team',
		mrr: '$349',
		channels: 'SMS · Email',
		specialist: 'Maya R.',
		status: 'trial',
	},
];

export const accountStatusLabels: Record<AccountStatus, string> = {
	active: 'Active',
	trial: 'Trial',
	risk: 'At risk',
};

export type OnboardingStatus = 'on-track' | 'waiting' | 'blocked';

export interface OnboardingEntry {
	name: string;
	loc: string;
	initials: string;
	specialist: string;
	stage: string;
	pct: string;
	eta: string;
	status: OnboardingStatus;
}

export const onboarding: OnboardingEntry[] = [
	{
		name: 'Maple & Co Cleaning',
		loc: 'Minneapolis, MN',
		initials: 'M',
		specialist: 'Maya R.',
		stage: 'Importing customers',
		pct: '70%',
		eta: 'Today',
		status: 'on-track',
	},
	{
		name: 'BrightSmile Dental',
		loc: 'Portland, OR',
		initials: 'B',
		specialist: 'Aisha N.',
		stage: 'Writing FAQs',
		pct: '45%',
		eta: 'Tomorrow',
		status: 'on-track',
	},
	{
		name: 'Hometown Pizza Co',
		loc: 'Columbus, OH',
		initials: 'H',
		specialist: 'Devon K.',
		stage: 'Connecting QuickBooks',
		pct: '85%',
		eta: 'Today',
		status: 'on-track',
	},
	{
		name: 'Iron Peak Fitness',
		loc: 'Salt Lake City, UT',
		initials: 'I',
		specialist: 'Tom B.',
		stage: 'Kickoff call scheduled',
		pct: '15%',
		eta: 'Jun 25',
		status: 'waiting',
	},
	{
		name: 'Bayside Dental Group',
		loc: 'Tampa, FL',
		initials: 'B',
		specialist: 'Aisha N.',
		stage: 'Training Rivus voice',
		pct: '60%',
		eta: 'Tomorrow',
		status: 'on-track',
	},
	{
		name: 'Northgate Auto Body',
		loc: 'Reno, NV',
		initials: 'N',
		specialist: 'Tom B.',
		stage: 'Awaiting customer data',
		pct: '30%',
		eta: 'Jun 26',
		status: 'blocked',
	},
];

export const onboardingStatusLabels: Record<OnboardingStatus, string> = {
	'on-track': 'On track',
	waiting: 'Waiting',
	blocked: 'Blocked',
};

export interface OnboardingStat {
	label: string;
	value: string;
	tone?: 'danger';
}

export const onboardingStats: OnboardingStat[] = [
	{ label: 'Live this week', value: '41' },
	{ label: 'Avg time to live', value: '1.2 days' },
	{ label: 'Blocked', value: '1', tone: 'danger' },
];

export type EscalationType = 'Billing' | 'Quote' | 'Review' | 'Outage';

export interface Escalation {
	type: EscalationType;
	account: string;
	detail: string;
	time: string;
	urgent: boolean;
	owner: string;
}

export const escalations: Escalation[] = [
	{
		type: 'Billing',
		account: 'Cascade Plumbing & Heating',
		detail: 'Customer disputes $60 on invoice #1051',
		time: '3m ago',
		urgent: true,
		owner: 'Maya R.',
	},
	{
		type: 'Quote',
		account: 'Summit Heating & Air',
		detail: 'Sewer line estimate over $2,000 needs approval',
		time: '18m ago',
		urgent: false,
		owner: 'Unassigned',
	},
	{
		type: 'Review',
		account: 'Glow Hair Studio',
		detail: '2-star review — drafted reply awaiting sign-off',
		time: '42m ago',
		urgent: false,
		owner: 'Devon K.',
	},
	{
		type: 'Outage',
		account: 'Coastal Electric',
		detail: 'Phone connector disconnected — reauth needed',
		time: '1h ago',
		urgent: true,
		owner: 'Tom B.',
	},
	{
		type: 'Billing',
		account: 'Apex Auto Repair',
		detail: 'Refund request flagged by Rivus',
		time: '2h ago',
		urgent: false,
		owner: 'Aisha N.',
	},
	{
		type: 'Quote',
		account: 'Riverside Vet Clinic',
		detail: 'Multi-pet plan quote needs human review',
		time: '3h ago',
		urgent: false,
		owner: 'Aisha N.',
	},
];

/** CSS-class suffix for an escalation type's tag color. */
export function escalationTone(type: EscalationType): string {
	switch (type) {
		case 'Billing':
		case 'Outage':
			return 'danger';
		case 'Quote':
			return 'violet';
		default:
			return 'amber';
	}
}

export const adminUser = {
	name: 'Sofia Reyes',
	role: 'Ops · Admin',
	initials: 'SR',
	firstName: 'Sofia',
	email: 'sofia@rivus.ai',
};
