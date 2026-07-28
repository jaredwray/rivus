import type { IndustryConversation } from '../../lib/industries';
import { BrandImg } from './brand-img';
import { BoltIcon, CheckIcon } from './icons';

/**
 * The phone-frame conversation mock used on the industry pages — the same
 * visual language (and CSS blocks) as the homepage hero's device, driven by
 * per-trade data. Illustrative product UI, not a transcript of a real
 * customer.
 */
export function ConversationMock({ conversation }: { conversation: IndustryConversation }) {
	return (
		<div className="hero__phone">
			<div className="hero__screen">
				<div className="hero__notch" aria-hidden="true" />
				<div className="convo__header">
					<div className="avatar">{conversation.contactInitials}</div>
					<div>
						<div className="convo__name">{conversation.contactName}</div>
						<div className="convo__status">
							<span className="dot" />
							{conversation.channel} · Rivus handling
						</div>
					</div>
				</div>
				<div className="convo__thread">
					<div className="bubble bubble--in">{conversation.inbound}</div>
					<div className="bubble--row">
						<div className="bubble--out">{conversation.reply}</div>
						<span className="bubble__mark">
							<BrandImg className="mark-img" src="/assets/rivus-symbol-white.svg" alt="" />
						</span>
					</div>
					<div className="convo__meta">
						<BoltIcon size={11} />
						<span>Rivus answered in seconds</span>
					</div>
					<div className="bubble bubble--in">{conversation.confirmation}</div>
					<div className="booked">
						<div className="booked__icon">
							<CheckIcon size={19} />
						</div>
						<div className="inbox__meta">
							<div className="booked__title">{conversation.bookedTitle}</div>
							<div className="booked__sub">{conversation.bookedSub}</div>
						</div>
						<span className="booked__amt">{conversation.bookedAmount}</span>
					</div>
				</div>
			</div>
		</div>
	);
}
