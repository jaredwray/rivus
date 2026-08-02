/**
 * Deterministic reading of what a customer's message is asking about: the
 * *business* ({@link isInformationalQuestion}), *their own place on the
 * calendar* ({@link namesBookingStatusQuestion}), or neither — in which case it
 * is the scheduling engine's. No model in the loop — same philosophy as
 * `parse.ts`: a capability decides whether to claim a turn with these, so they
 * have to be exhaustively unit-testable and impossible to surprise in production.
 *
 * The two error directions are not symmetric, and the rules below are tuned for
 * that. A false negative costs one unanswered FAQ — the scheduling engine still
 * replies, exactly as it does today. A false positive hijacks a booking turn and
 * answers trivia at somebody trying to book. So every scheduling-shaped phrasing
 * wins over every question signal: the guards run first and they are absolute.
 */

// Words that make a message about the calendar. Word-boundary anchored so
// "booking" matches but "bookkeeping" doesn't. `cancel…` is here because a
// cancellation is a scheduling turn even when phrased as a question; it costs
// us "what's your cancellation policy?", which the scheduling engine answers
// with openings today anyway.
const SCHEDULING_VOCABULARY =
	/\b(?:book|books|booked|booking|bookings|appointment|appointments|schedule|scheduled|schedules|scheduling|reschedul[a-z]*|cancel[a-z]*|availab[a-z]*|opening|openings|slot|slots|earliest|soon|sooner|soonest)\b/;

// Phrasings that ask *when*, not *what*. Deliberately narrow: each one names a
// visit or a set of times, so none of them can be answered from an FAQ.
// `how about` / `what about` are here as proposal frames ("how about Wednesday?"),
// and `what else` / `anything else` because a booked contact asking for more is
// re-opening scheduling, not asking about the business.
const SCHEDULING_PHRASES =
	/\bwhen (?:can|could|will|would)\b|\bhow soon\b|\bare you free\b|\b(?:what|which) times?\b|\bhow about\b|\bwhat about\b|\bwhat else\b|\bwhat other\b|\banything else\b/;

// Asking for a person at an address is a booking request however it is worded —
// "can I get someone out?", "could you come by?". `someone`/`somebody` are
// guarded outright: in a trades inbox they essentially always mean "send a tech".
const VISIT_REQUEST =
	/\b(?:someone|somebody|anyone|anybody)\b|\bcome (?:out|by|over|to)\b|\bcomes out\b|\bstop by\b|\bswing by\b|\bfit (?:me|us) in\b|\bon ?site\b/;

// A relative window ("next week", "this afternoon") is a slot the contact is
// reaching for, not a fact about the business.
const RELATIVE_WINDOW =
	/\b(?:this|next|the following) (?:week|month|morning|afternoon|evening|weekend)\b/;

// "does that time work", "what times work for you" — a time paired with working
// out is always about fitting a visit in.
const TIME_THAT_WORKS = /\btimes?\b[^?!.]*\bwork/;

// A named day or a clock reading: the message is pointing at the calendar, so
// it belongs to the scheduling engine even when it wears a question mark
// ("can you do tomorrow at 9?"). This is the guard that costs us questions like
// "what are your hours on Saturday?" — an acceptable trade, since missing it
// only leaves today's behavior in place, while claiming it would risk swallowing
// a real proposal. A slashed pair reads as a date ("8/5") only when it is not
// really a fraction: in a trades inbox "1/2 inch", '3/4"', and "3/4-hp" are
// product sizes, and "24/7" is opening hours — none of them point at a day.
const CALENDAR_REFERENCE =
	/\b(?:today|tonight|tomorrow|sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? ?\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b|\b(?!24\/7\b)\d{1,2}\/\d{1,2}\b(?!\s*["″”]|[\s-]+(?:inch(?:es)?|hp|horsepower|tons?|baths?|gal(?:lons?)?|gpm|psi|lbs?|pounds?|ft|foot|feet)\b)/;
const CLOCK_TIME = /\b\d{1,2}(?::\d{2})? ?(?:am|pm)\b|\b\d{1,2}:\d{2}\b|\bat \d{1,2}\b|\bnoon\b/;

// What an information-seeking message looks like once nothing scheduling-shaped
// is left: an interrogative word, an inverted auxiliary aimed at the business
// ("do you …", "are you …", "can you …"), or an explicit request to be told.
const INTERROGATIVE =
	/\b(?:what|whats|when|whens|where|wheres|who|whos|why|how|hows|which|whose)\b|\b(?:do|does|did|dont|doesnt|didnt) (?:you|u|yall|they|i|we)\b|\b(?:are|is|was|were|arent|isnt|wasnt|werent) (?:you|u|yall|they|there|it|this|that|my|your|the)\b|\b(?:can|could|will|would|should|may|might) (?:you|u|yall|i|we|they)\b|\b(?:have|has|had|havent|hasnt) (?:you|u|yall|they)\b|\btell me\b|\bwondering\b|\bany chance\b/;

// A message that is nothing but hello. Digits are deliberately preserved by the
// tokenizer below, so "hello 2" keeps an unrecognized token and is not a bare
// greeting — the same trick `isAcknowledgement` uses to stay conservative.
const GREETING_WORDS = new Set([
	'hi',
	'hii',
	'hiya',
	'hello',
	'helo',
	'hey',
	'heya',
	'yo',
	'howdy',
	'greetings',
	'hola',
]);
/** The second half of "good morning" and friends. */
const GREETING_TIMES_OF_DAY = new Set(['morning', 'afternoon', 'evening', 'day']);
/** Words that may sit around a greeting without adding a request to it. */
const GREETING_FILLER = new Set(['there']);

/** Letter/digit words, with punctuation and emoji dropped (as `isAcknowledgement` does). */
function words(text: string): string[] {
	const normalized = text
		.toLowerCase()
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9\s]/g, ' ')
		.trim();
	return normalized === '' ? [] : normalized.split(/\s+/);
}

/**
 * Whether a message is nothing but a greeting — "Hello", "hi!", "hey there",
 * "good morning". A contact who has only said hello has asked for nothing yet, so
 * answering with three appointment times reads as an agent that isn't listening.
 *
 * Conservative like {@link isAcknowledgement}: the whole message must be consumed
 * by greeting words and filler, and at least one real greeting must be seen, so
 * "hello, what are your hours?" and "hi can I book a time?" are ordinary turns.
 */
export function isPureGreeting(text: string): boolean {
	const tokens = words(text);
	let sawGreeting = false;
	// "good" is only a greeting when its time of day follows, so that word is
	// consumed by the pair and skipped on the next turn of the loop.
	let consumed = false;
	for (const [index, token] of tokens.entries()) {
		if (consumed) {
			consumed = false;
			continue;
		}
		if (token === 'good' && GREETING_TIMES_OF_DAY.has(tokens[index + 1] ?? '')) {
			sawGreeting = true;
			consumed = true;
			continue;
		}
		if (GREETING_WORDS.has(token)) {
			sawGreeting = true;
			continue;
		}
		if (GREETING_FILLER.has(token)) {
			continue;
		}
		return false;
	}
	return sawGreeting;
}

/**
 * Whether a message is an information-seeking question the knowledge base could
 * answer — "what are your business hours?", "do you offer free estimates?" —
 * as opposed to a scheduling turn the engine already handles.
 *
 * Note what is NOT a guard: `estimate`, `free` on its own, `visit`, `price`.
 * "Do you offer free estimates?" is a legitimate knowledge-base question, and a
 * money question is still a question — the caution policy in `services/inbox.ts`
 * decides whether the answer may be sent, not this.
 */
export function isInformationalQuestion(text: string): boolean {
	// Apostrophes are dropped (so "what's"/"don't" read as "whats"/"dont") and
	// whitespace collapsed, matching how `parse.ts` normalizes a reply.
	const normalized = text.toLowerCase().replace(/['’]/g, '').replace(/\s+/g, ' ').trim();
	// No words at all — an empty body, a bare "?", an emoji-only reply — asks
	// nothing the knowledge base could be grounded in.
	if (!/[a-z]/.test(normalized)) {
		return false;
	}
	// "hello?" carries a question mark but asks nothing: sent to the knowledge base
	// it would miss, and a miss pages the team. A greeting is the engine's to answer.
	if (isPureGreeting(normalized)) {
		return false;
	}
	if (
		SCHEDULING_VOCABULARY.test(normalized) ||
		SCHEDULING_PHRASES.test(normalized) ||
		VISIT_REQUEST.test(normalized) ||
		RELATIVE_WINDOW.test(normalized) ||
		TIME_THAT_WORKS.test(normalized) ||
		CALENDAR_REFERENCE.test(normalized) ||
		CLOCK_TIME.test(normalized)
	) {
		return false;
	}
	return normalized.includes('?') || INTERROGATIVE.test(normalized);
}

// ─────────────────────────────────────────────────────────────────────────────
// "What appointment do I have coming up?" — asking about a booking they already
// have, which is neither a question about the business nor a request for a new
// time. Every guard below is about telling those three apart.
// ─────────────────────────────────────────────────────────────────────────────

// Asking for a NEW visit. Absolute, and checked first: a request carries the
// same nouns a status question does ("can I get an appointment?"), and reading
// one as a status question would answer somebody who wants to be scheduled with
// a booking they may not even have. `your appointment`/`your openings` is here
// too — a slot named as the *account's* is one being asked for, not one held.
const NEW_BOOKING_REQUEST =
	/\b(?:can|could|may|would) (?:i|we) (?:get|book|have|schedule|set ?up|come in|bring)\b|\b(?:i|we) (?:need|want|would like|d like|m looking for|am looking for|re looking for|are looking for)\b|\b(?:book|schedule|set ?up|arrange) (?:me|us|an|a|another|the)\b|\bmake (?:an|a) (?:appointment|booking)\b|\bdo you have\b|\bwhat (?:times|slots|openings|days|availability)\b|\bwhat (?:time|day) (?:do|does|can|could|would|works?|is (?:good|best))\b|\bare you (?:free|available)\b|\b(?:how about|what about|what else|what other|anything else|any other)\b|\b(?:availab[a-z]*|openings?)\b|\b(?:another|second|new|different|next available) (?:appointment|booking|visit|time|slot)\b|\byour (?:next |first |soonest )?(?:appointments?|bookings?|slots?)\b|\b(?:earliest|soonest|how soon)\b|\b(?:can|could|able to)\b[^?.!]*\b(?:come|make it|be out|swing by|stop by|fit (?:me|us) in)\b/;

// Changing a booking — a move or a cancellation. Neither is a status question,
// and both keep exactly the behavior they have today (the scheduling engine's,
// until a capability owns them), so this one can never half-answer either.
const CHANGE_REQUEST =
	/\b(?:reschedul[a-z]*|cancel[a-z]*|postpone|push (?:back|it|this|my|our)|move (?:it|this|my|our|the)|switch|swap|change (?:it|this|my|our|the))\b/;

// What a status question actually asks: WHEN the visit is, or WHETHER one
// exists. This is the guard that keeps the capability out of knowledge's
// territory — "how much is my appointment?" and "do I have to be home for my
// appointment?" name the same booking but ask something an FAQ answers, so
// neither carries a signal here. `have` is scoped away from "have to" for
// precisely that reason.
const STATUS_ASK =
	/\bwhens?\b|\bwhat (?:time|day|date)\b|\bwhich day\b|\bwhat appointments?\b|\b(?:do|did|does) (?:i|we) (?:still )?have\b(?! to\b)|\bhave (?:i|we)\b|\bam i\b|\bare we\b|\bstill (?:on|coming|scheduled|booked|set|happening|good|planned)\b|\bwhat do (?:i|we) have\b|\bwhat(?:s| is) (?:my|our)\b|\bconfirm(?:ed|ing|ation)?\b|\bremind me\b|\b(?:just |double ?)?check(?:ing)? (?:on|in on|about)\b|\bmak(?:e|ing) sure\b/;

// The booking has to be THEIRS. Without this, "what times are booked?" — a
// question about the account's calendar, not the contact's — would read as one.
const OWN_BOOKING =
	/\b(?:my|our) (?:(?:next|upcoming|scheduled|booked|existing|current|first) )?(?:appointments?|appts?|bookings?|visits?|service call|service|slot)\b/;
// The same thing named without a possessive, for the frames that supply the
// ownership themselves ("do I have anything booked?", "what do I have coming up?").
const BOOKING_REFERENCE =
	/\b(?:appointments?|appts?|bookings?|visits?|service call|slot)\b|\b(?:booked|scheduled|penciled in)\b|\bon the (?:books|calendar|schedule)\b|\bcoming up\b/;
const FIRST_PERSON = /\b(?:i|im|ive|me|my|we|weve|were|us|our)\b/;

// "When are you coming?", "what time will the tech be here?", "are you still
// coming today?" — the most common way a booked customer asks never says
// "appointment" at all. It supplies its own ownership (they are asking about a
// visit to *them*), so it needs no first-person word.
const ARRIVAL_SUBJECT =
	/\b(?:you|u|yall|they|he|she|someone|somebody|the (?:tech|technician|plumber|electrician|crew|team|guy|driver))\b/;
const ARRIVAL =
	/\b(?:coming|come|arriving|arrive|be here|get(?:ting)? here|be there|show(?:ing)? up|be out|on (?:your|the) way)\b/;

/**
 * Whether a message asks about a booking the contact ALREADY has — "what
 * appointment do I have coming up?", "when are you coming?", "is my appointment
 * still on?" — rather than asking for a new one or asking about the business.
 *
 * The failure this exists for is the agent answering that question with three
 * fresh openings, which both ignores what was asked and invites a customer who
 * is already on the calendar to book a second visit.
 *
 * Its error directions are the mirror image of {@link isInformationalQuestion}'s
 * and are guarded in the same order. A false negative costs one unanswered
 * status question — today's reply stands. A false positive answers somebody who
 * wanted a *new* time with the one they already have, so every request-shaped
 * and change-shaped phrasing wins, absolutely, before any status signal is read.
 */
export function namesBookingStatusQuestion(text: string): boolean {
	const normalized = text.toLowerCase().replace(/['’]/g, '').replace(/\s+/g, ' ').trim();
	if (!/[a-z]/.test(normalized)) {
		return false;
	}
	if (NEW_BOOKING_REQUEST.test(normalized) || CHANGE_REQUEST.test(normalized)) {
		return false;
	}
	// Something on the calendar is named, but nothing about it is being asked:
	// "my appointment needs a bigger van" is a message for the team, not a
	// question this can answer with a time.
	if (!STATUS_ASK.test(normalized)) {
		return false;
	}
	if (ARRIVAL_SUBJECT.test(normalized) && ARRIVAL.test(normalized)) {
		return true;
	}
	return (
		FIRST_PERSON.test(normalized) &&
		(OWN_BOOKING.test(normalized) || BOOKING_REFERENCE.test(normalized))
	);
}
