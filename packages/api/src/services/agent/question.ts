/**
 * Deterministic reading of whether a customer's message asks *about the
 * business* rather than *about the calendar*. No model in the loop — same
 * philosophy as `parse.ts`: the knowledge capability decides whether to claim a
 * turn with this, so it has to be exhaustively unit-testable and impossible to
 * surprise in production.
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
