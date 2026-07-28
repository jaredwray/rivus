import type { IconName } from '../components/marketing/icons';
import type { Tint } from './site';

/**
 * Content for the per-trade landing pages (/industries/[slug]). One template
 * renders every entry, so adding a trade is adding data here. Copy describes
 * what the product does — no metrics, per the claims rules in
 * WEBSITE_CONTENT_PLAN.md; the conversation is an illustrative product mock,
 * like the homepage hero's.
 */

export interface IndustryPain {
	title: string;
	description: string;
	icon: IconName;
	tint: Tint;
}

/** The illustrative conversation shown in the phone mock. */
export interface IndustryConversation {
	/** The customer in the mock. */
	contactName: string;
	contactInitials: string;
	channel: string;
	inbound: string;
	reply: string;
	confirmation: string;
	bookedTitle: string;
	bookedSub: string;
	bookedAmount: string;
}

export interface Industry {
	slug: string;
	/** Full display name ("Plumbers"). */
	name: string;
	/** Lowercase name for the hero trust bar ("plumbers"). */
	shortName: string;
	title: string;
	lead: string;
	metaDescription: string;
	pains: IndustryPain[];
	conversation: IndustryConversation;
	/** What Rivus handles for this trade — the checklist next to the mock. */
	handles: string[];
}

export const industries: Industry[] = [
	{
		slug: 'plumbers',
		name: 'Plumbers',
		shortName: 'plumbers',
		title: 'Never miss another emergency call.',
		lead: 'Burst pipes don’t wait for business hours — and neither do the customers calling about them. Rivus answers every call and text the second it comes in, books the job, and keeps your evenings for yourself.',
		metaDescription:
			'Rivus answers every call and text for your plumbing business 24/7, books jobs to your calendar, and handles invoices, reviews, and follow-ups.',
		pains: [
			{
				title: 'Emergencies at 2am',
				description:
					'The most urgent — and most valuable — calls come when you’re asleep or under a sink. Unanswered, they go straight to the next plumber on the list.',
				icon: 'clock',
				tint: 'red',
			},
			{
				title: 'Hands full, phone ringing',
				description:
					'You can’t sweat a joint and quote a water heater at the same time. Every job you’re on costs you the calls about the next one.',
				icon: 'phone-off',
				tint: 'amber',
			},
			{
				title: 'Paperwork after dark',
				description:
					'Invoices, reminders, review requests — the office work starts when the tools are down, and it eats the evening every time.',
				icon: 'list',
				tint: 'indigo',
			},
		],
		conversation: {
			contactName: 'Dana Whitfield',
			contactInitials: 'DW',
			channel: 'Text',
			inbound: "Hey, my water heater's leaking — can someone come today?",
			reply: "I can get a tech out today. I've got 2:00 or 4:30 open — which works?",
			confirmation: '2pm works, thank you!',
			bookedTitle: 'New job booked',
			bookedSub: 'Water heater repair · 2:00 PM today',
			bookedAmount: '$420 paid',
		},
		handles: [
			'Answers every call and text 24/7 — emergencies included',
			'Books jobs into real slots and keeps emergency time open',
			'Sends the invoice and collects payment when the job is done',
			'Asks happy customers for the review that wins the next job',
		],
	},
	{
		slug: 'hvac',
		name: 'HVAC',
		shortName: 'HVAC',
		title: 'Answer every no-heat call, even mid-install.',
		lead: 'When a furnace dies in January, the first company to answer wins the job. Rivus picks up instantly on every channel, books the visit, and keeps your maintenance follow-ups running all year.',
		metaDescription:
			'Rivus answers every call for your HVAC company 24/7, books service calls and installs, and keeps invoices, reminders, and reviews running.',
		pains: [
			{
				title: 'Seasonal call floods',
				description:
					'The first cold snap buries your phone line. Every ring you can’t get to is a no-heat customer calling your competitor next.',
				icon: 'phone-off',
				tint: 'red',
			},
			{
				title: 'Long installs, silent phone',
				description:
					'A day on a rooftop unit is a day of missed calls. The install you’re on shouldn’t cost you the three you didn’t hear.',
				icon: 'clock',
				tint: 'amber',
			},
			{
				title: 'Maintenance slips away',
				description:
					'Tune-up season is your steadiest revenue — if someone remembers to book it. Reminders and follow-ups are the first thing busy weeks drop.',
				icon: 'list',
				tint: 'violet',
			},
		],
		conversation: {
			contactName: 'Ray Delgado',
			contactInitials: 'RD',
			channel: 'Phone',
			inbound: 'Our furnace just quit and the house is freezing. How soon can you get here?',
			reply: 'I can have a tech out today — 1:30 or 3:00. Which should I lock in?',
			confirmation: '1:30, please — thank you!',
			bookedTitle: 'New job booked',
			bookedSub: 'Furnace diagnostic · 1:30 PM today',
			bookedAmount: '$189 paid',
		},
		handles: [
			'Picks up every call in seconds, even during the seasonal rush',
			'Books diagnostics and installs to the right tech’s route',
			'Runs your maintenance reminders so tune-up season books itself',
			'Handles invoices, payment nudges, and review requests',
		],
	},
	{
		slug: 'electricians',
		name: 'Electricians',
		shortName: 'electricians',
		title: 'Your phones, wired to always answer.',
		lead: 'You can’t take a call with both hands in a panel. Rivus answers every call, text, and email for your electrical business, quotes the small stuff from your playbook, and books the work straight to your calendar.',
		metaDescription:
			'Rivus answers calls and messages for your electrical business 24/7, books jobs, and handles the invoices, reminders, and reviews between them.',
		pains: [
			{
				title: 'On the ladder, missing leads',
				description:
					'Panel upgrades and rewires demand your full attention. The customers calling about their projects don’t know that — they just hear voicemail.',
				icon: 'phone-off',
				tint: 'amber',
			},
			{
				title: 'Quotes that stall',
				description:
					'Estimates that sit in your head all week never turn into booked work. Slow follow-up hands the job to whoever answered first.',
				icon: 'clock',
				tint: 'indigo',
			},
			{
				title: 'Admin between jobs',
				description:
					'Invoicing from the truck, chasing payment at night, remembering the review ask — the between-jobs work never ends on its own.',
				icon: 'list',
				tint: 'violet',
			},
		],
		conversation: {
			contactName: 'Priya Anand',
			contactInitials: 'PA',
			channel: 'Text',
			inbound: 'Half the outlets in our kitchen just went dead. Can someone take a look this week?',
			reply:
				'We can absolutely help. I have Thursday 9:00 or Friday 11:30 open — which works better?',
			confirmation: 'Thursday at 9, perfect.',
			bookedTitle: 'New job booked',
			bookedSub: 'Kitchen circuit repair · Thu 9:00 AM',
			bookedAmount: '$260 paid',
		},
		handles: [
			'Answers every channel while you’re in the panel',
			'Books estimates and service calls without the phone tag',
			'Follows up on quotes so they turn into scheduled work',
			'Sends invoices and review requests the moment a job closes',
		],
	},
	{
		slug: 'salons',
		name: 'Salons',
		shortName: 'salons',
		title: 'Fully booked, without touching the phone.',
		lead: 'Your hands are in someone’s hair; the phone can wait — but the client texting for Saturday can’t. Rivus replies instantly, fills your chairs, sends the reminders that stop no-shows, and asks for the five-star review after.',
		metaDescription:
			'Rivus answers texts, calls, and DMs for your salon 24/7 — booking appointments, cutting no-shows with reminders, and asking for reviews.',
		pains: [
			{
				title: 'Mid-color, phone buzzing',
				description:
					'Every appointment you’re in is an hour of unanswered bookings. Clients who can’t reach you book wherever answers first.',
				icon: 'phone-off',
				tint: 'violet',
			},
			{
				title: 'No-shows eat the day',
				description:
					'An empty chair is unpaid time you can’t get back. Without reminders and easy rescheduling, Tuesday’s gaps stay gaps.',
				icon: 'clock',
				tint: 'amber',
			},
			{
				title: 'Rebooking is a memory game',
				description:
					'The client who should be back every six weeks quietly stretches to ten. Nobody has time to chase the rebook — so nobody does.',
				icon: 'list',
				tint: 'red',
			},
		],
		conversation: {
			contactName: 'Maya Chen',
			contactInitials: 'MC',
			channel: 'Text',
			inbound: 'Hi! Any chance you have a cut & color open this Saturday?',
			reply: 'We’d love to have you in! Saturday I have 10:00 or 1:30 with Renee — which works?',
			confirmation: '1:30 please!!',
			bookedTitle: 'Appointment booked',
			bookedSub: 'Cut & color · Sat 1:30 PM with Renee',
			bookedAmount: '$185 paid',
		},
		handles: [
			'Replies to texts, calls, and DMs the moment they arrive',
			'Books and reschedules straight into each stylist’s calendar',
			'Sends the reminders that keep chairs full',
			'Asks every happy client for the review — and the rebook',
		],
	},
	{
		slug: 'clinics',
		name: 'Clinics',
		shortName: 'clinics',
		title: 'Every patient call answered, front desk or not.',
		lead: 'When the front desk is with a patient, the phone still rings. Rivus answers every call and message for your practice, books and confirms appointments, and handles the routine questions — while your team stays present with the people in the room.',
		metaDescription:
			'Rivus answers calls and messages for your clinic 24/7, books and confirms appointments, cuts no-shows with reminders, and handles routine questions.',
		pains: [
			{
				title: 'Front desk, two places at once',
				description:
					'Checking a patient in and answering line two are the same person’s job. One of them always waits — and callers don’t wait long.',
				icon: 'phone-off',
				tint: 'cyan',
			},
			{
				title: 'No-shows cost care and revenue',
				description:
					'Missed appointments hurt the schedule and the patient. Confirmations and reminders fix most of them — when someone has time to send them.',
				icon: 'clock',
				tint: 'amber',
			},
			{
				title: 'The same questions, all day',
				description:
					'Hours, directions, what to bring, how billing works — routine answers consume the hours your staff should spend on patients.',
				icon: 'list',
				tint: 'indigo',
			},
		],
		conversation: {
			contactName: 'Luis Romero',
			contactInitials: 'LR',
			channel: 'Phone',
			inbound: 'Hi, I need to book a check-up sometime next week if possible.',
			reply:
				'Happy to help. Next week I have Tuesday 9:40 or Thursday 2:20 — which fits your schedule?',
			confirmation: 'Thursday 2:20 works great.',
			bookedTitle: 'Appointment booked',
			bookedSub: 'Check-up · Thu 2:20 PM',
			bookedAmount: 'Confirmed',
		},
		handles: [
			'Answers every call and message, whatever the front desk is doing',
			'Books, confirms, and reschedules appointments automatically',
			'Sends reminders that cut no-shows',
			'Answers routine questions from your own approved FAQs',
		],
	},
	{
		slug: 'landscapers',
		name: 'Landscapers',
		shortName: 'landscapers',
		title: 'Book the next yard while you’re still mowing this one.',
		lead: 'You’re on a mower; your next customer is on the phone. Rivus answers every call and text, quotes from your price list, books the walkthrough, and keeps seasonal work coming back year after year.',
		metaDescription:
			'Rivus answers calls and texts for your landscaping business 24/7, books estimates and jobs, and keeps invoices, follow-ups, and seasonal reminders running.',
		pains: [
			{
				title: 'Equipment loud, phone silent',
				description:
					'You can’t hear the phone over a mower — and by the cool-down, the caller has booked someone else for the season.',
				icon: 'phone-off',
				tint: 'green',
			},
			{
				title: 'Estimates pile up',
				description:
					'Walkthrough requests come in faster than you can schedule them. Slow scheduling reads as no to the customer.',
				icon: 'clock',
				tint: 'amber',
			},
			{
				title: 'Seasonal work forgets to return',
				description:
					'Spring cleanups and fall aerations should rebook themselves. Without follow-ups, last year’s customers become someone else’s this year.',
				icon: 'trend-up',
				tint: 'violet',
			},
		],
		conversation: {
			contactName: 'Theo Marsh',
			contactInitials: 'TM',
			channel: 'Text',
			inbound:
				'Looking for weekly mowing plus a spring cleanup — do you have room for one more yard?',
			reply:
				'We do! I can schedule a quick walkthrough Wednesday 8:30 or Thursday 4:00 to price it — which works?',
			confirmation: 'Wednesday 8:30 is perfect.',
			bookedTitle: 'Walkthrough booked',
			bookedSub: 'Estimate visit · Wed 8:30 AM',
			bookedAmount: 'On calendar',
		},
		handles: [
			'Answers calls and texts while the crew is on the mower',
			'Books walkthroughs and recurring service on your routes',
			'Invoices when the job is done and nudges politely until paid',
			'Brings seasonal customers back with reminders and follow-ups',
		],
	},
];

/** Look up one industry by its slug, for the dynamic route. */
export function findIndustry(slug: string): Industry | undefined {
	return industries.find((industry) => industry.slug === slug);
}
