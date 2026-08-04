# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The CRM is a responsive Next.js web app at `crm.momentumlandscapingut.com`. The crew
"app" is a native iOS shell (`com.momentumlandscapingut.crew`) that loads that same
CRM in a webview — it adds only what a browser cannot do: background location, an
offline ping queue, geofence wake, and push. **There are no native screens.** Every
visual change ships over the air to both web and phone; only GPS behavior, icon,
splash, and permissions require a rebuild. Android is not built and not planned.

## Users

**Internal — three staff, all trusted full-access operators:**

- **Connor** — strategy and technology
- **Kayden** — client relations
- **Terik** — field operations

One CRM, role-gated. Owner and manager see everything; the `crew` role sees only
Today, Schedule, and Wayne. **Crew must never reach money screens** — this is
enforced server-side (`requireStaff(["owner"])` on the money and accounting pages,
`staffFromSession(["owner"])` on their API routes), not merely hidden from nav.

Crew work is done one-handed, outdoors, in gloves, on a phone. Mobile-first is a
usage fact, not a preference. Desktop is the owner's view.

**Customers** — homeowners in the south Salt Lake County band on recurring weekly
lawn subscriptions. **Customers never see the CRM.** They have exactly two surfaces:
the portal at `portal.momentumlandscapingut.com` and SMS.

## Product Purpose

One codebase running the operations CRM, the customer portal, the lead-intake quote
form, and Wayne — the single AI agent that handles lead conversations, scheduling,
and operations over SMS. The business sells recurring weekly lawn subscriptions;
the software exists to convert inbound leads fast, prove that service actually
happened, and keep a three-person team off the phone.

**Speed to lead is the single most important metric.**

## Positioning

Three mechanisms a neighboring lawn company could not truthfully copy:

1. **Wayne answers in seconds, over SMS, without a human.** Public site form →
   `/api/leads` → Wayne replies conversationally within seconds → in-person quote
   visit booked → service agreement.
2. **Service is GPS-verified against surveyed parcel geometry**, not a crew member's
   word: real county parcel polygons with an interior pin, dwell-based visit
   open/close, and a standing exception monitor.
3. **Pricing is a visit, not a number.** Every property is quoted in person. No price
   is ever published, spoken over text, or estimated.

## Operating Context

**Lead flow:** public site form → `/api/leads` → Wayne (SMS concierge) replies within
seconds → in-person personal quote visit → service agreement.

**Surfaces:** the domain root is served by a separate project (`momentum-site`), never
this repo; `app/page.tsx` here is a placeholder that only appears on the vercel.app
URL. This repo owns the CRM, the portal, `/quote`, the legal pages, and the APIs.

**GPS verification of service:** surveyed parcel polygon with an interior pin; 10
minutes of dwell opens a visit; 10 minutes away or 400m closes it; 8 minutes minimum
to count as service. A 9-check monitor raises exceptions every 20 minutes.

**Season:** April 1 – November 15. Off-season inquiries are logged and reopened at
season start, never turned away.

**Quiet hours:** outbound SMS is blocked outside 8am–9pm.

## Capabilities and Constraints

### Service area — the `zones` table is the only truth

Serviceability is `zones.active = true`. Every prose statement of the service area
must be **regenerated from that table, never hand-written**.

**ACTIVE — Salt Lake County only, 7 zones, 15 city/community entries** (several are
communities rather than incorporated cities — Suncrest, Daybreak, Rosecrest, White
City, and the unincorporated township of Copperton — but residents identify by them
and zone resolution matches on them, so they belong in any customer-facing list):

| Zone | Cities |
|---|---|
| 6 | Draper, Bluffdale, Suncrest |
| 7 | South Jordan, Riverton, Daybreak |
| 8 | Herriman, Rosecrest |
| 9 | Sandy, Granite, Cottonwood Heights |
| 10 | West Jordan |
| 11 | Midvale, White City |
| 12 | Copperton (unincorporated township) |

**DEACTIVATED 2026-08-01 — all of Utah County** (zones 1–5: Lehi, Saratoga Springs,
Eagle Mountain, American Fork, Pleasant Grove). Reason on every row: *"Utah County,
outside south SL band."*

**How surfaces read it.** `activeServiceCities()` in `lib/zones.ts` is the only
sanctioned source of a customer-facing city list; the quote form and Wayne's system
prompt both read it live, so deactivating a zone removes it from both on the next
request with no deploy. Hand-writing a city list anywhere is a regression.

County-level prose ("Salt Lake County") is the one allowed exception, used in the
SMS HELP auto-reply, page metadata, and footers where enumerating 15 entries is
impractical. It is a hand-maintained cache: the `zones` table carries no county
column, so **a move into a new county is the one change that still requires a manual
copy sweep.** Adding a `county` column would close that gap.

*Resolved 2026-08-03:* eight surfaces advertised the just-deactivated Utah County
area — `README.md`, root layout metadata, `app/page.tsx`, the SMS HELP reply,
`lib/wayne.ts`, `CITY_OPTIONS` in the quote form, the legal footer, and the CRM login
footer. All corrected; the two lead-intake paths are now data-driven.

The 5 Orem properties in the database are throwaway GPS test stops, not clients. Orem
was never a service area.

### Customer-facing language — hard rules

- **No price, rate, or dollar figure appears anywhere customer-facing.** Ever. Not
  estimated, not hinted, not confirmed when a customer names a number.
- Quotes are **always in person** and are **always called "personal quotes"** — never
  "free", never "custom".
- **No arrival time windows** are promised in customer copy. Confirm the day only.
- Never promise a quote delivered by phone or text; the visit *is* the quote.

### Encoded system rules

- All outbound SMS goes through `lib/sms.ts` — the single outbound door; opt-out and
  quiet hours are enforced there, once.
- Every automated action writes a row to `automation_runs`.
- Bookings only happen via the `book_job` tool. Wayne never says "you're booked"
  without a successful call.
- Rows with `source='test'` are excluded from nudges and stats.
- **Gold is reserved for wins only** — Closed Won and Paid. This is a semantic rule
  about what a color *means* in the operations surface (enforced today by
  `STAGE_STYLE` and `INVOICE_STYLE`), and it survives any repaint of the system.
- The SMS provider is architecturally swappable; Pingram is interim. Moving to Twilio
  changes only `PINGRAM_*` env vars and the inbound webhook URL.
- Wayne must never invent dates, availability, or prices.

## Brand Commitments

- **Momentum Landscaping.** Logo assets: `public/logo.png`, `public/logo-mark.png`.
- **Wayne** is the named, single, customer-facing AI agent. One agent, not a suite.
- **Utah AI safe-harbor self-identification is binding:** if a customer asks whether
  Wayne is an AI, a bot, or a person, Wayne answers truthfully that it is Momentum's
  AI assistant. It never claims to be human. An AI disclosure page is published at
  `/legal/ai-disclosure`.
- **Wayne's voice:** friendly, brief, Utah-neighborly. Uses the customer's first name.
  One question per message. Short — this is SMS: no markdown, no walls of text. An
  occasional 🌱 is on-brand; not more than that.
- **"Personal quote"** is fixed product vocabulary, not a phrasing choice.

## Evidence on Hand

**Real:**

- Brand marks: `public/logo.png`, `public/logo-mark.png`
- Eight published compliance pages under `app/legal/*` (terms, privacy, privacy
  choices, cookies, SMS terms, AI disclosure, cancellation/refund, accessibility)
- County parcel records backing address autocomplete — leads land on surveyed
  properties, not free-text guesses, so geofencing can match them later
- Live production data: leads, jobs, GPS-verified visits, invoices

**Absences future work must not fabricate:**

- **No prices, rates, tiers, or dollar figures exist to publish.** There is no price
  list. Inventing one violates a hard rule.
- No testimonials, reviews, case studies, press mentions, or awards.
- No customer counts, revenue figures, job volumes, or performance benchmarks.
- No arrival-time guarantees, response-time guarantees, or service-level claims.

## Product Principles

1. **Speed to lead is the metric.** Every surface is judged by the seconds between a
   form submit and a reply that feels like a person answered.
2. **Price is never spoken.** The in-person personal quote visit is the pricing
   mechanism; the software's job is to book it, not to approximate it.
3. **Serviceability is data, not prose.** The zones table decides where Momentum
   works; any sentence that restates it is a cache that will go stale and cost money.
4. **Crew screens are field instruments.** One-handed, outdoors, in gloves, in
   sunlight. Density and cleverness lose to reach and legibility.
5. **Service is proven, not claimed.** GPS verification against real parcel geometry,
   and an audit row for every automated action.

## Accessibility & Inclusion

**WCAG 2.1 Level AA is a published public commitment**, not an aspiration — stated at
`/legal/accessibility` for both the website and the customer portal: semantic
headings, sufficient color contrast, keyboard-navigable forms, and labeled inputs.
A human fallback is promised: anyone can reach a person by text or email instead.

Field conditions are an inclusion constraint in their own right: crew UI must survive
direct sunlight, gloved hands, and one-handed use on a phone.
