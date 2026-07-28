# Website content audit & fill-in plan

An audit of the marketing site (`packages/website`) for missing content —
pages that don't exist, CTAs that point at nothing, content that exists in the
repo but is never surfaced, and the standard marketing/SEO surfaces the site
still lacks — followed by a phased plan to fill the gaps.

Audited on 2026-07-28 against `main`. Method: every route in
`src/app/`, every marketing component, every `href` on the site, the sitemap,
metadata exports, and cross-references from the other packages (`app`, `api`,
`core`, `docs`) to `rivus.ai`.

## What is already complete (no action needed)

The site is in good shape overall; this audit found no lorem ipsum, no empty
sections, and no dead internal links between existing pages.

- **Home page** — all nine sections render real, finished copy from
  `src/lib/site.ts` (hero, problem, how-it-works, features, onboarding,
  cross-platform, testimonials, pricing, final CTA).
- **Company pages** — `/about`, `/careers`, `/contact`, `/apps` are complete,
  data-driven from `src/lib/company.ts`, each with its own `metadata`.
  (Careers' "Nothing posted right now" is a deliberate, well-written empty
  state, not a gap.)
- **Legal suite** — `/privacy`, `/terms`, `/security`, `/sms-terms`,
  `/sms-opt-in`, `/acceptable-use` are unusually thorough, including the
  carrier-compliance copy shared with the app via `@rivus/core`
  (`SMS_CONSENT_DISCLOSURE` et al.) and guarded by tests.
- **Utility surfaces** — the per-business `/customers/join/[slug]` flow, the
  `/admin` console, `robots.txt`, and `sitemap.xml` all work; nav, footer, and
  legal cross-links all resolve, and the sitemap test proves every internal
  footer/nav link has a route.

## Where the missing content is

### P0 — CTAs that point at content that does not exist

1. **"Book a demo" goes to a dead URL.** Both demo buttons link to
   `${appUrl}/demo`, but the Expo app has no `demo` route
   (`packages/app/app/` has `login`, `signup`, `accept-invite`, … — no
   `demo.tsx`). On production this lands on app.rivus.ai's unmatched-route
   screen. Affected surfaces:
   - `src/app/contact/page.tsx:26` (contact hero primary button)
   - `src/components/marketing/final-cta.tsx:32` (rendered on **home** and
     **about** via `FinalCta`)

   The demo-booking experience itself is the missing content: nothing anywhere
   in the monorepo implements one.

### P1 — content that exists in the repo but the site never surfaces

2. **The docs site is invisible.** `docs.rivus.ai` (`packages/docs`, Docula)
   ships real content — getting started, architecture, an interactive API
   reference from the OpenAPI spec, and a changelog — but no page on the
   marketing site links to it. The footer has Product / Company / Legal
   columns and no Resources column. (Adjacent bug found on the way:
   `packages/docs/site/docula.config.ts` sets `siteUrl: 'https://rivus.org'`,
   which is not the deployed domain.)
3. **Press has no home.** `/contact` invites press inquiries and the repo
   carries a full brand kit (`branding/` — master logos in EPS/PNG/SVG plus
   `Rivus-Guidelines-1.0.pdf`), but none of it is downloadable from the site.
4. **The changelog never reaches customers.** `packages/docs/site/changelog/`
   exists but nothing on the marketing site mentions what's new or links to it.

### P1 — standard marketing pages that don't exist yet

5. **No FAQ anywhere.** The product's headline feature is answering FAQs, yet
   the site itself has none — no FAQ page, and no pricing FAQ under the plans
   (the usual "What counts as a location?", "Do I keep my phone number?",
   "What happens after free setup?", "Can I cancel anytime?"). This is also
   the easiest structured-data win (FAQPage JSON-LD).
6. **No industry pages.** The hero trust bar promises "Built for plumbers ·
   HVAC · electricians · salons · clinics · landscapers" and the about page
   repeats the list, but there is no landing page for any of them. These
   pages are the canonical SEO/conversion surface for this product category
   ("AI answering service for plumbers"), and today the named audiences have
   nowhere targeted to land.
7. **No customer stories.** Testimonials exist only as three homepage cards
   with initials. There is no case-study page, and nothing substantiates the
   trust bar's "4.8 from 1,200+ owners" claim (no reviews page, no source
   link).

### P0/P1 — site plumbing content (SEO & system pages)

8. **No social-share image.** `layout.tsx` sets Open Graph text but there is
   no `opengraph-image` / `twitter-image` file anywhere under `src/app/`, so
   every share of every page renders text-only. `metadataBase` is also unset,
   so relative OG URLs couldn't resolve anyway (Next warns at build).
9. **No custom 404 or error page.** `src/app/` has no `not-found.tsx` and no
   `error.tsx`; visitors who mistype a URL get Next's unbranded default with
   no path back to the site.
10. **No structured data at all.** No JSON-LD on any page (Organization,
    WebSite, SoftwareApplication with offers matching the three pricing
    tiers, FAQPage once FAQs exist).
11. **Minor meta gaps** — no canonical URLs (`www` and apex both serve), no
    `lastModified` in the sitemap, no web manifest / apple-touch icon.

### Decision-gated — content that exists but needs substantiation

12. **Marketing claims aren't backed yet.** The trust bar ("4.8 from 1,200+
    owners"), the three testimonials (note "Cascade Plumbing & Heating" is
    also the fixture business in the API tests), "Rivus answered in 11s", and
    "11 jobs the first weekend" read as real metrics/customers. If they are
    aspirational placeholders, they need real numbers, honest interim copy,
    or removal before production traffic — this is truth-in-advertising
    exposure, not just polish.
13. **Counsel review of the legal suite is an open task by its own
    admission.** `src/lib/legal.ts` says: "These are starting-point policies…
    have counsel review them before relying on them in production."
14. **No physical mailing address on `/contact`** — only "Seattle,
    Washington." A2P brand vetting cross-checks the business footprint, and
    the newsletter product implies CAN-SPAM's physical-address requirement.
    One line of content once the address is settled.

## The plan

Ordered so each phase is a shippable PR; every phase keeps
`pnpm lint && pnpm type-check && pnpm test` green.

### House rules for all new content (repo conventions)

- Copy lives as typed data in `src/lib/` (like `site.ts` / `company.ts` /
  `legal.ts`); pages stay declarative and tests iterate the same arrays.
- Visuals use `DESIGN_SYSTEM.md` tokens and existing components (`PageHero`,
  `card`, `tile`, `section` primitives) — no ad-hoc styles.
- Every new route: `metadata` export, entry in `publicRoutes`
  (`src/app/sitemap.ts`) so the sitemap tests keep proving link integrity,
  plus a render test following `info-pages.test.tsx`.
- New external links get the same treatment as `appUrl` (env-aware, absolute).

### Phase 1 — stop the bleeding (P0, ~1 PR)

1. **Build `/demo` on the website** (recommended over adding an app route:
   demo requests are a marketing concern, and the website already has form
   plumbing in `CustomerJoin` to model from).
   - New `src/app/demo/page.tsx`: `PageHero` + a short request form (name,
     business, phone, email, trade) posting to the API
     (`POST /v1/leads/demo` — small new route on the existing Fastify app,
     in-memory + mongo repos, surfaced in the admin console's onboarding
     queue) with a `mailto:sales@rivus.ai` fallback link.
   - Repoint both dead CTAs (`contact/page.tsx`, `final-cta.tsx`) to `/demo`.
   - Add to `publicRoutes`; tests for the form's success/failure states
     (mocked `fetch`, per the testing philosophy).
   - Interim option if the API route should wait: ship the page with the
     mailto CTA only — still strictly better than a 404.
2. **Share images + `metadataBase`** — add `metadataBase: new URL(baseUrl)`
   and a branded 1200×630 `opengraph-image` (Next `ImageResponse` or a static
   export from the brand kit; gradient reserved for the Rivus mark per the
   design system).
3. **Custom `not-found.tsx`** (+ minimal `error.tsx`) — on-brand, links home
   and to `/contact`.

### Phase 2 — surface what already exists (P1, ~1 PR)

4. **Footer "Resources" column** in `footerColumns`: Docs
   (`https://docs.rivus.ai`), API reference (`https://docs.rivus.ai/api`),
   Changelog, System status (the footer already renders live API status —
   link it). The sitemap link-integrity test already skips external links.
5. **Press & brand page** (`/press`): boilerplate description, the stats the
   site already claims, downloadable logo pack + guidelines PDF (move the
   needed exports from `branding/` into `public/press/`), press contact.
   Link from the footer Company column and from the contact page's press card.
6. **Fix `packages/docs` `siteUrl`** to `https://docs.rivus.ai` so its
   canonical/sitemap output is right before we point traffic at it.

### Phase 3 — FAQ + industries (P1, 1–2 PRs)

7. **FAQ page** (`/faq`) with a data model in `src/lib/faq.ts`
   (`{ question, answer, category }`): plans & billing, setup & onboarding,
   channels & phone numbers, the AI and human handoff, security/data. Render
   grouped with the existing card/section primitives; add a trimmed
   "Pricing questions" strip under the pricing grid linking to `/faq`;
   emit FAQPage JSON-LD from the same array. Footer Product column gains
   "FAQ".
8. **Industry pages** (`/industries/[slug]`) — one template, six data entries
   in `src/lib/industries.ts` (plumbers, HVAC, electricians, salons, clinics,
   landscapers): trade-specific hero ("Never miss another emergency call"),
   the 2–3 most resonant problems from `problems` re-angled, a
   channel/outcome example conversation (reuse the hero phone visual with
   per-trade copy), testimonial slot, pricing pointer, FinalCta. Add
   `generateStaticParams`, per-page metadata, sitemap entries, and link the
   trust-bar trade names to their pages.

### Phase 4 — proof and freshness (P2, decision-gated)

9. **Claims pass (business decision, do before real launch traffic):**
   replace or substantiate the trust-bar rating, owner count, and
   testimonials. Honest interim alternatives: "Founding customers get free
   white-glove onboarding", real pilot quotes with permission, or drop the
   numbers row. Same pass adds the physical address to `/contact` and
   schedules counsel review of `legal.ts` (its own header asks for it).
10. **Customer stories** (`/customers`) once 2–3 real customers agree:
    story template (before/after, numbers, quote) in `src/lib/stories.ts`;
    homepage testimonials link into it. Until then the homepage cards stay.
11. **What's new** — link the docs changelog from the footer now (done in
    Phase 2); consider a `/changelog` redirect to docs rather than a page.

### Phase 5 — ongoing growth content (P3, optional backlog)

12. **Blog/resources** — highest-leverage home is the Docula site (it already
    builds markdown); add a "Guides" section there and link it from the
    Resources column, rather than bolting MDX onto Next.
13. **Comparison pages** (`/compare/answering-services`, etc.) once
    positioning is settled.
14. **Apps page waitlist** — an email-capture on the "Coming soon" iPhone /
    Android cards (reuses the demo-lead API route with a `source` field), and
    app-store badges when the native apps ship.
15. **Meta polish** — canonicals via `alternates.canonical` per page,
    `lastModified` in the sitemap, web manifest + apple-touch icon.

## Suggested sequencing & effort

| Phase | Contents | Effort | Depends on |
| ----- | -------------------------------------- | ------ | ------------------------ |
| 1 | /demo + CTAs, OG image, 404 | S–M | — |
| 2 | Resources links, /press, docs siteUrl | S | brand-kit file selection |
| 3 | /faq (+ pricing strip), 6 industry pages | M | copy review |
| 4 | claims pass, /customers, address | M | real customers, counsel |
| 5 | guides, compare, waitlist, meta polish | M–L | positioning |

Phases 1–3 are pure engineering + copywriting and can ship this week;
phase 4 is where business input gates the work.
