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

### Status

| Token   | Value      | Use                          |
| ------- | ---------- | ---------------------------- |
| Success | `#1fb573`  | Paid, positive, online       |
| Warning | `#f0a020`  | Pending, attention           |
| Danger  | `#f0584b`  | Overdue, errors, destructive |
| Accent  | `#6e1ec8`  | Quotes, highlights (violet)  |

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
the symbol tile, AI status, active nav. **Never** use it as a page or card
background.

Supporting gradients:

- **Briefing dark surface:** `linear-gradient(120deg, #13131f, #1b1530)` — dark
  banners (e.g. the "while you were away" briefing).
- **Soft accent tint:** `linear-gradient(135deg, rgba(30,190,250,0.12), rgba(110,30,200,0.12))`
  — subtle brand-tinted fills behind icons/checks.

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
- Examples: "Rivus is online" (dot), "Rivus is handling" (dot),
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

- **Props:** `initials` · `size`
- Circular (`999px`), shows 2-letter initials (e.g. "MT", "PA").

### Buttons

- **Primary:** uses the signature gradient at `11px` radius.
- **Secondary:** white with a `1px` hairline (`#e9eaf0`) border.
- Both stay **inline** — there is no shared button design component; build per
  platform using these recipes.

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
