# Rivus Design System

The reusable visual language behind the Rivus business-management agent — tokens,
type, and components shared across every screen.

> **v1 · Living document.** This is the single source of truth for Rivus' visual
> design. Every user-facing surface (`@rivus/website`, `@rivus/app`,
> `@rivus/docs`, and any marketing/email/UI artifact) must use these tokens and
> components rather than inventing new colors, type sizes, or one-off styles. The
> original interactive reference is preserved alongside this file as
> [`Rivus-Design-System.mhtml`](./Rivus-Design-System.mhtml) — open it in a
> browser to see the live components.

When a value you need is missing here, add it to this document (and the shared
theme) instead of hard-coding a new literal in a component.

---

## Color

### Brand

| Token         | Value                          | Notes                                  |
| ------------- | ------------------------------ | -------------------------------------- |
| Rivus gradient | `#1ebefa → #6e1ec8`           | The signature element (see Gradient)   |
| Sky           | `#1ebefa`                      | Gradient start                         |
| Violet        | `#6e1ec8`                      | Gradient end / accent                  |
| Ink           | `#101019`                      | Darkest brand neutral                  |

### Surfaces

| Token          | Value      | Use                                         |
| -------------- | ---------- | ------------------------------------------- |
| App background | `#f6f7fb`  | Default page background                     |
| Card           | `#ffffff`  | Cards, sheets, raised surfaces              |
| Briefing dark  | `#13131f`  | Dark "briefing" surfaces (gradient base)    |
| Hairline       | `#e9eaf0`  | 1px borders, dividers, separators           |
| Switch track   | `#d9dbe6`  | Off-state fill of the Switch control        |

### Status

| Token       | Value      | Use                                                  |
| ----------- | ---------- | ---------------------------------------------------- |
| Success     | `#1fb573`  | Paid, positive, online                               |
| Success ink | `#0e7a4f`  | Success-colored **small text** (holds 4.5:1 on white/tints) |
| Warning     | `#f0a020`  | Pending, attention                                   |
| Danger      | `#f0584b`  | Overdue, errors, destructive                         |
| Accent      | `#6e1ec8`  | Quotes, highlights (violet)                          |

### Marketing tints

Soft, near-white washes of the brand colors used on the marketing site for
hero/header backgrounds and icon chips — never for text or interactive states.

| Token       | Value      | Use                                                    |
| ----------- | ---------- | ------------------------------------------------------ |
| Soft violet | `#f0eaff`  | Hero/page-header wash, step numerals, violet icon tiles |
| Soft sky    | `#eef8ff`  | Hero/page-header wash (paired with Soft violet)         |

### Text

| Token    | Value      | Use                                   |
| -------- | ---------- | ------------------------------------- |
| Primary  | `#16161f`  | Default body and headings             |
| Sub      | `#8a8b99`  | Secondary text                        |
| Muted    | `#9a9bb0`  | Tertiary / supporting text            |
| Disabled | `#b6b8c4`  | Disabled controls and placeholder     |

---

## Typography · Montserrat

The single typeface is **Montserrat** (`font-family: Montserrat, sans-serif`).
Weights in use: **400 / 500 / 600**.

| Style   | Size     | Weight | Letter-spacing | Example use                          |
| ------- | -------- | ------ | -------------- | ------------------------------------ |
| Display | `30px`   | 600    | `-0.02em`      | "Good morning, Marcus"               |
| Heading | `20px`   | 600    | —              | Section titles ("Schedule")          |
| Subhead | `15px`   | 600    | —              | "Today's schedule"                   |
| Body    | `13.5px` | 400    | —              | Paragraph / default copy             |
| Label   | `12px`   | 600    | `0.06em`       | Uppercase labels ("CONVERSATIONS")   |
| Caption | `11.5px` | 500    | —              | Supporting captions                  |

Uppercase eyebrows/labels use wider tracking (`0.06em`–`0.1em`). Large display
text uses tight tracking (`-0.02em`).

---

## Signature gradient

```css
linear-gradient(135deg, #1ebefa, #6e1ec8)
```

The **one** signature element. Reserve it for Rivus-the-agent: primary buttons,
the symbol tile, AI status, active nav, and the **on** state of a Switch that
puts Rivus live on a channel (that is AI status). **Never** use it as a page or
card background, and never on destructive actions (see Buttons → Danger).

Supporting gradients:

- **Briefing dark surface:** `linear-gradient(120deg, #13131f, #1b1530)` — dark
  banners (e.g. the "while you were away" briefing).
- **Soft accent tint:** `linear-gradient(135deg, rgba(30,190,250,0.12), rgba(110,30,200,0.12))`
  — subtle brand-tinted fills behind icons/checks.
- **Brand glow (dark surfaces only):** large blurred orbs of Sky (`#1ebefa`)
  and Violet (`#6e1ec8`) — blur ≥ 80px, opacity ≤ 0.35, at most one orb of
  each color — floated behind content on a dark surface. This is the ambient
  treatment behind the marketing hero and final-CTA bands and the social-share
  (Open Graph) card; the blended in-between pixels it produces are a result of
  the treatment, not new palette values. Never on light surfaces, and never as
  a substitute for the signature gradient.

---

## Radius

| Token            | Value      | Use                  |
| ---------------- | ---------- | -------------------- |
| Controls         | `8px`      | Small controls       |
| Buttons / inputs | `10–11px`  | Buttons, inputs      |
| Cards            | `14px`     | Cards, sheets        |
| Pills            | `999px`    | Pills, avatars, dots |

---

## Elevation & focus

- Cards sit on `#f6f7fb` with a `1px` `#e9eaf0` hairline; keep shadows subtle.
- Status focus glow (success): `box-shadow: 0 0 0 3px rgba(31,181,115,0.18)`.

---

## Layout & breakpoints

The app shell is responsive around a single breakpoint.

| Token                 | Value   | Use                                                                                          |
| --------------------- | ------- | -------------------------------------------------------------------------------------------- |
| Sidebar breakpoint    | `880px` | At/above, the persistent left sidebar shows; below, the mobile layout with a bottom tab bar   |
| Sidebar width         | `244px` | Width of the persistent left sidebar                                                          |
| Mobile tab bar height | `56px`  | Height of the bottom tab bar, excluding the safe-area inset padded below it                   |

In the shared theme these are `SIDEBAR_BREAKPOINT`, `SIDEBAR_WIDTH`, and
`MOBILE_TABBAR_HEIGHT`. The tab bar has no fixed height (it grows with larger
text settings), so surfaces that anchor to it should measure the rendered bar
rather than assume the constant.

The marketing site (`packages/website`) is a top bar, not a sidebar. Its
primary nav (Why Rivus · Features · Setup · Pricing · FAQ, plus Sign in and
Get started) collapses to the hamburger at **`900px`** — the same breakpoint
the home hero stacks — so tablet widths never clip the fifth link.

---

## Components

These are the shared, reusable building blocks. Match their structure and props
when implementing per platform.

### BriefingBanner

The agent's "while you were away" summary. Dark briefing surface.

- **Props:** `eyebrow` · `message` · `ctaLabel`
- Example: _"While you were away — Rivus handled 38 conversations, booked 6 jobs,
  and answered 19 questions overnight. Two items need a human eye."_

### RivusPill

AI status pill for the agent's state.

- **Props:** `label` · `variant(dot | check)`
- Examples: "Rivus is handling" (dot),
  "Rivus auto-scheduled 6 jobs" (check)

### StatusBadge

Compact status label for business records.

- **Props:** `label` · `tone(paid | due | quote | lead | neutral)`
- Examples: "Paid up" (paid), "Balance due" (due), "Quote pending" (quote),
  "New lead" (lead), "Reminder sent" (neutral)

### MetricCard

A single dashboard metric.

- **Props:** `label` · `value` · `delta` · `tone(positive | neutral)` · `sub`
- Examples:
  - "Conversations today" · `38` · `+12%` · "34 handled by Rivus"
  - "Jobs booked" · `6` · "today" · "$4,200 pipeline value"
  - "Avg. response time" · `12s` · "Was 4h before Rivus"
  - "Open invoices" · `$8,140` · "5 invoices · QuickBooks"

### Avatar

- **Props:** `initials` · `imageUrl` (optional) · `size`
- Circular (`999px`). Shows `imageUrl` when given (e.g. a user's Gravatar);
  falls back to 2-letter initials (e.g. "MT", "PA") when there's no image, or
  it fails to load.

### Buttons

- **Primary:** uses the signature gradient at `11px` radius.
- **Secondary:** white with a `1px` hairline (`#e9eaf0`) border. Takes a
  **danger tone** (Danger-red text and a red-tinted hairline) for the
  low-emphasis entry into a destructive flow ("Cancel account").
- **Danger:** solid Danger red (`#f0584b`, hover `#d2503f`) with white text —
  the destructive confirm itself ("Yes, cancel account"). Destructive actions
  **never** wear the signature gradient.
- All buttons stay **inline** — there is no shared button design component;
  build per platform using these recipes.

**States** (all variants): `loading` swaps the icon slot for a small inline
spinner and ignores presses (label may switch to the progressive form, e.g.
"Saving…"); `disabled` renders at 50% opacity; hover (web) lifts primary/danger
slightly and tints secondary with the soft field color; pressed dims to 85%
opacity. Buttons announce `disabled`/`busy` state to assistive tech.

### Switch

Boolean on/off control for live settings that apply immediately (e.g. switching
a messaging channel on) — form choices between options stay a segmented control.

- **Props:** `value` · `onValueChange` · `busy` · `disabled` · `accessibilityLabel`
- **Geometry:** `46×26px` pill track with a `2px` inset, `22px` white thumb
  (soft shadow) that slides `20px`; thumb and track crossfade over ~160ms.
- **Off:** Switch-track fill (`#d9dbe6`). **On:** the signature gradient —
  allowed because flipping one on puts Rivus-the-agent live (AI status).
- **Busy:** a small violet spinner rides inside the thumb while the change is
  in flight (e.g. a number provisioning) and presses are ignored — never a
  detached spinner beside the control. **Disabled:** 50% opacity.
- Announces as a switch with `checked`/`disabled`/`busy` state; pair it with a
  visible "On"/"Off" text echo where color alone would carry the state.

### PageHero (marketing)

The light header band every marketing subpage opens with, on the shared
hero wash (see Marketing tints).

- **Props:** `eyebrow` · `title` · `lead` · `actions` (optional CTA row) ·
  `children` (optional extra content, e.g. a stat band)

### Stat band (marketing)

A row of headline numbers under a page hero — white cards on the hairline
border, values in Accent violet.

- **Data:** `value` · `label` (e.g. "24/7" · "on every channel")

### Chip (marketing)

Compact availability tag on cards (e.g. platform cards on /apps).

- **Variants:** `live` (Success-ink text on a success tint, e.g. "Available
  now") · `soon` (Accent violet on Soft violet, e.g. "Coming soon")

### FAQ item (marketing)

A native `<details>` disclosure used on /faq, and (trimmed) under the pricing
grid:

- **`faq-list`** — the stack: 780px max width, centered, 12px gaps.
- **`faq-item`** — a Surface card, Line border, 12px radius, `4px 22px`
  padding. The `[open]` state rotates the marker.
- **`faq-item__q`** — the `<summary>`: 600-weight 15.5px row with a "+"
  marker (Text-sub color) that rotates 45° when open; native markers hidden.
- **`faq-item__a`** — the answer: 15px/1.65 body-2 text, 18px bottom padding.
- **`price-faq` / `price-faq__eyebrow` / `price-faq__more`** — the
  pricing-section wrapper for the owner-objection teasers (34px top
  margin): five disclosures (cost, per-call fees, keeping the number,
  on-brand voice, human takeover), a centered `OWNERS ASK` eyebrow, and a
  wrapping "more" row of `card__link`s (full FAQ + compare).

The hero trust bar's trade names are links styled by **`trust__link`**
(inherit color, 700 weight, underline on hover) — visually identical to the
previous bold run, now navigable.

### Compare table (marketing)

The alternatives table on /compare, wrapped in **`compare-wrap`**
(`overflow-x: auto`) so wide content scrolls inside its own container:

- **`compare`** — full-width, 760px min-width, collapsed borders, 14.5px
  text; every cell gets `14px 16px` padding and a Line bottom border.
- **`compare__name` / `compare__summary`** — column header: 700-weight name
  over a 12.5px Text-sub summary line.
- **`compare--rivus`** — the Rivus column's cells wear the documented
  **Soft accent tint** gradient (never the signature gradient).
- Row headers (`tbody th`) are 600-weight; body cells use body-2 text.

### Press asset card (marketing)

A standard `card` presenting a downloadable brand asset on /press:

- **`press-asset__preview`** — the asset preview image: block, 56px tall,
  width auto (capped at 100%), 16px below-margin before the card title.
- **`press-asset__files`** — the download-link row under the body: wrapping
  flex of `card__link`s with a 6px × 18px gap, 12px top margin.

### Navigation

The primary app navigation adapts to width (see **Layout & breakpoints**):

- **Wide (≥ 880px):** a persistent left **sidebar** lists every destination; the
  active item is marked with the signature gradient.
- **Narrow (< 880px):** a fixed **bottom tab bar** — the mobile convention. The
  primary destinations sit on the bar as icon-over-label tabs; the remaining
  destinations fold into a **"More"** tab that opens a sheet (which also holds
  sign-out). The active tab uses a gradient indicator with a violet icon + label.

Active nav is one of the few places the signature gradient is allowed (see
**Signature gradient**).

---

## Using this system

- **Reach for tokens, not literals.** Use the color/type/radius tokens above; do
  not introduce new hex values or font sizes ad hoc.
- **One gradient, one job.** The signature gradient marks Rivus-the-agent only.
- **Montserrat everywhere.** All text is Montserrat in weights 400/500/600.
- **Reuse components.** Prefer the components above; if a screen needs something
  new, add it here first so every surface stays consistent.
