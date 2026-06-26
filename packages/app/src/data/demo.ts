// Demo content for the Rivus dashboard, lifted verbatim from the Rivus.dc.html
// design so the UI is fully populated without a backend. Pure data — no imports.

export type Channel = 'WhatsApp' | 'Phone' | 'Email' | 'SMS';

export const channelColor: Record<Channel, string> = {
	WhatsApp: '#1fb573',
	Phone: '#1ebefa',
	Email: '#6e1ec8',
	SMS: '#8a8b99',
};

export type MessageFrom = 'cust' | 'rivus' | 'note';
export type Message = { f: MessageFrom; t: string; time: string };

export type ThreadStatus = 'rivus' | 'needs';
export type Thread = {
	name: string;
	initials: string;
	channel: Channel;
	time: string;
	snippet: string;
	status: ThreadStatus;
	phone: string;
	since: string;
	ltv: string;
	balance: string;
	invoice: string;
	area: string;
	tags: string[];
	messages: Message[];
};

export const threads: Thread[] = [
	{
		name: 'Dana Whitfield',
		initials: 'DW',
		channel: 'WhatsApp',
		time: '9:24 AM',
		snippet: 'Perfect, see you Tuesday!',
		status: 'rivus',
		phone: '(206) 555-0142',
		since: '2021',
		ltv: '$3,480',
		balance: '$0.00',
		invoice: '#1042 · $320 · Paid',
		area: 'Ballard, Seattle',
		tags: ['Repeat client', 'Membership'],
		messages: [
			{
				f: 'cust',
				t: 'Hi, my water heater is leaking from the bottom. How soon can someone come out?',
				time: '9:18 AM',
			},
			{
				f: 'rivus',
				t: "Hi Dana! A leak from the bottom usually means the tank, so it's best to have a tech take a look. I have Tuesday 2:00 PM or Wednesday 10:00 AM open — which works for you?",
				time: '9:19 AM',
			},
			{ f: 'cust', t: 'Tuesday 2 is great.', time: '9:23 AM' },
			{
				f: 'rivus',
				t: "You're booked for Tuesday, June 24 at 2:00 PM for a water heater inspection. I'll text a reminder the morning of. Anything else?",
				time: '9:23 AM',
			},
			{
				f: 'note',
				t: 'Rivus booked “Water heater inspection” · Tue Jun 24, 2:00 PM · assigned to Marcus',
				time: '',
			},
			{ f: 'cust', t: 'Perfect, see you Tuesday!', time: '9:24 AM' },
		],
	},
	{
		name: 'Theo Marsh',
		initials: 'TM',
		channel: 'Phone',
		time: '9:02 AM',
		snippet: 'Voicemail · transcribed by Rivus',
		status: 'rivus',
		phone: '(206) 555-0188',
		since: '2023',
		ltv: '$910',
		balance: '$0.00',
		invoice: '#1039 · $180 · Paid',
		area: 'Queen Anne, Seattle',
		tags: ['New this year'],
		messages: [
			{ f: 'note', t: 'Inbound call · 1:42 · answered & transcribed by Rivus', time: '9:02 AM' },
			{
				f: 'cust',
				t: "Hey, this is Theo over on Queen Anne. My kitchen sink is totally clogged, water won't go down. Hoping someone could swing by today or tomorrow. Thanks.",
				time: '9:02 AM',
			},
			{
				f: 'rivus',
				t: 'Called Theo back, offered same-day 4:30 PM or tomorrow 9:00 AM. He chose tomorrow at 9:00 AM.',
				time: '9:08 AM',
			},
			{ f: 'note', t: 'Rivus booked “Drain cleaning” · Tue Jun 24, 9:00 AM', time: '' },
		],
	},
	{
		name: 'Priya Anand',
		initials: 'PA',
		channel: 'Email',
		time: '8:47 AM',
		snippet: 'Question about my invoice #1051',
		status: 'needs',
		phone: '(206) 555-0119',
		since: '2020',
		ltv: '$5,260',
		balance: '$540.00',
		invoice: '#1051 · $540 · Due Jun 30',
		area: 'Capitol Hill, Seattle',
		tags: ['Repeat client', 'Billing flag'],
		messages: [
			{
				f: 'cust',
				t: 'Hi, I just got invoice #1051 for $540 but I thought the quote was $480. Can you clarify the difference before I pay? Thanks, Priya',
				time: '8:47 AM',
			},
			{
				f: 'rivus',
				t: "Hi Priya! The $60 difference is for an additional shut-off valve replaced during the visit (noted on the work order). I've attached the itemized breakdown. Would you like Marcus to give you a quick call to walk through it?",
				time: '8:49 AM',
			},
			{
				f: 'note',
				t: 'Rivus flagged this for you — it involves a billing dispute over $50.',
				time: '',
			},
		],
	},
	{
		name: 'Luis Romero',
		initials: 'LR',
		channel: 'SMS',
		time: 'Yesterday',
		snippet: 'Do you service Bellevue?',
		status: 'rivus',
		phone: '(425) 555-0170',
		since: 'New lead',
		ltv: '—',
		balance: '$0.00',
		invoice: 'No invoices yet',
		area: 'Bellevue, WA',
		tags: ['New lead'],
		messages: [
			{ f: 'cust', t: 'Do you guys service Bellevue?', time: 'Yesterday 4:12 PM' },
			{
				f: 'rivus',
				t: 'We sure do, Luis! Bellevue is within our service area with no extra travel fee under 15 miles. Want me to set up a visit?',
				time: 'Yesterday 4:12 PM',
			},
			{ f: 'cust', t: 'Not yet, just checking. Thanks!', time: 'Yesterday 4:13 PM' },
			{ f: 'note', t: 'Answered from FAQ: “Service area”', time: '' },
		],
	},
	{
		name: 'Grace Kim',
		initials: 'GK',
		channel: 'WhatsApp',
		time: 'Yesterday',
		snippet: 'Thank you! ★★★★★',
		status: 'rivus',
		phone: '(206) 555-0155',
		since: '2019',
		ltv: '$7,140',
		balance: '$0.00',
		invoice: '#1048 · $640 · Paid',
		area: 'Fremont, Seattle',
		tags: ['VIP', 'Membership'],
		messages: [
			{
				f: 'cust',
				t: 'Just wanted to say the tech who came out was fantastic. Thank you!',
				time: 'Yesterday 2:30 PM',
			},
			{
				f: 'rivus',
				t: "That means a lot, Grace — I'll pass it along to the team! If you have a minute, a quick Google review helps a small business like ours a ton. Here's the link.",
				time: 'Yesterday 2:31 PM',
			},
			{ f: 'note', t: 'Rivus requested a review · Grace left ★★★★★ two hours later', time: '' },
		],
	},
];

export type Faq = { cat: string; q: string; a: string; uses: string };

export const faqs: Faq[] = [
	{
		cat: 'Pricing',
		q: 'How much does a service call cost?',
		a: 'Our standard diagnostic visit is $89, which is credited toward any repair you approve the same day.',
		uses: 'Used 64× this month',
	},
	{
		cat: 'Pricing',
		q: 'Do you offer free estimates?',
		a: 'Yes — estimates for installs and replacements over $500 are always free and itemized.',
		uses: 'Used 31× this month',
	},
	{
		cat: 'Scheduling',
		q: 'What are your hours?',
		a: 'Mon–Sat 7 AM–6 PM. We keep emergency slots open daily, and offer 24/7 on-call for active leaks.',
		uses: 'Used 52× this month',
	},
	{
		cat: 'Service area',
		q: 'What areas do you serve?',
		a: 'All of Seattle plus Bellevue, Kirkland, and Redmond. No travel fee within 15 miles.',
		uses: 'Used 47× this month',
	},
	{
		cat: 'Warranties',
		q: 'Is your work guaranteed?',
		a: 'All repairs carry a 1-year labor warranty; installs include the manufacturer’s parts warranty (often 6–10 years).',
		uses: 'Used 28× this month',
	},
	{
		cat: 'Payments',
		q: 'What payment methods do you take?',
		a: 'All major cards, ACH, and financing on jobs over $1,000. Invoices and payment links are sent through QuickBooks.',
		uses: 'Used 19× this month',
	},
];

export const faqCategories = [
	'All',
	'Pricing',
	'Scheduling',
	'Service area',
	'Warranties',
	'Payments',
];

// Week calendar events. `top`/`height` are absolute offsets in px within a day
// column where each hour row is 64px tall (8 AM is row 0).
export type CalEvent = {
	top: number;
	height: number;
	title: string;
	sub: string;
	tone: 'cyan' | 'purple' | 'amber' | 'red' | 'hold';
	rivus?: boolean;
	note?: string;
};

export const scheduleDays: { dow: string; date: string; today?: boolean; events: CalEvent[] }[] = [
	{
		dow: 'MON',
		date: '22',
		today: true,
		events: [
			{
				top: 32,
				height: 54,
				title: '8:30 · Water heater',
				sub: 'Dana W. · Marcus',
				tone: 'cyan',
				rivus: true,
			},
			{
				top: 128,
				height: 54,
				title: '10:00 · Drain',
				sub: 'Theo M. · Priya',
				tone: 'purple',
				rivus: true,
			},
			{
				top: 320,
				height: 54,
				title: '1:00 · Leak inspection',
				sub: 'Grace K. · Marcus',
				tone: 'cyan',
			},
			{
				top: 480,
				height: 54,
				title: '3:30 · Faucet',
				sub: 'Luis R. · Priya',
				tone: 'purple',
				rivus: true,
			},
		],
	},
	{
		dow: 'TUE',
		date: '23',
		events: [
			{
				top: 64,
				height: 54,
				title: '9:00 · Drain',
				sub: 'Theo M. · Priya',
				tone: 'purple',
				rivus: true,
			},
			{
				top: 384,
				height: 54,
				title: '2:00 · Water heater',
				sub: 'Dana W. · Marcus',
				tone: 'cyan',
				rivus: true,
			},
		],
	},
	{
		dow: 'WED',
		date: '24',
		events: [
			{ top: 192, height: 54, title: '11:00 · Sump pump', sub: 'N. Okafor · Marcus', tone: 'cyan' },
			{
				top: 352,
				height: 80,
				title: '1:30 · Hold',
				sub: 'Rivus keeps open for emergencies',
				tone: 'hold',
			},
		],
	},
	{
		dow: 'THU',
		date: '25',
		events: [
			{
				top: 96,
				height: 86,
				title: '9:30 · Repipe estimate',
				sub: 'R. Vance · Marcus',
				tone: 'amber',
				note: 'Needs your approval',
			},
			{
				top: 320,
				height: 54,
				title: '1:00 · Toilet install',
				sub: 'H. Patel · Priya',
				tone: 'purple',
			},
		],
	},
	{
		dow: 'FRI',
		date: '26',
		events: [
			{
				top: 128,
				height: 54,
				title: '10:00 · Inspection',
				sub: 'M. Flores · Priya',
				tone: 'purple',
				rivus: true,
			},
			{
				top: 448,
				height: 54,
				title: '3:00 · Water softener',
				sub: 'J. Reyes · Marcus',
				tone: 'cyan',
			},
		],
	},
	{
		dow: 'SAT',
		date: '27',
		events: [
			{ top: 64, height: 54, title: '9:00 · Emergency', sub: 'On-call · Marcus', tone: 'red' },
		],
	},
];

export const scheduleHours = [
	'8 AM',
	'9 AM',
	'10 AM',
	'11 AM',
	'12 PM',
	'1 PM',
	'2 PM',
	'3 PM',
	'4 PM',
	'5 PM',
];
