# Rescheduling an Existing Booking — Plan

**Status: Planned — not started.**

A customer books through the Rivus agent and then writes back "can you reschedule that to 4pm
instead?". Today that message produces a generic list of three openings and leaves the original
appointment standing on the calendar. This plan adds a first-class **reschedule** capability: one
new `AgentCapability`, six new `AgentDecision` kinds, and one new `CapabilitySideEffects` member,
landing on email, SMS, WhatsApp and voice at once because the agent's layering already guarantees
that (`AGENTS.md` → "Package-specific notes → api"). The comment on `schedulingCapability`
(`packages/api/src/services/agent/capabilities.ts:224`) already reserves the slot: *"A future
`cancelCapability`/`rescheduleCapability` slots in ahead of it and instantly works on every
channel."*

> **Verification convention used throughout.** Claims about what the current code does were checked
> by reading it, and the behavioral ones marked **[verified]** were checked by *executing* the real
> predicate against the real input. Nothing in §1 is inferred from a regex by eye.

Cancellation is deliberately **not** in scope. It is the obvious next capability, and every seam it
needs is named here (§2 Non-goals, §6.11), but no cancel parser, decision kind, or wording is
designed in this document.

---

## 1. What breaks today

### 1.1 The reported transcript, traced through the real code

`handleInboundAgentMessage` (`orchestrator.ts:144`) dispatches to the first capability whose
`matches` returns true, over `defaultCapabilities()` = `[knowledgeCapability, schedulingCapability]`
(`capabilities.ts:378-380`).

1. `knowledgeCapability.matches` (`capabilities.ts:300-318`) declines — `isInformationalQuestion`
   is false because `SCHEDULING_VOCABULARY` (`question.ts:21`) contains `reschedul[a-z]*` and
   `CLOCK_TIME` (`question.ts:56`) matches `4pm`. **[verified]**
2. `schedulingCapability` — whose `matches` is `() => true` (`capabilities.ts:229`) — takes the turn
   and calls `decideScheduling` (`engine.ts:123`).
3. `pickOfferedSlot` returns null: a booked thread has `offeredSlots: []` by construction
   (`capabilities.ts:176`).
4. **`parseProposedTime` returns null.** The message names a clock time and no day, and
   `parseTimeClause` (`parse.ts:630-741`) has no branch for a dayless time — every branch requires
   an ISO date, a month name, `today|tomorrow`, or a weekday. **[verified]**
5. `parseRequestedDay` returns null for the same reason; `isAcknowledgement` and `isPureGreeting`
   are false.
6. Control reaches `engine.ts:324` and returns `{ kind: 'offer_slots', slots }`.

The defect is not that the parser is wrong. It is that the parser is *right about the wrong
question*. `parseProposedTime` refuses a dayless clock because a **new** booking has no day to hang
it on. A reschedule has one — the day of the job already on the thread. Nothing in the current
layering can supply that anchor, because no layer knows a reschedule is being asked for.

### 1.2 Four consequences that make this worse than one unhandled phrasing

**(a) The reply is affirmatively misleading.** The customer is shown three unrelated openings while
their 1:00 PM appointment is untouched and unmentioned. If they pick one, `decideScheduling` books a
**second** job (`engine.ts:150`). The calendar now holds two visits, the transcript shows a
confident confirmation, and nobody is told.

**(b) Near-neighbour phrasings are claimed by the wrong capability.** Executing the real
`isInformationalQuestion` **[verified]**:

| Message | `isInformationalQuestion` | Who answers it today |
|---|---|---|
| `can you push it back an hour?` | **true** | knowledge — FAQ trivia |
| `can you bump it up an hour?` | **true** | knowledge — FAQ trivia |
| `anything before 3?` | **true** | knowledge — FAQ trivia |
| `any chance we could move that to 4?` | **true** | knowledge — FAQ trivia |
| `can you reschedule that to 4pm instead?` | false | scheduling — generic offer |
| `is there a fee to postpone?` | **true** | knowledge — **correctly** |

The first four are people trying to move an appointment and getting business trivia. The last one is
the guard rail: any fix must not steal it.

**(c) `parseProposedTime` actively returns the OLD time for the two most natural move phrasings.**
Its weekday branch (`parse.ts:709-741`) takes the *first* weekday+hour match in the string
**[verified]**:

| Message | `parseProposedTime` returns | What it is |
|---|---|---|
| `move it from thursday at 1 to friday at 2` | `2026-08-06T20:00:00.000Z` | **Thursday 1:00 PM — the anchor** |
| `move my thursday 1pm to friday 2pm` | `2026-08-06T20:00:00.000Z` | **Thursday 1:00 PM — the anchor** |
| `can we do friday at 2 instead of thursday at 1` | `2026-08-07T21:00:00.000Z` | Friday 2:00 PM — correct, by luck of word order |

On a booked thread the first two collide with `bookedSlot` and `engine.ts:162-164` answers
`confirm_existing`: the agent tells a customer asking for Friday that they are all set for Thursday.
**Any reschedule design that calls `parseProposedTime` naively re-books the customer into the time
they are leaving.**

**(d) There is no executor for a move at all.** `CapabilitySideEffects` (`capabilities.ts:77-91`)
declares exactly `bookJob` and `flagForReview`; the orchestrator's only calendar mutation is
`jobs.create` (`orchestrator.ts:156`) and its only rollback is `jobs.delete`
(`orchestrator.ts:175`). `JobRepository.update` exists, but its sole caller in the whole API is
`PATCH /v1/jobs/:id` (`routes/jobs.ts:197`). A capability can *decide* to move a job; nothing can
*perform* one.

### 1.3 Three real-inbox shapes that fail silently today

| Scenario | Why it fails | Owned by |
|---|---|---|
| Books on voice, texts the change next morning | Threads are keyed per `(account, channel, contactAddress)` (`orchestrator.ts:64`), so the SMS thread's `bookedJobId` is `''` — the agent offers a **second** appointment | §6.10, Phase 6 |
| Dispatcher moves the job in the app while a numbered offer stands | `routes/jobs.ts:190-210` writes no transcript note **and never touches `agentThreads`**, so the customer's next "2" moves the job off the dispatcher's chosen time | §6.11, Phase 7 |
| A human replies in the inbox mid-offer | `routes/conversations.ts` flips the conversation back to `rivus_handling` and leaves the agent's numbered offer live | §6.11, Phase 7 |

---

## 2. Goals / Non-goals

### Goals

1. A customer on **any** channel can move an existing booking in one turn ("can you reschedule that
   to 4pm instead?", "push it back an hour", "Friday at 2 instead") or two ("can we reschedule?" →
   numbered options → "2"), and the **same job row** moves: `jobs.list` total is unchanged and
   `thread.bookedJobId` is unchanged.
2. The agent never moves a booking nobody asked to move. Every claim path requires either a word
   that can only be about timing, or a conjunction of two independent signals. Every ambiguity
   resolves to re-offering, never to a move.
3. **Every reschedule reply names both the old window and the new one**, and every *declined* move
   states in its own sentence that the original booking still stands — so a misread ask is visible
   to the customer in the message that made it.
4. **Zero channel renderer edits.** All six decision kinds compose from the existing
   `AgentResponseBlock` vocabulary, proven by `agent-response-matrix.test.ts` (4 channels ×
   every decision).
5. Parsing stays deterministic regex/rules with no model in the loop, in `parse.ts` beside
   everything else that reads a customer's scheduling reply, exhaustively table-tested including an
   adversarial refusal corpus.
6. A half-applied move is impossible: the job write happens **before** delivery inside the
   orchestrator's existing `try`, and a failed send restores the previous `startAt` exactly —
   matching the guarantee `bookJob` already has.
7. Replaying a turn is idempotent in every window `lastExternalMessageId` cannot cover — a crash
   between the job write and the thread write, and voice, where `externalMessageId` is `''` and
   dedupe is deliberately off (`routes/agent-voice-shared.ts:157`). This needs **two** properties,
   not one: the write is an absolute SET rather than a delta, *and* every target is resolved from
   the message rather than from the job's current position (§6.7). The second is why relative shifts
   are out of v1.
8. An agent move is indistinguishable downstream from a dispatcher move: it goes through
   `jobs.update`, raises the same `notifier.jobUpdated` "A job was rescheduled" notice, and leaves
   an `author: 'note'` line in the transcript.
9. A customer who booked on one channel and writes on another can still move the booking, instead of
   being offered a second appointment.
10. The seam for a future `cancelCapability` is explicit and narrow.

### Non-goals

- **Cancellation.** `namesCancellation` is exported from `parse.ts` and hard-declines every
  reschedule path; the orchestration, state and wording seams are named (§6.11). No cancel parser,
  decision kind, `JobStatus` transition or wording is designed here. A message that is both
  ("can we cancel and rebook for Friday?") is claimed by neither capability and falls through to
  scheduling — nothing is destroyed and nothing is moved.
- **A bare digit as a clock time** ("make it 4", "can we do 2?"). `STANDALONE_TIME`
  (`parse.ts:149-157`) refuses bare digits on purpose, and once `reschedule_offered` exists a
  numbered offer is on the table *by construction* — the exact collision that comment warns about.
  Deferred with its own table (§10).
- **Spelled-out hours from voice transcription** ("four pm", "half past one"). A homophone resolving
  to the wrong hour is precisely the failure this design refuses everywhere else.
- **Relative shifts** ("push it back an hour", "half an hour earlier", "bump it up 30 minutes") as a
  *resolved target*. A shift is derived from where the job currently sits, so a replay re-derives it
  and walks the booking forward once per delivery — breaking the idempotency property in exactly the
  two windows dedupe cannot close (§6.7). The phrasing is still **claimed** (so it stops reaching the
  FAQ path, §1.2(b)) and answered with concrete numbered windows; only the arithmetic is deferred.
- **Compare-and-set on `JobRepository.update`.** The existing `book` path is already
  last-writer-wins (`loadBusyIntervals` → `decideScheduling` → `jobs.create`, never
  `findOverlapping`, whose only API caller is `GET /v1/jobs/conflicts` at `routes/jobs.ts:139`). The
  move matches that tolerance rather than shipping two consistency stories in one turn. The seam is
  named in §10, not built.
- **Disambiguating between two upcoming jobs for the same customer.** More than one live upcoming
  job → decline and hand to a human via the existing `flagForReview`.
- **Moving a job the team has advanced** (`in_progress`, `completed`) **or called off**
  (`canceled`), or one whose window has passed. All four decline and delegate to scheduling.
- **A `too_soon` refusal inside `MIN_NOTICE_MINUTES`.** See §6.8 — the notice window keeps governing
  what the agent *offers*, not what it *accepts*.
- **Any change to `renderEmailResponse`'s subject derivation.** A reschedule keeps `Re: {subject}`
  so the mail client keeps one conversation; a `Rescheduled:` prefix would fork the thread and make
  the confirmation look like a second booking. `jobTitle` is derived from the same subject
  (`orchestrator.ts:129`).
- **An offer-expiry TTL on the thread.** Staleness is handled by re-validating the job and the
  picked slot at read time, which also covers the two cases a TTL cannot (the team canceled it; the
  team moved it).

---

## 3. Architecture

The feature is one new `AgentCapability` plus six new `AgentDecision` kinds, exactly as `AGENTS.md`
prescribes — but **three seams have to be widened first**, because the current layering makes a
correct reschedule capability literally unimplementable.

### 3.1 Seam 1 — `matches` is synchronous, the anchor is asynchronous

`AgentCapability.matches(ctx): boolean` (`capabilities.ts:110`) cannot `await deps.jobs.findById`,
and `TurnContext` carries no booked slot: `schedulingCapability` only obtains one *inside* `handle`
(`capabilities.ts:236-245`). So parsing splits into two layers:

- a **context-free predicate** `namesRescheduleShape(text)` that `matches` can call, and
- an **anchor-aware resolver** `parseRescheduleRequest(text, { booked, timeZone, now })` that only
  `handle` can call.

When the anchor turns out to be dead or absent, `handle` returns `schedulingCapability.handle(ctx)`
— the delegation precedent already in the file at `capabilities.ts:343`. The drift risk this
introduces (two reads of one message) is *pinned by a test*: `matches === true` for every message
`parseRescheduleRequest` claims. The drift is acknowledged and bounded, not denied.

### 3.2 Seam 2 — a thread must hold a live booking **and** a standing offer at once

`state === 'slots_offered' && bookedJobId !== ''` already occurs today and already means *"book a
second job"* — it is what a booked contact asking "what else is open?" produces. Reusing it for a
move offer would make the customer's next "2" ambiguous between booking a second visit and moving
the first, which is the single worst outcome available to this feature. `AgentThreadState` therefore
gains `'reschedule_offered'`. `bookedJobId` already names the target job, so no second field is
needed.

### 3.3 Seam 3 — there is no executor for a move

`CapabilitySideEffects` gains `moveJob`, executed by the orchestrator inside the same pre-delivery
block as `bookJob` and undone by a single shared `rollbackEffects()`.

### 3.4 Layering, unchanged and reinforced

`parse.ts` gains vocabulary and one anchor-aware resolver. `engine.ts` gains a second pure function
`decideReschedule` beside `decideScheduling`. `response.ts` gains six `contentFor` cases built from
existing block kinds. `capabilities.ts` gains the capability and one registry line. `orchestrator.ts`
gains one side effect and its rollback. **No file under `services/agent/<channel>/` and no
`routes/agent-<channel>.ts` is touched for the feature itself** — with one deliberate, one-time
exception (§3.7).

### 3.5 The decision union splits so `decideScheduling` provably cannot emit a move

`AgentDecision` becomes `SchedulingDecision | KnowledgeDecision | RescheduleDecision`, with
`decideScheduling(input): SchedulingDecision` and `decideReschedule(input): RescheduleDecision`.
`schedulingCapability.matches` is `() => true`, so if the always-reachable fallback could *legally*
return `{ kind: 'reschedule' }`, an unparseable message on a booked thread could move a booking.
Narrowing the return type makes that a **type error**. `contentFor` and `threadPatchFor` keep taking
the wide `AgentDecision`, so their exhaustive switches and the render matrix are unchanged.

### 3.6 Registry order is the safety property — and it is not what the existing comment implies

`defaultCapabilities()` becomes `[rescheduleCapability, knowledgeCapability, schedulingCapability]`.
Registering merely "ahead of scheduling" is **insufficient**: per the §1.2(b) table, knowledge
claims four of the most natural move phrasings. Reschedule therefore goes **first**, and its
`matches` carries the whole restraint — mirroring how `knowledgeCapability.matches` carries
knowledge's.

Two guards keep it from starving knowledge:

- `namesPolicyQuestion` (fee / policy / charge / cost / "how much" / "what happens if")
  hard-declines, so `is there a fee to postpone?` stays a knowledge turn.
- On a `reschedule_offered` thread, an informational question carrying no reschedule shape and no
  pick is handed on to knowledge — the same doctrine knowledge already applies to scheduling.

`matches`, in order: (1) `namesCancellation` → false. (2) `namesPolicyQuestion` → false.
(3) `namesRescheduleShape(text)` → true. (4) not `state === 'reschedule_offered'` → false.
(5) a pick of `thread.offeredSlots` → true. (6) `isAcknowledgement || isPureGreeting` → true.
(7) `isInformationalQuestion` → false. (8) → true.

**A question *about* an option is not a pick of it.** `parseSlotChoice`'s keyworded branch
(`parse.ts:244`) matches `option|choice|slot|number` + a digit **anywhere in the sentence**, so on a
`reschedule_offered` thread "Is option 2 in the morning?" is a `parseSlotChoice` match — and step
(5) above would claim it as an acceptance and move the booking on a message that only asked a
question. That is a direct breach of Goal 2, so `parseRescheduleRequest` adds a
`namesOptionInquiry(text)` guard: a wh-word (`what|when|where|how|which|why`) or a copular frame
(`is|are|was|does|will` + the option reference) with **no** acceptance token (`works`, `let's`,
`i'll take`, `can we do`, `book`, `do`) means the reply is asking, not choosing.

The guard lives in the pick **resolution**, not in `matches` — the turn is still reschedule's, and
handing it to knowledge would be wrong twice over (knowledge's own guard sees the `parseSlotChoice`
match and declines, so it would fall through to scheduling and produce a generic booking offer).
Instead an option inquiry resolves to `unspecified`, which the engine answers with
`offer_reschedule_slots` **restating the same windows in the same order**. That literally answers
"is option 2 in the morning?" — the list carries the times — while moving nothing and keeping the
numbering the contact was given. An acceptance phrased as a question ("can we do the second one?")
carries an acceptance token and still books the move.

**The standing-offer read is deliberately not unified.** `knowledgeCapability` reads the offer
through a new `standingOffer(thread)` that returns `thread.offeredSlots` for both `slots_offered`
and `reschedule_offered`, so an FAQ asked mid-reschedule restates the same numbered list.
`schedulingCapability` (`capabilities.ts:250`) keeps the **state-exact** read, so a stale reschedule
offer can never be booked as a new job if reschedule somehow fails to claim the pick. Two readers,
two different correct answers, both commented.

### 3.7 Voice terminality moves out of the channel

`routes/agent-voice-shared.ts:17` holds
`VOICE_TERMINAL_OUTCOMES = new Set(['book','confirm_existing','send_signup_link'])`, consumed at
`:164`. Adding a reschedule outcome string there would be a channel edit for a core feature —
precisely what `AGENTS.md` forbids, and a tax every future capability would pay. Instead
`CapabilityOutcome` gains `endsConversation?: boolean`, `InboundHandleResult` surfaces it,
`runVoiceTurn` tests `result.endsConversation`, and the Set is **deleted**. One bounded, one-time
channel edit that makes reschedule — and cancellation after it — ship with zero.

Without it, a caller who successfully reschedules by phone hears the confirmation and is then
re-prompted to keep talking, with no failing test anywhere.

### 3.8 Availability gets two views of one calendar, not one filtered view

`BusyInterval` gains `jobId?: JobId` and `loadBusyIntervals` populates it — additive, ignored by
`isSlotFree`. `decideReschedule` then uses:

- **`busy` unchanged** for every offer and every alternative, so the customer's own window is never
  advertised back to them; and
- **`busy.filter(i => i.jobId !== current.jobId)`** *only* for the target's freeness check, so
  "move my 1pm to 1:30" does not collide with itself.

Both halves are needed and they are different problems. Filtering the shared helper's output instead
would poison the offers; filtering **by value** rather than by id would drop a co-located second job
(two techs, same hour) and permit a real double-book. The repo already names this pattern —
`FindOverlappingJobsOptions.excludeJobId` (`repositories/types.ts:380`).

### 3.9 Duration is the job's own, and it is validated at that length

`decideScheduling` hardcodes `SLOT_DURATION_MINUTES` (`engine.ts:158`). `decideReschedule` uses
`current.slot.durationMinutes` for the target slot, for `isWithinBusinessHours`, for `isSlotFree`,
and for every `computeOpenSlots`/`computeOpenSlotsOnDay` call (both already accept
`durationMinutes`). A job longer than the business day
(`BUSINESS_START_HOUR * 60 + duration > BUSINESS_END_HOUR * 60`, i.e. > 480 minutes) can never be
placed by the slot generators, so it short-circuits to `reschedule_held` + `flagForReview` rather than
producing a guaranteed-empty offer.

---

## 4. Data model additions

### 4.1 `packages/core/src/types.ts` — `AgentThreadState` gains one member

```ts
/**
 * … existing members …
 * - `reschedule_offered` — the agent offered windows to MOVE the booking in
 *   `bookedJobId` into, and is waiting for a pick. That booking still stands
 *   until one is picked, which is why this is not `slots_offered`: a pick there
 *   books a NEW job, and `slots_offered` + a live `bookedJobId` already occurs
 *   today and already means exactly that (a booked contact asking "what else is
 *   open?").
 */
export type AgentThreadState =
	| 'new'
	| 'awaiting_signup'
	| 'slots_offered'
	| 'booked'
	| 'reschedule_offered';
```

**No new `AgentThread` field.** `bookedJobId` already names the job a move targets.

### 4.2 The three mirrors of that union

`AgentThreadState` is duplicated in four places, and only one of them is a compile-time mirror:

| File | Change | Consequence of forgetting |
|---|---|---|
| `packages/core/src/schemas.ts:722` | widen `agentThreadStateSchema` z.enum | the tester API rejects the state at the boundary |
| `packages/api/src/db/models/agent-thread.model.ts:17,54` | widen the document union + Mongoose `enum` | writes fail validation in production only |
| `packages/app/src/tester/meta.ts:29` | add a `STATE_META` entry | **compile error** (`Record<TesterSession['state'], …>`), and `agent-tester.tsx:698` indexes it unguarded |

Widening a Mongoose enum is backward compatible: existing documents keep their values, **no
migration, no backfill**, and the unique `{ accountId, channel, contactAddress }` index is
untouched. The app's exhaustive `Record` turning the ripple into a compile error is a feature — the
tester is where staff drive this end to end.

The chip needs a *visually distinct* colour pair, not a copy of `slots_offered`'s. `DESIGN_SYSTEM.md`
documents Sky `#1ebefa` and Soft sky `#eef8ff` but no ink/tint pair, and `tokens.ts` has no `sky*`
token at all — so per `AGENTS.md` the pair is added to `DESIGN_SYSTEM.md` and
`packages/app/src/theme/tokens.ts` **before** the app uses it. Never an inline `rgba` literal.

### 4.3 `packages/api/src/services/agent/engine.ts` — the split union

```ts
export type SlotObjection = 'taken' | 'outside_hours' | 'in_past' | 'beyond_horizon';
export type DayObjection = 'full' | 'closed' | 'in_past' | 'beyond_horizon';

export type SchedulingDecision = /* the eight kinds decideScheduling returns today */;
export type KnowledgeDecision = /* answer_question | hold_for_team */;

export type RescheduleDecision =
	| { kind: 'send_signup_link' }
	/** The booked job moved. `from` is the window it left, so the reply names both sides. */
	| { kind: 'reschedule'; from: AgentSlot; to: AgentSlot }
	/**
	 * Nothing moved and nothing should. `requestedStartAt` is the instant asked for
	 * when there was one — and it EQUALS the booking's start, which is the only
	 * no-op there is (an overlapping but different start is a real move, §6.6) —
	 * and null when the customer stood down ("actually keep it", "thanks!", "hi").
	 */
	| { kind: 'reschedule_unchanged'; slot: AgentSlot; requestedStartAt: IsoDateString | null }
	| { kind: 'reschedule_unavailable'; reason: SlotObjection; from: AgentSlot;
	    requestedStartAt: IsoDateString; alternatives: AgentSlot[] }
	| { kind: 'reschedule_day_unavailable'; reason: DayObjection; from: AgentSlot;
	    requestedDayStartAt: IsoDateString; alternatives: AgentSlot[] }
	/** Move windows on offer. `slots` MAY be empty — nothing to move it to. */
	| { kind: 'offer_reschedule_slots'; from: AgentSlot; slots: AgentSlot[];
	    requestedDayStartAt?: IsoDateString }
	/** A move was asked for with no live booking to move. `alternatives` may be empty. */
	| { kind: 'nothing_to_reschedule'; alternatives: AgentSlot[] }
	/**
	 * A human owns this move: the job is longer than the business day (§3.9), or
	 * the customer has more than one upcoming job and the agent will not guess
	 * (§6.10). `slot` is the booking when exactly one is identified and null when
	 * the ambiguity is *which* booking — either way the reply must say nothing
	 * moved, which is why this is NOT knowledge's `hold_for_team` (§6.12).
	 */
	| { kind: 'reschedule_held'; slot: AgentSlot | null };

export type AgentDecision = SchedulingDecision | KnowledgeDecision | RescheduleDecision;

export function decideScheduling(input: SchedulingDecisionInput): SchedulingDecision;
export function decideReschedule(input: RescheduleDecisionInput): RescheduleDecision;

/** Shared by both engines so the guard ORDER cannot drift between book and move. */
function slotObjection(slot: AgentSlot, ctx: { now: Date; timeZone: string; busy: BusyInterval[] })
	: SlotObjection | null;
```

`propose_unavailable.requestedStartAt` is widened from `string` to `IsoDateString` in the same
commit, so the file carries one convention.

### 4.4 `packages/api/src/services/agent/parse.ts` — new vocabulary, two entry points

```ts
/** Words that call a booking OFF rather than move it. The cancel-capability seam. */
export function namesCancellation(text: string): boolean;

/** A question ABOUT rescheduling rather than a request to reschedule (§3.6). */
export function namesPolicyQuestion(text: string): boolean;

/**
 * A question ABOUT a listed option rather than a pick of it — "is option 2 in the
 * morning?", "how long is slot 1?". `parseSlotChoice`'s keyworded branch matches
 * an option reference anywhere in a sentence, so without this a question moves a
 * booking. See §3.6.
 */
export function namesOptionInquiry(text: string): boolean;

/** Lexical only — a message that asks to MOVE a booking. No calendar, no anchor. */
export function parseRescheduleIntent(text: string): boolean;

/** The wider claim predicate a synchronous `matches` uses (§3.1). */
export function namesRescheduleShape(text: string): boolean;

/** Every unmistakable clock the text names, first-seen order, deduped by minute-of-day. */
export function listedTimes(normalized: string): ListedTime[];

/** Every complete day+time instant the text names — parseTimeClause's shapes, swept. */
export function listedInstants(text: string, context: ParseTimeContext): IsoDateString[];

/** A clock time placed on one named local day. */
export function instantOnDay(day: RequestedDay, time: WantedTime, timeZone: string)
	: IsoDateString | null;

export type RescheduleTarget =
	// Both sources are anchored to what the MESSAGE says, never to where the job
	// currently sits — the property §6.7's idempotency argument rests on.
	| { kind: 'instant'; startAt: IsoDateString; source: 'explicit' | 'anchor_day' }
	| { kind: 'preference'; day: RequestedDay; earliest: number | null; latest: number | null }
	| { kind: 'unspecified' };

/** null = not a reschedule; let the next capability have it. */
export function parseRescheduleRequest(
	text: string,
	context: ParseTimeContext & { booked: AgentSlot },
): { intent: 'named_move' | 'bare_time' | 'refused_booking'; target: RescheduleTarget } | null;
```

`namesSeveralTimes` is reimplemented on top of `listedTimes` so `matchOfferedSlot` stays bit-for-bit
unchanged.

### 4.5 `packages/api/src/services/agent/capabilities.ts`

```ts
export interface CapabilitySideEffects {
	bookJob?: CreateJobInput & { note: string };
	/**
	 * Move an existing job BEFORE delivering, exactly like `bookJob` — and restored
	 * to `previousStartAt` if the send fails, since a customer who never received
	 * the confirmation must not find their appointment moved.
	 *
	 * `startAt` is an ABSOLUTE instant, never a delta, so replaying the turn
	 * re-applies the same window instead of shifting the job twice — the only
	 * protection voice has, where externalMessageId is '' and dedupe is off.
	 *
	 * The patch deliberately carries ONLY startAt: durationMinutes is unchanged by
	 * a move, and re-asserting it would clobber a duration a human edited between
	 * the capability's read and this write.
	 */
	moveJob?: {
		jobId: JobId;
		startAt: IsoDateString;
		previousStartAt: IsoDateString;
		/** The inline transcript note recorded after a successful send. */
		note: string;
	};
	flagForReview?: { pendingReply: string; flagReason: string };
}

export interface CapabilityOutcome {
	/* … existing … */
	/**
	 * Whether this turn ends the exchange. Voice hangs up on it instead of
	 * listening for another turn; every other channel ignores it. Core-owned so a
	 * new capability never edits a channel to become terminal.
	 */
	endsConversation?: boolean;
}

/** The live job an id names, or null. Extracted verbatim from capabilities.ts:236-245. */
async function liveJob(jobs, accountId: AccountId, jobId: string, now: Date): Promise<Job | null>;

/**
 * The numbered offer currently in front of the contact — for a reader that only
 * needs to RESTATE it or refuse to claim a pick of it. Deliberately NOT used by
 * schedulingCapability (capabilities.ts:250), which keeps the state-exact read.
 */
export function standingOffer(thread: AgentThread): AgentSlot[];

// loadBusyIntervals (~line 137): tag every interval with its job.
busy.push({ startAt: job.startAt, durationMinutes: job.durationMinutes, jobId: job.id });
```

### 4.6 What does **not** change

`UpdateAgentThread` (`repositories/types.ts:537`) is untouched — the new state is a value of the
existing `AgentThreadState`, and `bookedJobId` already exists.
`AgentThreadRepository.findByConversationId` already exists (`types.ts:571`) and is what Phase 7's
human-reply guard uses. **The whole feature adds no repository method and no repository field.**
`packages/app/src/api/client.ts:622` uses `agentThreadStateSchema` from `@rivus/core`, so it widens
automatically — the only work there is a test proving it parses the new value.

---

## 5. The state machine

| State | Inbound | Decision | Next state | Side effect |
|---|---|---|---|---|
| `booked` (live job J) | "can you reschedule that to 4pm instead?" — resolvable target | `reschedule { from: Thu 1 PM, to: Thu 4 PM }` | `booked`, `offeredSlots: []`, `bookedJobId` **unchanged** | `moveJob`; then note + `jobUpdated`; `endsConversation` |
| `booked` (J) | "can we reschedule?" — intent, no target | `offer_reschedule_slots { from, slots: 3 }` | `reschedule_offered`, offer = the 3 move windows | none — the job has not moved |
| `booked` (J) | "push it back an hour" — a **relative** shift | `offer_reschedule_slots { from, slots: 3 }` — the shift is claimed but not resolved (§6.7) | `reschedule_offered` | none. The next pick is an absolute target, so the replay property holds |
| `booked` (J) | "move it to 4pm", 4 PM taken by another job | `reschedule_unavailable { reason: 'taken', … }` | `reschedule_offered` (alternatives become the standing **move** offer); `booked` if none | none; the reply says the booking still stands |
| `booked` (J) | Saturday / 5 PM / past / past the horizon | `reschedule_unavailable { outside_hours \| in_past \| beyond_horizon }` | as above | none |
| `booked` (J) | "can we move it to Friday?" — day, no clock | anchor's own time on Friday if free → `reschedule`; else `offer_reschedule_slots { requestedDayStartAt }` or `reschedule_day_unavailable` | `booked` on a move; `reschedule_offered` on an offer | `moveJob` on the move branch only |
| `booked` (J) | "move it to 1pm" — **the exact time it is already at** | `reschedule_unchanged { slot: J, requestedStartAt }` | `booked`, `offeredSlots: []` | none. Instant equality only — an overlapping but different start ("move my 1pm to 1:30") is a real move (§6.6) |
| `booked`, J > 8h long | any reschedule ask | `reschedule_held { slot: J }` | `booked` (patch is `{}`) | `flagForReview`; the reply still names the booking and says nothing moved |
| **`reschedule_offered`** (J, 3 windows) | **"2" — the hard case** | `reschedule { from: J's current slot, to: offeredSlots[1] }`; re-checked for `in_past`/`taken` only, mirroring `engine.ts:131-151` | `booked`, `offeredSlots: []`, `bookedJobId` unchanged, **exactly one job** | `moveJob` + note + `jobUpdated`; `endsConversation` |
| `reschedule_offered` | "2", days later — the window has passed | `reschedule_unavailable { in_past, alternatives: fresh }` | `reschedule_offered` with fresh alternatives | none |
| `reschedule_offered` | "actually can you do Friday at 10 instead?" | `reschedule` — the target wins over the standing offer | `booked` | `moveJob` — the **same** job, never a second |
| `reschedule_offered` | "actually keep it" / "thanks!" / "hi" | `reschedule_unchanged { requestedStartAt: null }` | `booked`, `offeredSlots: []` — the stale offer is retired because the reply did not restate it | none |
| `reschedule_offered` | "what are your hours?" — informational, no shape, no pick | knowledge claims it → `answer_question { offeredSlots: standingOffer(thread) }` | `reschedule_offered` **unchanged**; the reply re-lists the same numbers | none; the following "2" still **moves** |
| `reschedule_offered` | anything, but the team canceled/deleted J | no live anchor → `schedulingCapability.handle` → `offer_slots` | `slots_offered` — the reschedule is retired and a later pick correctly **books** | none |
| `reschedule_offered` | "2", but the team **moved** J in the app | Phase 7 retires the offer on the PATCH, so normally → `offer_reschedule_slots` against J's new time. If the offer survived, `reschedule` from J's **current** time (re-read every turn; nothing snapshotted) | `reschedule_offered` (fresh) or `booked` | `moveJob` only on the survived-offer branch; the confirmation names the real prior time |
| `reschedule_offered` | a human replies in the inbox | n/a — no agent turn | `booked`, `offeredSlots: []` (Phase 7) | none. Without this the next "2" moves the job off the time the human just arranged |
| `slots_offered` (nothing booked) | "can we reschedule?" | no anchor → `offer_slots` | `slots_offered` — here it means "different times please"; a pick **books** | none |
| `new` / `bookedJobId: ''` | "can you move it to 4pm?" — booked on another channel | CRM lookup: exactly one live upcoming job → `reschedule`; zero → `nothing_to_reschedule`; ≥ 2 → `reschedule_held { slot: null }` | `booked` with `bookedJobId` written onto **this** channel's thread | `moveJob`, or `flagForReview` on the ambiguous branch |
| any | "cancel my appointment" | `namesCancellation` → reschedule declines; knowledge declines (`cancel[a-z]*`) → `offer_slots` | `slots_offered` | none — nothing moved, nothing called off. The cancel seam |
| `booked` | "is there a fee to postpone?" | `namesPolicyQuestion` → reschedule declines → knowledge answers | unchanged | none |
| `booked` | the refusal corpus ("move the fridge to the garage", "we're moving house", "see you later!", "I get off work at 4:30") | reschedule declines lexically → knowledge or scheduling as today | unchanged | none. `job.startAt` byte-identical afterwards |

---

## 6. Load-bearing decisions

### 6.1 `rescheduleCapability` owns the claim; `matches` is lexical-plus-state only

**Decision.** `matches(ctx)` never touches a repository (order in §3.6). `handle` resolves the
anchor, calls `parseRescheduleRequest`, calls `decideReschedule`, and delegates to
`schedulingCapability.handle(ctx)` whenever the anchor is dead or absent.

**Rejected.** Making `matches` async so it can load the job — it changes a shared interface two
existing capabilities and nine routes depend on, for a check that belongs in `handle` anyway. Also
rejected: registering reschedule *after* knowledge, which loses all four phrasings in §1.2(b).

### 6.2 `'reschedule_offered'` as an enum member, not a flat `pendingAction` field

**Decision.** Add the enum member (§4.1–4.2). Add no new `AgentThread` field.

**Why.** `state` must not lie about what a numbered pick does. A flat `pendingAction` discriminant
leaves `state === 'slots_offered'` on a thread where a pick **moves** rather than **books**, so
every present and future reader of `state` alone is wrong — and there are already three such
readers. The enum's real hazard is the mirror image: `AgentThreadState` is read almost entirely by
equality (`thread.state === 'slots_offered' ? thread.offeredSlots : []` at `capabilities.ts:250`,
`:304`, `:361`) with **no exhaustive switch anywhere**, so a new member silently empties all three.
`standingOffer` fixes that once, in the two places where restating an offer is correct; the third is
deliberately left strict as a fail-safe.

**Rejected.** `pendingAction: '' | 'reschedule'` + `pendingActionJobId` — needs a second field the
enum does not, makes `state` mean something it does not say, and its worst failure (a stale
`pendingAction` surviving into a generic `offer_slots`, so a later "2" moves an untargeted job) has
to be prevented by a hand-maintained clear-vs-preserve table across every decision kind.

### 6.3 Anchor elimination on both clocks **and** days

**Decision.** `parseRescheduleRequest` never trusts `parseProposedTime` on the whole message. It
(a) excises `from …` segments and cuts at `instead of | rather than | in place of | as opposed to`;
(b) splits on the existing `CLAUSE_BOUNDARY` and drops `NEGATION` clauses; (c) collects every
complete day+time via `listedInstants` and **drops any equal to `booked.startAt`**; and then
branches on **how many survive that elimination**, not on how many were found:

| Survivors | Result |
|---|---|
| exactly 1 | that instant is the target |
| **0** | fall back to (d) — day-only / time-only resolution, applying `parseRequestedDay` and `listedTimes` to the text **after** the destination preposition rather than to the whole clause |
| ≥ 2 | `unspecified` — the ambiguity refusal; the engine offers real openings rather than guessing |

Counting *before* elimination would strand the commonest shapes there are: "move my thursday 1pm to
2pm" and "move my thursday 1pm to friday" each contain exactly one complete instant, and it is the
anchor. Dropping it leaves nothing, so a pre-elimination count of "one, not zero" would skip (d) and
resolve no destination at all.

**Why.** §1.2(c). Day elimination is equally load-bearing, and path (d) is where it bites: for
"move my thursday 1pm to friday" the *only* complete instant is the anchor, so eliminating it leaves
nothing and control falls through to the day/time path. There `parseRequestedDay` reads the **first**
weekday in the message — thursday, resolved to the anchor's own Thursday by its 1..7 scan at
`parse.ts:838` — and a customer who said Friday is answered about the day they are already booked
on. Reading the day from the text *after* the destination preposition ("to friday") is what fixes
it.

Contrast "move my thursday 1pm to friday 2pm", which never reaches (d) at all: `listedInstants`
finds **both** instants, the anchor is dropped, and Friday 2:00 PM is the single survivor. That is
the point of ordering (c) before (d) — the elimination is word-order-independent and therefore
robust to phrasings nobody enumerated, and the pivot rules are the tiebreak, not the mechanism.

**Rejected.** Taking the last clock in the message — reads "move my 1pm to 4pm" correctly and "4pm
instead of 1pm" backwards, into the time the customer just rejected. Also rejected: loosening
`NEGATION` so `instead of <time>` stops registering as a refusal — that regex is read by
`refusesPick`, `parseProposedTime` and `parseRequestedDay` on **every turn on every channel**, and
"anything but 2pm" must keep refusing.

### 6.4 Two views of the calendar

Covered in §3.8. **Rejected:** adding `excludeJobId` to `loadBusyIntervals` itself (`BusyInterval`
carries no id today, and the helper's other caller must keep the full view); filtering by value
equality (silently permits a real double-book).

### 6.5 Six flat decision kinds, in a split union

**Why not parameterize `book` with `movesFrom?: AgentSlot`.** Three consumers switch on `kind` and
would all have to re-derive intent from an optional field: `threadPatchFor` decides
`slots_offered` vs `reschedule_offered` — the branch that decides whether the next "2" books or
moves; the orchestrator decides whether to create a job; `contentFor` renders `book` as "You're
booked!", which for a move is a lie by omission. Distinct kinds make *"did we create a job or move
one?"* a compile-time discriminant. `agent-response-matrix.test.ts` also enumerates decisions by
hand keyed on `decisionLabel`, so a parameterized variant would not automatically earn its own row.

### 6.6 `reschedule_unchanged` is **instant equality**, and it absorbs the stand-down

**Decision.** One kind with two copy shapes: the requested instant **equals** the booking's start,
and `requestedStartAt: null` for an acknowledgement, greeting or "actually keep it" on a
`reschedule_offered` thread. Patch: `{ state: 'booked', offeredSlots: [] }`.

**Why equality and not overlap.** An overlap test would refuse the most ordinary reschedule there
is: a 60-minute job at 1:00 PM moved to 1:30 PM overlaps its own old window, and answering *"there's
nothing for me to move"* to a customer asking for a half-hour shift is simply wrong. The same goes
for a 120-minute job at 1:00 PM pushed to 2:00 PM — the visit would run 2–4 instead of 1–3, which is
a real move. **Overlap with the customer's own booking is not a no-op; it is the normal case, and it
is already handled by excluding the current job from the target's conflict check (§3.8).** Only an
identical start means there is nothing to do.

This is deliberately *not* the same test as `engine.ts:162-164`, which does use overlap
(`!isSlotFree(slot, [input.bookedSlot])`). That guard answers a different question — "is this
proposal a *confirmation* of the booking rather than a new request?" — where any collision with the
existing window means the customer is talking about the visit they already have. A reschedule turn
has already established that they want it moved, so the only thing left to detect is whether the
destination is where it already is.

**Why absorb the stand-down.** It stops a `reschedule_offered` thread being answered with another
list of move windows when the customer says "thanks!" — `confirm_existing`'s patch is `{}`
(`capabilities.ts:160`), which would strand three numbered options the reply did not restate.

### 6.7 `moveJob` writes `{ startAt }` only, absolutely, undone by one shared `rollbackEffects()`

**Decision.** The orchestrator hoists `outboundCtx` above a single `try` containing the `bookJob`
create, the `moveJob` update, and `adapter.deliver`; the `catch` calls `rollbackEffects()` (delete
the created job; restore `previousStartAt`) and rethrows. `jobs.update` returning `null` means the
team deleted the job mid-turn — nothing delivered, nothing recorded, and a `RetryDeliveryError`
(`capabilities.ts:36`, already mapped to HTTP 500) makes the provider redeliver. A failed restore is
logged at `error` with `{ jobId, startAt, previousStartAt }` and swallowed so the delivery error
still reaches the provider.

**Why absolute.** A SET replays as a no-op where a shift would move the job twice — the only
protection voice has. It also covers the crash window between the job write and
`agentThreads.update` that message-id dedupe cannot reach: the replay re-reads the job, finds it
already at the target, and *confirms* instead of moving again.

**The property that actually makes that true, stated exactly.** An absolute write is *not*
sufficient on its own. What makes the replay a no-op is that **every v1 target source resolves from
the message alone, never from where the job currently sits** — `explicit` reads the instant the
customer typed, and `anchor_day` reads a clock the customer typed placed on the booking's day, which
a completed move does not change. A *relative* source would break it: "push it back an hour" against
a job already moved to 4:00 PM re-derives 5:00 PM, and the booking walks forward once per replay.
The two windows where that bites are precisely the two dedupe cannot close — voice
(`externalMessageId: ''`) and the crash window above.

That is why `parseRelativeShift` is **not in v1** (§2 Non-goals, §10). "Push it back an hour" is
still claimed by `namesRescheduleShape`, so it stops going to FAQ trivia (§1.2(b)); it resolves to
`unspecified` and is answered with `offer_reschedule_slots` — concrete numbered windows, each of
which is an absolute target when picked. One extra turn, and the safety property stays true rather
than nearly true.

**Why `{ startAt }` alone.** Both repositories apply every field present in the patch
(`memory.ts:920` spreads `...input`; Mongo `$set`s `{ ...input }`), so re-sending an unchanged
duration is a last-writer-wins clobber of a concurrent human edit — and the rollback would clobber
it twice.

**Rejected.** A relative `shiftMinutes` payload (every replay moves the job again). Writing the move
*after* delivery to dodge rollback (then a successful send races a failed write and the customer is
told about a move that never happened — worse than the reverse). Flagging the conversation from
inside the `catch` (leaves a `needs_attention` behind for a turn the customer never saw).

### 6.8 No `too_soon` reason — `MIN_NOTICE_MINUTES` governs what the agent *offers*

**Decision.** `reschedule_unavailable` carries the same four reasons as `propose_unavailable` and
nothing else. `MIN_NOTICE_MINUTES` stays inside `computeOpenSlots`/`computeOpenSlotsOnDay`
(`slots.ts:194`, `:295`). A pick of a standing move offer is re-checked for `in_past` and `taken`
only.

**Why.** `decideScheduling` deliberately does **not** apply notice to a customer-named time
(`engine.ts:153-202` checks in_past / horizon / hours / free and nothing else), so a `too_soon`
refusal would let the agent *book* you at 4:00 PM today and refuse to *move* you to 4:00 PM today.
Worse, it would contradict the account's own published knowledge base: the canonical seeded FAQ
(`seed-data.ts:149`) reads *"You can reschedule or cancel up to 24 hours before your appointment at
no charge. For changes inside 24 hours a small fee may apply"* — and `knowledgeCapability` answers
from exactly those FAQs. The same agent would quote "you can, a fee may apply" and then refuse. It
also refuses "I'm running late, move me to 4pm", the commonest real reschedule.

Restricting the offered-pick re-check to `in_past`/`taken` matters too: offers satisfy the notice
window only at the instant they are computed, so a thread that sits a day would otherwise refuse the
agent's own option 2.

**If the business wants a same-day gate**, express it as `flagForReview` attached to a *successful*
move — the existing human hand-off seam — not as a refusal.

### 6.9 No new `AgentResponseBlock` kind

**Decision.** All six kinds compose from greeting / paragraph / options / notice; `action` is `null`
in all six. A shared `bookingUntouchedSentence(slot, context)` is `lead[1]` of both decline kinds on
every medium. Both decline kinds get a **move-specific third lead line** ("Here is what I could move
you to instead:") rather than reusing `propose_unavailable`'s "Here is what we do have open:". A
shared `pickAMove(medium)` replaces `pickAnOption` wherever the numbers move rather than book.
`book`'s trail is extracted byte-identically into `changeOrCancelTrail(context)` and shared with
`reschedule`. `offer_reschedule_slots` and `nothing_to_reschedule` each get **two** explicit shapes.

**Why.** A `diff`/`change` block would be a compile error in `email/renderer.ts`, `chat-renderer.ts`
and `voice/renderer.ts` simultaneously, and voice would have to invent a way to *speak* a two-column
table — exactly what the block union's doc comment (`response.ts:5-13`) warns against. On the copy:
a customer who reads only "Unfortunately 4:00 PM was just taken" cannot tell whether they still have
a 1:00 PM appointment or nothing at all, and on voice they get one hearing — so the reassurance is a
**correctness property**, and it lives in `lead`, never in the trail (the first thing lost to SMS
truncation). `composeAgentResponse` emits lead and trail unconditionally but the options block only
when `slots.length > 0` (`response.ts:339-351`), so a single-shape empty case would ship "Here is
what I can move it to:" followed by nothing, then "Reply with the number…".

**Rejected.** A `{ kind: 'change'; from; to }` block — three renderer edits, and "→" is a non-GSM
character that flips an SMS body to the 737-character Unicode budget.

### 6.10 The anchor is resolved from the CRM when the thread has none; ambiguity hands off

**Decision.** `TurnContext.customer` is `Customer | null` (`capabilities.ts:63`), so the lookup is
guarded before it runs: a contact the CRM does not know resolves to `send_signup_link` — the first
branch of `decideReschedule`, exactly as `decideScheduling` does at `engine.ts:124-126` — and never
reaches a CRM query. There is no customer to look jobs up by, and the same asymmetry as everywhere
else applies: scheduling only ever moves a booking that belongs to a real CRM customer.

With a known customer, when `liveJob(thread.bookedJobId)` is null `handle` calls
`jobs.list({ accountId, customerId: customer.id, from: now, to: horizon, page, pageSize: 25 })` —
`ListJobsOptions.customerId` already exists (`repositories/types.ts:365`) and results are ordered by
`startAt` ascending. Exactly one live non-canceled upcoming job → that is the anchor, and a
successful move writes `bookedJobId` onto this channel's thread. Zero → `nothing_to_reschedule`. Two
or more → `reschedule_held { slot: null }` + `flagForReview`.

**It must page, not read one page.** `ListJobsOptions` carries a single optional `status`, so
"anything except `canceled`" cannot be expressed in the query — the liveness filter runs *after* it.
A customer whose next few upcoming rows are canceled (routine after a cancel-and-rebook, or a
serially-rescheduled job) would fill a single page with dead rows, and the resolver would conclude
"no anchor" while a real appointment stands. `nothing_to_reschedule` then offers openings, and a pick
**books a second job** — the precise §1.3 harm this section exists to prevent. So the loop keeps
paging until it has found **two** live jobs (enough to answer "ambiguous" without reading the rest)
or the result set is exhausted, with a `MAX_ANCHOR_PAGES` backstop mirroring `loadBusyIntervals`'s
`MAX_BUSY_PAGES` (`capabilities.ts:122`) — on which it raises `RetryDeliveryError` rather than
guessing from a partial view.

**Why.** §1.3 row 1 is the normal trades path — book on voice, text the change next morning. Without
this, that customer is told there is nothing on the calendar *and* offered openings whose pick
**books a second job**: failing in the one direction the whole design exists to avoid.

**Rejected.** Moving the most recently booked job when the customer has two — a guess with a truck
at the wrong house on the losing side.

### 6.11 Human and team interference retires the offer and becomes visible

**Decision.** Two writes, both in existing routes.

1. `POST /v1/conversations/:id/messages` and `POST /:id/approve` look the thread up with the
   existing `agentThreads.findByConversationId` and, when its state is `reschedule_offered` or
   `slots_offered`, patch `{ state: 'booked' | 'new', offeredSlots: [] }` — retiring the offer only,
   never `bookedJobId`.
2. `PATCH /v1/jobs/:id` (`routes/jobs.ts:190-210`), when `job.startAt !== before.startAt` — the same
   diff `notifier.jobUpdated` already computes — appends
   `{ author: 'note', body: 'The team moved <title> from <label> to <label>.' }` using the same
   `formatSlotLabel`, **and retires any standing move offer that targets this job**: find the
   thread(s) whose `bookedJobId` is this id and whose state is `reschedule_offered`, and patch
   `{ state: 'booked', offeredSlots: [] }`.

**Why.** (1) is a live hazard: a dispatcher replies "I've got you down for Friday at 10" and PATCHes
the job; the customer then texts "2"; reschedule still claims the turn, the pick resolves, and the
agent moves the job off the time the human just arranged — silently, with a confident confirmation.
Nothing in `conversations.ts` touches `agentThreads` today.

(2)'s note is parity this feature makes indefensible to skip: once the agent writes move notes, a
transcript that shows agent moves and hides team moves reads as a bug. **The offer retirement is the
other half of the same hazard** — a dispatcher who moves the job in the app *without* replying in
the inbox never triggers (1), so the standing offer survives and the customer's next "2" moves the
job off the dispatcher's chosen time. §1.3 names `routes/jobs.ts` "never touches `agentThreads`" as
part of the defect, so fixing only the note would leave the half that actually moves a job.

The retired thread stays `booked` with its `bookedJobId` intact, so the customer's "2" is still a
reschedule turn — it finds no standing offer and is answered with a fresh
`offer_reschedule_slots` computed against the job's new time. They lose one round trip and gain a
list that reflects reality.

Note the ordering consequence for the state machine: the "team moved J in the app, then '2'" row
(§5) now only describes a **stale** offer that predates the fix or a thread the lookup missed. The
job is still re-read every turn, so even then the confirmation names J's current time rather than a
fossilized one.

**Rejected.** Clearing `bookedJobId` too on a human reply (a human reply is not a cancellation).
Doing (2) inside `JobRepository.update` (would fire for seeds, imports and tests, and buries
transcript policy in persistence).

### 6.12 A reschedule hand-off is not knowledge's `hold_for_team`

**Decision.** The reschedule union carries its own `reschedule_held { slot: AgentSlot | null }`
rather than reusing `hold_for_team`.

**Why.** Goal 3 makes "every declined move says the booking still stands" a **correctness
property**, not a nicety — and `hold_for_team`'s copy (`response.ts:313-323`) is *"Good question — I
don't have that in front of me, so I've passed it to the team"*. It carries no slot, so it cannot
say it, and it also mischaracterizes what happened: the customer did not ask a question, they asked
to move an appointment. Reaching that wording through a reschedule path would leave someone who
asked to move a visit unsure whether they still have one — the single thing this design is most
careful about everywhere else.

The two hand-off paths differ in what they know, which is why `slot` is nullable: the > 8h job
(§3.9) has one identified booking to name, while the ambiguous CRM anchor (§6.10) has two and the
ambiguity is *which*. Both still assert that nothing moved. Both keep `flagForReview` and both take
`threadPatchFor`'s `{}` — a human owns the turn, and the scheduling state is not theirs to move.

### 6.13 A note on `notifier.jobUpdated`

`jobUpdated` notifies the **assignee** only, and `assigneeToNotify` returns null for an empty
`assignedUserId` (`notifications.ts:353-358`). Agent-booked jobs are created with
`assignedUserId: ''` (`capabilities.ts:270`), so for those the notification is a no-op today — the
call is still made so an agent move and a dispatcher move are indistinguishable, and so it starts
working the day agent bookings get auto-assigned. A **team-created** job moved by the agent (§1.3
row 1) usually *does* have an assignee, and that person is notified.

---

## 7. Customer-facing copy

Written to match the existing register in `response.ts` `contentFor`. `{Account}` is
`context.accountName`.

### 7.1 `reschedule` — the move landed

*Email / chat, same-day move:*

> You're moved!
> Appointment — now Thursday, August 6 at 4:00 PM (60 minutes), instead of 1:00 PM.
>
> Need to change or cancel? Reply here and the {Account} team will take care of it.

*Email / chat, across days:* second line becomes
`… now Friday, August 7 at 9:00 AM (60 minutes), instead of Thursday, August 6 at 1:00 PM.`

*Voice, same-day* (the day is named **once** — hearing the same date twice sounds like two
appointments):

> I've moved your Appointment on Thursday, August 6 from 1:00 PM to 4:00 PM. It's still 60 minutes.
> Need to change or cancel? Just call back and the {Account} team will take care of it.

*Voice, across days:* strict chronological from → to, both dates spelled out.

### 7.2 `reschedule_unavailable` / `reschedule_day_unavailable` — declined

The reason sentence is `reasonSentence` / `dayReasonSentence` **verbatim**; only the second and third
lines are move-specific.

> Unfortunately Thursday, August 6 at 4:00 PM was just taken.
> **I haven't moved anything — you're still booked for Thursday, August 6 at 1:00 PM.**
> Here is what I could move you to instead:
>
> 1. Thursday, August 6 at 2:00 PM
> 2. Friday, August 7 at 9:00 AM
> 3. Monday, August 10 at 11:00 AM
>
> Reply with the number you'd like to move to, or suggest another time.

With no alternatives, the third lead line and the options block are omitted and the trail is the
existing `noAlternativesTrail`.

### 7.3 `offer_reschedule_slots`

> Happy to move that. Right now you're booked for Thursday, August 6 at 1:00 PM.
> Here is what {Account} has open **instead**:
>
> 1. … 2. … 3. …
>
> Reply with the number you'd like to move to, or suggest another time.

Three redundant carriers of *"these are replacements"*: the booking is named in `lead[0]`, "instead"
ends `lead[1]` immediately before the list, and the trail says "move to". Day-scoped variant:
`… has open on Friday, August 7 instead:`.

*Empty shape* (no dangling "Here is what…", no "Reply with the number"):

> I couldn't find another opening to move your Thursday, August 6 at 1:00 PM appointment to.
> I haven't moved anything — you're still booked for Thursday, August 6 at 1:00 PM.
>
> I couldn't find another opening in the next two weeks — reply with a few times that work for you
> and I'll check them against {Account}'s calendar.

### 7.4 `reschedule_unchanged` — two shapes

| Shape | Lead |
|---|---|
| Requested **=** booked start | "That's the time you're already booked for — you're all set for Thursday, August 6 at 1:00 PM, so there's nothing for me to move." |
| Stand-down (`requestedStartAt: null`) | "Your appointment is still Thursday, August 6 at 1:00 PM — nothing has moved." |

Trail for the first: *"If you meant a different time, just reply with it and I'll move you."*
For the stand-down: the shared `changeOrCancelTrail`.

### 7.5 `nothing_to_reschedule`

> I don't see an upcoming appointment for you to move.
> If you booked another way, reply to this email and the {Account} team will sort it out.
> If you'd like a new one, here is what {Account} has open:
>
> 1. … 2. … 3. …
>
> Reply with the number that works for you, or suggest another time.

Note the trail is `pickAnOption`, **not** `pickAMove`: there is nothing to move, so these numbers
book a new visit. On voice, "the {Account} team can sort that out for you" — `replyHere('voice')`
returns "call back", the wrong instruction for someone already on the line (the same carve-out
`answer_question` and `greet` already make).

### 7.6 `reschedule_held` — a human owns the move

*With a known booking* (the > 8h job):

> I've passed this one to the {Account} team — they'll follow up shortly to get it moved.
> **Nothing has changed in the meantime: you're still booked for Thursday, August 6 at 1:00 PM.**

*Without one* (more than one upcoming job):

> It looks like you have more than one appointment with us, so I've passed this to the {Account}
> team rather than move the wrong one. They'll follow up shortly.
> **Nothing on your calendar has changed.**

Voice keeps both leads verbatim and takes the `hold_for_team` trail's shape: *"If there's anything
else in the meantime, just tell me."* Note what this deliberately does **not** reuse: knowledge's
"Good question — I don't have that in front of me" (`response.ts:313-323`), which would tell someone
who asked to move a visit that they asked a question, and would never say whether they still have an
appointment (§6.12).

### 7.7 Team-facing strings

| Where | Text |
|---|---|
| Transcript note, agent move | `Rivus moved Appointment from Thursday, August 6 at 1:00 PM to Thursday, August 6 at 4:00 PM.` |
| Transcript note, team move (§6.11) | `The team moved Appointment from Thursday, August 6 at 1:00 PM to Friday, August 7 at 10:00 AM.` |
| `flagForReview` — job too long | `A job longer than the business day cannot be moved by the agent.` |
| `flagForReview` — ambiguous anchor | `This customer asked to move an appointment but has more than one upcoming job.` |
| `logger.error` — restore failed | `agent reschedule left in place: restoring the job after a failed delivery did not succeed` |

---

## 8. Implementation phases

Each phase is independently shippable and ordered by dependency. Every phase must leave
`pnpm lint && pnpm type-check && pnpm test` green, with the coverage thresholds in
`packages/api/vitest.config.ts` (90 / 90 / 80 / 90) and `packages/core/vitest.config.ts`
(100 / 100 / 100 / 100) **met, never lowered**.

### Phase 1 — Shared seams (behavior-neutral)

Everything the feature needs from existing code, landed with **zero behavior change**, so the 547
lines of `agent-engine.test.ts` and the whole existing suite are the regression net.

- Split `AgentDecision` (the reschedule arm starts as just the shared `send_signup_link`); narrow
  `decideScheduling`; widen `propose_unavailable.requestedStartAt` to `IsoDateString`.
- Extract `slotObjection(slot, ctx)` and refactor `decideScheduling`'s proposal branch
  (`engine.ts:165-201`) onto it with byte-identical predicates in byte-identical order.
- Extract `liveJob` from `capabilities.ts:236-245` **without** dropping `schedulingCapability`'s
  `thread.state === 'booked'` gate.
- Add `standingOffer(thread)`; route `capabilities.ts:304` and `:361` through it; leave `:250`
  state-exact and commented.
- Add `jobId?: JobId` to `BusyInterval`; populate it in `loadBusyIntervals`.
- Add `formatTimeLabel` and `isSameZonedDay` to `slots.ts`; reimplement `formatSlotLabel`'s `time`
  local on top of `formatTimeLabel`.
- Widen `replyContextFor(ctx, overrides?)`.
- Add `endsConversation` to `CapabilityOutcome` / `InboundHandleResult`, backfill it on
  `book`/`confirm_existing`/`send_signup_link`, switch `runVoiceTurn` to it, **delete**
  `VOICE_TERMINAL_OUTCOMES`, and rewrite the now-stale dedupe comment at
  `agent-voice-shared.ts:150-157` to name the absolute-SET property instead.
- Separate commit, `fix(api): read curly apostrophes as negations` — fold `’‘` to `'` before
  `NEGATION` runs. `/\bdoesn'?t\b/` does not match the curly form every iOS and Gmail client
  produces; this strictly *widens* refusal, which is the safe direction, and every existing test
  uses straight quotes.

**Acceptance:** `formatSlotLabel` output byte-identical (the pinned email-template assertions pass
unchanged); assigning `{ kind: 'reschedule' }` to `decideScheduling`'s return is a compile error
(pinned with `@ts-expect-error`); `grep -r VOICE_TERMINAL_OUTCOMES` is empty and a booked voice call
still hangs up.

### Phase 2 — Deterministic reschedule parsing

`parse.ts` + `agent-parse.test.ts` only. No capability yet, so nothing changes in production
behavior.

**Acceptance:** `parseRescheduleRequest('can you reschedule that to 4pm instead?', …)` →
`{ intent: 'named_move', target: { kind: 'instant', startAt: '2026-08-06T23:00:00.000Z',
source: 'anchor_day' } }`. Both §1.2(c) messages target Friday 2:00 PM while raw
`parseProposedTime` still returns the anchor — asserted side by side with a comment naming the trap.
`namesRescheduleShape` is true for every row the request parser claims. `matchOfferedSlot`,
`parseSlotChoice`, `parseProposedTime`, `parseRequestedDay` and `isAcknowledgement` behavior is
unchanged.

### Phase 3 — Reschedule decisions, the pure engine, and the wording

`engine.ts` `decideReschedule` + `response.ts` `contentFor` cases + **`threadPatchFor`'s cases for
the new kinds** + `agent-reschedule-engine.test.ts` + response tests + 14 new matrix rows.

`threadPatchFor` belongs in **this** phase, not Phase 4, and the compiler decides that rather than
taste: it takes the wide `AgentDecision`, returns `UpdateAgentThread`, and switches with **no
`default`** (`capabilities.ts:153-189`). The moment Phase 3 widens the union, every new kind is a
missing return and the package stops type-checking. Deferring the cases would make Phase 3
un-shippable on its own, which is the one thing every phase here promises. The patches themselves
are trivial and depend on nothing in Phase 4 — the `'reschedule_offered'` **value** arrives with the
enum, so Phase 3's cases are written against it and Phase 4 is what makes them reachable.

**Acceptance:** every reschedule decision on every `ChannelMedium` composes to blocks whose `kind` is
one of greeting / paragraph / options / notice, `action` null, **no renderer file touched**. No
rendered reply contains a dangling "Here is what" with no options block, and no empty shape contains
"Reply with the number". Both `reschedule_held` shapes state that nothing moved. `reasonSentence`
still takes exactly four reasons and `propose_unavailable`/`day_unavailable` copy is byte-identical.
`decideReschedule` never returns a target it did not validate at `current.slot.durationMinutes`, and
never returns a target derived from the job's current position (§6.7).

### Phase 4 — Thread state across core, Mongo, and the app

The `reschedule_offered` ripple (§4.2) and the tester chip tokens. (`threadPatchFor`'s cases landed
in Phase 3 — see why there.)

**Acceptance:** `pnpm type-check` at the repo **root** passes — the app's `STATE_META` Record is the
compile error that proves the ripple was found. `packages/core` still meets 100/100/100/100.
`pnpm --filter @rivus/api openapi` produces an empty diff. No new inline colour literal.

### Phase 5 — The capability, `moveJob`, and the orchestrator: the feature goes live

`rescheduleCapability` (§6.1), the `moveJob` side effect and `rollbackEffects` (§6.7), the registry
line, `notifier.jobUpdated`, and the transcript note.

**Acceptance:** the transcript from §1.1 now moves the job — `outcome === 'reschedule'`,
`jobs.list` total is 1, `jobs[0].id === thread.bookedJobId`, new `startAt`, and
`status`/`customerId`/`title`/`address`/`durationMinutes` unchanged.
`defaultCapabilities().map(c => c.id)` equals `['reschedule','knowledge','scheduling']`, asserted by
a test — **order is the safety property**. `knowledgeCapability` still claims "is there a fee to
postpone?" on a `new` thread. A failed send leaves `job.startAt` original,
`thread.lastExternalMessageId` unchanged, and no `rivus`/`note` line appended; redelivering moves the
job exactly once. A caller who reschedules by phone hears the confirmation *and the goodbye*.

### Phase 6 — An anchor beyond the thread

The CRM lookup and the ambiguity hand-off (§6.10).

**Acceptance:** a customer who booked over email and texts "can you move it to 4pm?" as the same CRM
customer has the **same** job moved; afterwards the SMS thread's `bookedJobId` names it. Two upcoming
jobs → `reschedule_held`, exactly one `needs_attention`, neither job moves, and the reply says so. The extra `jobs.list` call
happens **only** when the thread's own anchor is absent or dead — and **never** for a contact the CRM
does not know, who gets `send_signup_link` with no lookup at all.

### Phase 7 — Interference, parity, and observability

The two writes in §6.11, plus the tester surface.

**Acceptance:** after a human replies in the inbox on a `reschedule_offered` thread, the customer's
next "2" does **not** move the job. A dispatcher reschedule writes exactly one `author: 'note'` line
worded like the agent's, retires any `reschedule_offered` offer targeting that job, and still raises
exactly one `jobUpdated` (no double-notify). Deleting a
tester session leaves `jobs.list` total at its pre-session value. The tester shows "Reschedule
offered" as a visually distinct chip. **No route gains a repository method** —
`findByConversationId` already exists.

---

## 9. Test inventory

Per `AGENTS.md`, tests are an inventory of failure modes. The two ways this feature can hurt a
customer are **moving a booking nobody asked to move** and **leaving the calendar and the customer
disagreeing about when the visit is**.

### 9.1 New files

| File | Covers |
|---|---|
| `test/agent-reschedule-engine.test.ts` | the pure `decideReschedule`, mirroring `agent-engine.test.ts:17-32`'s `decide()` wrapper — including `offeredSlots` and `customerKnown`, since picking is policy |
| `test/agent-reschedule.test.ts` | the capability + orchestrator end to end against in-memory repos, harness cloned from `agent-knowledge.test.ts` and widened to `inbound(text, { externalMessageId?, now? })` |

### 9.2 The failure-mode list

**Parsing (`agent-parse.test.ts`).** A ~21-row CLAIMS table and a ~29-row REFUSES table
(cancellations, policy questions, physical-object moves — "can you move the fridge to the garage?",
"we're moving house" — fractions and measurements, unit and street numbers, sign-offs,
acknowledgements, greetings, second-booking asks, plain FAQs). Each refusal is *structural* (missing
referent, missing temporal companion), not a blocklist entry. The §1.2(c) regression asserted side by
side with raw `parseProposedTime`. Refusal to guess: "can we do 2 or 3?", "can we move it to
Thursday?" on a Thursday booking, "push it out a week", "move it to the 4th" → `unspecified`. Bare
digits are never clocks. Bounds off the anchor's **real** duration (a 120-minute booking, "anything
later that day?" → `earliest = anchorMinute + 120`). Curly-apostrophe negation.

**Engine (`agent-reschedule-engine.test.ts`).** The transcript case. The self-exclusion **pair**:
"move my 1pm to 1:30" → `reschedule`; the same input with the booking left in `busy` →
`reschedule_unavailable:taken`. Exclusion is by **id, not value** — a co-located second job at the
same start still yields `taken`. A 90-minute job keeps 90 minutes in the target *and every
alternative*; 481 minutes → `reschedule_held` naming the booking; 480 still produces a 9:00 AM target. Each reason arm,
with `outside_hours` beating `taken` for a 3 AM target. `reschedule_unchanged` on an **identical**
start — paired with the case that pins the boundary: a 60-minute 1:00 PM job plus "move my 1pm to
1:30" is a `reschedule`, not an `unchanged`, and a 120-minute 1:00 PM job plus "push it to 2pm" is
too. Stand-down. Picking a listed alternative, including a pick since taken and a pick now past.
**`MIN_NOTICE` parity, both halves**: a same-day named time inside the window → `reschedule`
(comment citing `agent-engine.test.ts`'s "books a same-day proposal"), while every *offered*
alternative satisfies `now + MIN_NOTICE_MINUTES`. The current window is never offered back. DST:
spring-forward and fall-back crossings pinned to exact instants — with a comment recording that a
*bare-time anchor* can never straddle a US transition (the anchor day is the booked day, and
bookings are Mon–Fri per `slots.ts:160-162`), so the DST risk lives on the explicit-day path. A
garbage account zone resolves through `safeTimeZone` without throwing.

**Capability + orchestrator (`agent-reschedule.test.ts`).** Moving in place, with every unchanged
field asserted. The transcript tail `['customer','rivus','note']`. The two-turn flow (offer → state
`reschedule_offered`, job **unmoved**; "2" → one job at `offeredSlots[1].startAt`). Divergence (the
follow-up names its own day and time → the same job moves). Back-out. Stale offer with the clock
advanced. Four delegation cases — no booking / canceled / already past / row deleted — each →
`offer_slots`, no throw. Status allowlist: `in_progress` and `completed` decline. **The negative
corpus**, asserting `job.startAt` identical, `jobCount` 1, thread state / `offeredSlots` /
`bookedJobId` identical, **and** that the outcome is none of the four reschedule kinds — the last
clause is what catches a capability that wrongly *claims* the turn and silently arms the next "2".
Registry order. Rollback, rollback-of-the-rollback (the **original** send error surfaces), and the
deleted-job race. Dedupe. Notification: assigned job → exactly one "A job was rescheduled" with
`linkHref: '/schedule'`; unassigned → zero (§6.12). Cross-channel and ambiguity (Phase 6).
Interference (Phase 7).

**Wording (`agent-response.test.ts`).** The byte-parity pin that does not exist today: `book`'s trail
asserted literally on email, chat and voice **before** the `changeOrCancelTrail` extraction. The
identical trail for `reschedule`. Both sides named, same-day and across days. Voice speaks strict
from → to with the day named once, says "It's still 60 minutes", and does **not** contain "You're
moved!". Every decline contains the reassurance sentence and "Here is what I could move you to
instead:" and **not** "Here is what we do have open:". Move offers use "you'd like to move to";
`nothing_to_reschedule` uses "that works for you". The stand-down shape never contains "That's the
time you're already booked for". Empty shapes contain no options block and no "Reply with the
number". Both hand-off shapes of `reschedule_held` say the booking is untouched — the one with a
slot names it. A move crossing New Year spells the year out.

**Matrix (`agent-response-matrix.test.ts`).** 14 new `DECISIONS` rows × 4 channels, plus
`decisionLabel` arms so variants do not collide, plus **a new exhaustiveness guard** —
`Record<AgentDecision['kind'], true>` built from the kinds present — so the next new kind fails the
build rather than silently skipping every channel. No SMS reschedule rendering contains the
truncation ellipsis.

**Knowledge (`agent-knowledge.test.ts`).** `knowledgeCapability.matches` returns **false** for "2",
"can you do the second one?" and "the 2pm one works" on a `reschedule_offered` thread — proving
`standingOffer` populates its guard there. Without it, `parseSlotChoice` short-circuits on an empty
list and a question-shaped pick would be answered with an FAQ while the booking stays put. An FAQ
asked mid-reschedule re-lists the same slots in the same order and the following "2" still **moves**.
The policy-question guard is a scoping, not a blanket decline.

**Option inquiries (`agent-reschedule.test.ts`, and the reason §3.6's guard exists).** On a
`reschedule_offered` thread, each of "is option 2 in the morning?", "what time is slot 1?", "how long
is option 3?" and "which one is on Friday?" must leave `job.startAt` **byte-identical**, keep the
thread `reschedule_offered`, keep `offeredSlots` in the same order, and re-list them. Paired against
the acceptances that must still move the job: "can we do the second one?", "option 2 works",
"let's do option 2", "I'll take slot 3". `parseSlotChoice` matches every one of these eight, so the
pair is the only thing standing between a question and a moved appointment.

**Regression pins.** `agent-question.test.ts` pins today's `isInformationalQuestion` results for the
§1.2(b) table, so a future loosening of `SCHEDULING_VOCABULARY` cannot change capability ordering
silently. `agent-engine.test.ts` keeps all 547 lines and gains the `@ts-expect-error` narrowing
assertion.

**Routes and surfaces.** `agent-email-route.test.ts` (book → reschedule end to end; "Can we
reschedule?" → "1"; `"don't move it, that time is fine"` → not a move; a `FlakyMailer` undoing the
move; an exact redelivery ignored; a **team-created** job moved by a reschedule email).
`agent-voice-plivo-route.test.ts` (terminal XML via `endsConversation`; the same speech posted twice
moves the job once — and, because voice is the channel with dedupe off, the same assertion for
"push it back an hour", which must offer windows rather than shift anything, §6.7).
`jobs.test.ts`: a `PATCH` changing `startAt` appends exactly one "The team moved" note, **retires a
`reschedule_offered` thread targeting that job** (state `booked`, `offeredSlots` `[]`), leaves a
`slots_offered` thread that does *not* target it alone, and still raises exactly one `jobUpdated`; a
title-only `PATCH` writes no note and retires nothing; a `PATCH` on a job with no agent thread does
not throw. Plus `agent-tester.test.ts`, `conversations.test.ts`, `agent-threads-repo.test.ts`,
`agent-slots.test.ts`, `packages/core/src/schemas.test.ts`, `packages/app/src/api/client.test.ts`.

### 9.3 Coverage risk

The easiest branches to leave uncovered are the ones with no happy path: `rollbackEffects`'s
restore-failed arm, the `jobs.update → null` (deleted mid-turn) arm, the > 8h `reschedule_held`
short-circuit, and each empty-`alternatives` copy shape. All four are named as explicit cases above
rather than left to incidental coverage.

---

## 10. Open decisions for the team

1. **"Can we move it to Friday?" — propose the booked time of day on the new day, or always offer
   that day's openings?** The plan prefers the anchor's own hour when free, falling back to
   `computeOpenSlotsOnDay`: "same appointment, different day" is literally what was asked and it
   needs no second turn. The cost is that the agent proposes a specific time the customer never
   typed.
2. **Should `nothing_to_reschedule` ever `flagForReview`?** A customer insisting they have an
   appointment the agent cannot see is a genuine mismatch. Flagging every occurrence would page the
   team on every expired booking; flagging only when the message names a specific time might be the
   right narrowing. The plan flags nothing here.
3. **The exact `skyInk` / `skyTint` values for the tester chip.** Sky is `#1ebefa` and Soft sky is
   `#eef8ff` (`DESIGN_SYSTEM.md`), but there is no documented ink/tint pair and the ink must hold
   4.5:1 on the tint for small text. Design owns the two hex values.
4. **The three deferred vocabularies — bare hours ("make it 4"), spelled-out hours ("four pm"), and
   relative shifts ("push it back an hour").** Each is deferred for a *different* reason, and only
   the third has a known unlock. Bare hours want an explicit
   `state === 'booked' && offeredSlots.length === 0` gate plus their own adversarial table (street
   numbers, unit numbers, counts, durations, fractions, ordinals). Spelled-out hours are a
   voice-transcription question. Relative shifts are blocked on **idempotency**, not on parsing
   (§6.7): the arithmetic is easy and unambiguous, but a re-derived shift walks the booking forward
   on every replay. They unlock the moment a turn's resolved target survives the write — either a
   thread field holding the last processed turn, or a real per-utterance `externalMessageId` on
   voice, which would also retire the stale comment at `agent-voice-shared.ts:150-157`. Whether
   that is worth a field (or a channel change) for one phrasing is the call; note the phrasing is
   *answered* either way, just in two turns.
5. **Does a moved job keep its `JobStatus`?** The agent books with `status: 'confirmed'`
   (`capabilities.ts:274`) and the move writes no status, so a confirmed job stays confirmed.
   Arguably a customer-initiated move should return it to `scheduled`. The plan keeps `confirmed`,
   partly because writing status would make `jobUpdated`'s cancellation branch reachable from an
   agent turn.
6. **Should the agent's initial booking also call `notifier.jobCreated`?** Today it does not, so
   after this change the move path notifies while the create path stays silent. Currently invisible
   (§6.12), but it becomes visible the day agent bookings get auto-assigned. Out of scope; worth a
   follow-up.
7. **Compare-and-set on `JobRepository.update`.** The seam is
   `update(accountId, id, input, expected?: { startAt })`: Mongo adds `startAt` to the
   `findOneAndUpdate` filter, memory compares before writing, both return null on mismatch, and the
   orchestrator's null branch already exists. It would also fix the rollback clobbering a concurrent
   human edit. **If it lands, it should land on the `book` path in the same change**, or the two
   paths keep different consistency stories.
8. **Should a job's imminence ever block a move?** Today nothing does: a job starting in 45 minutes
   is movable. Refusing frustrates the running-late customer; allowing means the agent can move a job
   a tech is already driving to. A `startAt - now < 2h` → `flagForReview` (move **and** page the
   team) is the cheapest middle.
9. **Does `nothing_to_reschedule` deserve alternatives at all**, or should a customer who believes
   they have an appointment be handed to a human rather than offered a fresh booking? Switching drops
   one lead line and the options block; no renderer change either way.
10. **After a dispatcher's app-only move retires a standing offer (§6.11), should the customer be
    told?** The plan retires silently: their next message gets a fresh list computed against the new
    time, which is correct but unexplained — they picked "2" from a list that no longer exists and
    get different options back. The alternative is a proactive outbound ("the team moved you to
    Friday at 10 — still want to change it?"), which is the first thing in this design that would
    make the agent *initiate* rather than reply, with all the consent and rate questions that opens.
    Recommend shipping the silent retirement and revisiting if the inbox shows confusion.
11. **How should the tester warn staff that a reschedule test moves a real job on a shared demo
    account and pings its assignee?** The tester drives the real orchestrator against real
    repositories by design (`tester.ts:11-18`). This is pre-existing for `book`, but a move is more
    consequential. One line of UI copy is the cheapest answer — and it is the only user-facing pixel
    this plan adds beyond the state chip.

---

## 11. References

- `AGENTS.md` — the capability/channel layering the whole design rests on
- `DESIGN_SYSTEM.md` — the token source for the tester chip (§4.2, §10.3)
- `packages/api/src/services/agent/` — `engine.ts`, `capabilities.ts`, `orchestrator.ts`,
  `parse.ts`, `question.ts`, `slots.ts`, `response.ts`
- `packages/api/test/agent-response-matrix.test.ts` — the channels × decisions invariant
- `A2P_10DLC_PLAN.md`, `WHATSAPP_SENDER_PLAN.md` — sibling plans in this format
