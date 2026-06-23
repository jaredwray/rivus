import { featureAnchor, features, inboxItems, scheduleItems } from '../../lib/site';
import { BrandImg } from './brand-img';
import { CalendarIcon, CardIcon, CheckIcon, Icon, InboxIcon } from './icons';

const inboxPoints = [
	'Replies in seconds, day or night',
	'Flags the big stuff for a human',
	"Remembers every customer's history",
];

const schedulePoints = [
	'Auto-books to the right tech',
	'Reminders cut no-shows',
	'Always keeps room for emergencies',
];

const billingPoints = [
	'Two-way QuickBooks sync',
	'Answers "what\'s my balance?" instantly',
	'Polite, automatic payment nudges',
];

function Points({ items }: { items: string[] }) {
	return (
		<ul className="feature-row__points">
			{items.map((item) => (
				<li key={item}>
					<CheckIcon size={19} />
					{item}
				</li>
			))}
		</ul>
	);
}

export function FeaturesSection() {
	return (
		<section id="features" className="section section--gray">
			<div className="container">
				<div className="section-head">
					<p className="eyebrow">EVERYTHING IN ONE PLACE</p>
					<h2 className="h2">The whole back office, handled.</h2>
				</div>

				{/* Row 1 — unified inbox */}
				<div className="feature-row">
					<div className="feature-row__copy">
						<span className="tag">
							<InboxIcon size={16} />
							Unified inbox
						</span>
						<h3 className="feature-row__title">Every conversation, one place.</h3>
						<p className="feature-row__lead">
							Calls, texts, emails, and WhatsApp land in a single inbox — and Rivus answers them
							instantly. Your team only steps in when it matters.
						</p>
						<Points items={inboxPoints} />
					</div>
					<div className="feature-row__visual">
						<div className="inbox">
							{inboxItems.map((item) => (
								<div
									key={item.initials}
									className={
										item.state === 'flagged' ? 'inbox__row inbox__row--flagged' : 'inbox__row'
									}
								>
									<div className="avatar">{item.initials}</div>
									<div className="inbox__meta">
										<div className="inbox__name">
											{item.name} · {item.channel}
										</div>
										<div className="inbox__note">{item.note}</div>
									</div>
									{item.state === 'handled' ? (
										<span className="inbox__check">
											<CheckIcon size={11} />
										</span>
									) : (
										<span className="inbox__flag" />
									)}
								</div>
							))}
						</div>
					</div>
				</div>

				{/* Row 2 — smart scheduling */}
				<div className="feature-row feature-row--reverse">
					<div className="feature-row__copy">
						<span className="tag">
							<CalendarIcon size={16} />
							Smart scheduling
						</span>
						<h3 className="feature-row__title">Your calendar fills itself.</h3>
						<p className="feature-row__lead">
							Rivus books jobs into the right slot, balances your crew's routes, sends reminders,
							and keeps emergency time open — no back-and-forth required.
						</p>
						<Points items={schedulePoints} />
					</div>
					<div className="feature-row__visual">
						<div className="sched">
							{scheduleItems.map((slot) => (
								<div key={slot.time} className="sched__row">
									<div className="sched__time">{slot.time}</div>
									<div className={`sched__slot sched__slot--${slot.tone}`}>
										<div className="sched__title">{slot.title}</div>
										<div className="sched__detail">{slot.detail}</div>
									</div>
								</div>
							))}
						</div>
					</div>
				</div>

				{/* Row 3 — billing */}
				<div className="feature-row">
					<div className="feature-row__copy">
						<span className="tag">
							<CardIcon size={16} />
							Billing · QuickBooks
						</span>
						<h3 className="feature-row__title">Get paid without chasing.</h3>
						<p className="feature-row__lead">
							Connect QuickBooks and Rivus sends invoices, takes payment, and answers customers'
							billing and account questions for you — straight from the source of truth.
						</p>
						<Points items={billingPoints} />
					</div>
					<div className="feature-row__visual">
						<div className="invoice__head">
							<CardIcon size={18} />
							<span className="invoice__no">Invoice #1051</span>
							<span className="invoice__paid">Paid</span>
						</div>
						<div className="invoice__line">
							<span className="invoice__desc">Water heater install</span>
							<span className="invoice__amt">$420.00</span>
						</div>
						<div className="invoice__note">
							<span className="invoice__mark">
								<BrandImg className="mark-img" src="/assets/rivus-symbol-white.svg" alt="" />
							</span>
							Rivus sent the invoice and collected payment automatically.
						</div>
					</div>
				</div>

				{/* Marketing grid */}
				<div className="feature-grid">
					{features.map((feature) => (
						<article key={feature.title} id={featureAnchor(feature)} className="card">
							<div className={`tile tile--lg tile--${feature.tint}`}>
								<Icon name={feature.icon} size={22} />
							</div>
							<h3 className="card__title">{feature.title}</h3>
							<p className="card__body">{feature.description}</p>
						</article>
					))}
				</div>
			</div>
		</section>
	);
}
