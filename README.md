# Momentum Landscaping

One codebase for the public site surface, customer portal, and operations CRM for
Momentum Landscaping (Salt Lake County), plus Wayne — the single AI agent that
handles lead conversations, scheduling, and operations over SMS.

## Stack
- Next.js 14 (App Router, TypeScript, Tailwind)
- Supabase (Postgres + RLS, project `izthjluendxpthmcndlv`)
- Anthropic Claude (Wayne agent)
- Pingram (interim SMS provider — architecture is provider-agnostic; swapping to
  Twilio changes only `PINGRAM_*` env vars and the inbound webhook URL)
- Meta Pixel + Conversions API (event_id-deduped)

## Layout
- `app/(marketing)` — quote form; domain root is served by the separate Claude
  Design project (`momentum-site`), never this repo
- `app/legal/*` — 8 compliance pages
- `app/api/*` — leads intake, SMS in/out, Wayne, CAPI, crons, flow tester, health
- `lib/` — supabase clients, sms (single outbound door), meta CAPI, wayne agent,
  availability, automation audit logging

## Env
See `.env.example`. All secrets live in the Corpus HQ credentials registry.

## Rules encoded here
- Every automated action writes to `automation_runs`
- All outbound SMS goes through `lib/sms.ts` (opt-out + quiet hours enforced once)
- Wayne never invents prices/dates; bookings only via `book_job`
- Test rows are `source='test'` and excluded from nudges/stats
- Service area is the `zones` table (`active = true`) and nothing else. Any
  customer-facing city list comes from `activeServiceCities()` in `lib/zones.ts`
  — never hand-write one. County-level prose ("Salt Lake County") is the only
  allowed exception, because zones carries no county column.
