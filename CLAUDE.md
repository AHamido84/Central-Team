@AGENTS.md

# CLAUDE.md — Central Team Platform

> Persistent memory for every contributor (human or AI). Read this first, keep it current.
> If a rule here conflicts with code, the rule wins until this file is updated in the same PR.

## 1. Vision

One platform for the **central team of a marketing agency in Saudi Arabia**, combining
operations & task management, a client portal, CRM, advertising-campaign analytics,
integrations & automation with social/ad platforms, and AI marketing intelligence.

It is a product the agency pays for and shows to its clients. Quality bar: polished,
secure, tested. **No placeholder screens and no "TODO later" inside delivered scope.**

Two sides, one codebase, one auth:

- **Agency app** — used by the agency's team (internal operations).
- **Client portal** — used by the agency's clients (requests, approvals, reports).

Built single-agency first, but **multi-tenant ready**: every tenant-scoped row carries
`organization_id` so the platform can become a multi-agency SaaS without a rewrite.

## 2. Phases

| Phase | Scope | Status |
|---|---|---|
| 0 — Foundation | Infra, auth, users, roles & permissions, AR/EN (RTL/LTR), design system, notifications infra | **Done** |
| 1 — Client Portal | Portal shell, home, files, messages, agency-side client management | **Done** |
| 2 — Requests | Request types + form builder, portal wizard, lifecycle, triage inbox, client dashboard, event dispatcher | **Done** |
| 3 — Tasks & Deliverables | Workflow templates, tasks (board/list/table/calendar/My Work), deliverables & versions, internal review, client approvals with annotations, content calendar | **Done** |
| 4 — Campaigns | Campaigns, channels & KPI targets, daily metrics (entry + CSV import), analytics with pacing/health, client reports (snapshots, print/PDF, schedules), portal campaigns & reports | **Done** |
| 5 — Agency Operations | Ops dashboard across clients, Client 360 with client health, team workload views, SLA policies (business hours, holidays, pause on client) with breach alerts, SLA monitor | **Done** |
| 6 — CRM & Capacity | Leads (manual, CSV, public form, webhook; dedup/merge; assignment rules), pipelines & deals, quotes, won → client, follow-ups, sales dashboard, capacity planning with simulator | **Done** |
| 7 — Integrations & Automation | Provider interface + sandbox, connections with Vault tokens (Meta, WhatsApp, TikTok, Snapchat, Google), daily metric sync, signed lead-ad webhooks, WhatsApp notifications and lead messages, automation engine with builder, dry run and run log | **Done** |
| 8 — AI Intelligence | AI analysis, recommendations, reports, assistant | **Next** |

Current state & gotchas: `docs/HANDOFF.md` (read first in a new session). Details: `docs/ROADMAP.md`. Architecture: `docs/ARCHITECTURE.md`. Data: `docs/DATA_MODEL.md`.
UI: `docs/UI.md`. Decisions: `docs/DECISIONS.md` (append-only, numbered).

## 3. Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router, React 19, Server Components, Server Actions), TypeScript `strict` |
| Styling | Tailwind CSS v4, shadcn/ui (Radix), lucide-react, Framer Motion (subtle only) |
| Backend | Supabase: Postgres, Auth, Storage, Realtime, Edge Functions |
| DB access | Drizzle ORM + drizzle-kit migrations (output to `supabase/migrations`) |
| Security | RLS on **every** table; Postgres permission functions are the source of truth |
| Validation / forms | Zod v4, React Hook Form |
| Data fetching | Server Components first; TanStack Query for client-side/realtime state; TanStack Table |
| i18n | next-intl (Arabic default, English), cookie-based locale, no URL prefix |
| Email | App emails: React Email + `EmailProvider` → Resend (prod), SMTP/Mailpit (local), Console (test). Auth emails: GoTrue bilingual templates (ADR-017) |
| Tests | Vitest (unit + DB/RLS integration), Playwright (E2E) |
| Tooling | pnpm, ESLint (flat config), Prettier, Husky + lint-staged, commitlint (Conventional Commits) |
| Deploy | Vercel on a **custom domain** + Supabase Cloud. Never rely on `*.pages.dev` / `*.netlify.app` (blocked on the owner's network). |

## 4. Commands

```bash
pnpm install            # install deps (Node 22, pnpm 10)
cp .env.example .env.local   # then paste keys from `supabase status -o env`
pnpm db:start           # start local Supabase (Docker)
pnpm db:reset           # drop + migrate + seed (1 agency, 12 staff incl. a sales manager and rep, 5 Saudi clients, files, threads, request types + requests, workflows, ~320 tasks, deliverables at every review stage, campaigns with ~90 days of metrics, reports, SLA policies, holidays and a breach log, leads, deals in every stage, quotes, capacity settings, sandbox integrations with synced numbers, WhatsApp templates and automations)
pnpm dev                # Next.js dev server on http://localhost:3000
pnpm db:generate        # drizzle-kit: generate SQL migration from schema changes
pnpm lint               # ESLint (incl. RTL logical-properties rule and no hardcoded JSX text)
pnpm typecheck          # tsc --noEmit (message keys are type-checked)
pnpm i18n:check         # ar/en keys + ICU placeholders in sync
pnpm test               # Vitest unit tests
pnpm test:db            # RLS / DB tests against the seeded local DB (run after db:reset)
pnpm test:e2e           # Playwright (starts `pnpm dev` if not running; reads Mailpit)
pnpm check              # lint + typecheck + i18n + unit
pnpm email:dev          # React Email preview server
```

Sandbox note: if Playwright's bundled browser is unavailable, set `PW_CHROMIUM_PATH=/path/to/chromium`.
Seed accounts all use password `Passw0rd!` (see the table in `README.md`).

Local mail (magic links, invites, resets) is caught by Mailpit: http://localhost:54324.

## 5. Module structure

Feature code lives in `src/modules/<module>/`. `src/app/` only wires routes to modules.

```
src/modules/<module>/
  components/      # React components for this module (client or server)
  server/          # 'server-only': queries.ts, actions.ts (Server Actions), services
  db/schema.ts     # Drizzle tables owned by this module
  schemas.ts       # Zod schemas shared by forms + actions
  permissions.ts   # permission keys this module declares (resource:action)
  events.ts        # domain event types this module emits (typed payloads)
  constants.ts     # enums, labels keys, small shared config
```

Translations live in `messages/<locale>/<namespace>.json` (one namespace per module or area; Arabic is the key source
of truth for types). Add a namespace to `src/i18n/messages.ts` and `src/i18n/types.ts`.

Rules:
- Modules may import each other's `server/*`, `components/*`, `constants`, `types` — never another module's `db/`
  (tables come from `@/lib/db/schema`; ESLint-enforced).
- `'use server'` files export only async functions (actions); constants go in `constants.ts`.
- Shared primitives: `src/components/ui` (shadcn), `src/components/*` (app-level composites),
  `src/lib/*` (auth, db, i18n, email, events, flags, permissions, utils).
- Server-only code imports `server-only`. Never import `src/lib/db` into a client component.

## 6. Conventions

- **Naming**: files `kebab-case.ts(x)`; components `PascalCase`; DB tables/columns `snake_case`, plural tables;
  permission keys `resource:action` (lowercase, snake_case resource), e.g. `users:invite`, `roles:update`.
  Event types `resource.past_tense_verb`, e.g. `user.invited`, `role.permissions_updated`.
- **IDs**: `uuid` (v7 generated in app where ordering matters, `gen_random_uuid()` default otherwise).
- **Timestamps**: `timestamptz`, stored UTC, displayed in the user's timezone (default `Asia/Riyadh`).
- **Money**: integer minor units (halalas) + `currency` char(3), default `SAR`.
- **Localized DB content** (org-defined names like roles, departments): `jsonb` `{ "ar": "...", "en": "..." }`
  typed as `LocalizedText`; render with `localized(value, locale)` which falls back to the other language.
- **Mutations** go through `defineAction()` (see ARCHITECTURE §5): Zod-validate → authenticate →
  `can()` check → RLS-scoped transaction → `emitEvent()` → typed `Result`. No raw Server Actions.
- **Side effects of events** (notifications, automations) are consumers in `src/lib/events/consumers.ts`, never
  inline in actions (ADR-027/028). Consumers must be idempotent.
- **Reads** in Server Components go through module `server/queries.ts` using the RLS-scoped DB (`withRls`).
- **Service-role access** (`supabaseAdmin`, `dbAdmin`) is allowed only in these server paths: invitation preview/
  acceptance, the domain-event dispatcher and its consumers (incl. `notify()` fan-out), signed storage URLs issued after an RLS-checked lookup, the rate limiter, the reminder sweeps
  (`runReminderSweep`, `runCampaignSweep`, `runSlaSweep`, `runCrmSweep`, cron), public lead intake (`ingestLead` from the
  website form, the lead webhook and platform lead ads — no session exists), integration token storage in Vault, platform
  calls with their bookkeeping (sync, discovery, webhook processing, WhatsApp sends) and the automation engine (ADR-067/071),
  and the seed. Every use needs a comment why.
- **Errors**: actions return `{ ok: true, data } | { ok: false, error: { code, message?, fieldErrors? } }`;
  error `code`s are translated in the UI. Never leak DB error text to users.
- **Commits**: Conventional Commits (`feat(auth): …`, `fix(rbac): …`, `docs: …`). One logical change per commit.
- **Comments**: explain *why*, not *what*. English in code and comments.

## 7. i18n & RTL rules

- Arabic (`ar`) is the default locale and direction is RTL; English (`en`) is LTR.
- Locale resolution: user profile `locale` → `NEXT_LOCALE` cookie → `Accept-Language` → `ar`.
- **Zero hardcoded user-facing strings.** Every string comes from `messages/`. ESLint rule + a test that
  asserts `ar` and `en` key sets are identical.
- `<html lang dir>` is set server-side. Never compute direction on the client.
- **CSS logical properties only**: `ms-*/me-*`, `ps-*/pe-*`, `start-*/end-*`, `text-start/end`,
  `border-s/e`, `rounded-s/e`. Physical `ml/mr/pl/pr/left/right/text-left/text-right` are lint errors.
- Directional icons (chevrons, arrows, "back", "send") use the `<DirIcon>` wrapper or `rtl:-scale-x-100`.
  Non-directional icons (search, bell, settings) are never mirrored.
- Numbers, dates, currency: always via `useFormatter()` / `getFormatter()` (next-intl) with the app presets:
  - Arabic formats use `ar-SA` with **Latin digits and Gregorian calendar** by default (`nu-latn`, `ca-gregory`);
    Hijri display is an opt-in user preference. (Plain `ar-SA` in `Intl` defaults to the Islamic calendar — never use it raw.)
  - Currency default `SAR`. Week starts **Sunday**; weekend Fri–Sat. Timezone default `Asia/Riyadh`.
- Mixed-direction content (emails, URLs, phone numbers, code) is wrapped in `<bdi>` / `dir="ltr"`.
- Every screen is verified in: AR/EN × light/dark × mobile/desktop.

## 8. Security rules

1. **RLS enabled on every table**, including lookup tables. A migration that creates a table without
   RLS + policies fails CI (`test:db` asserts it).
2. **The database is the source of truth for authorization.** `app.has_permission()` in Postgres decides;
   the TS `can()` mirrors it for UI and early rejection only, and is computed from the same DB data.
3. App DB queries run as role `authenticated` with the user's JWT claims (`withRls`). Service role is the
   exception and is audited (see §6).
4. Every tenant-scoped table has `organization_id uuid not null` and its policies check membership.
5. Agency vs client **side separation** is enforced three times: proxy (routing), layout guard (server),
   and RLS (data). Client users never see agency-only data even if they craft requests.
6. Secrets only in env vars; `NEXT_PUBLIC_*` never contains secrets. `.env*` is gitignored; `.env.example` documents keys.
7. Tokens (invitations, etc.) are random 32 bytes, stored **hashed** (SHA-256), single-use, with expiry.
8. Validate all input with Zod on the server, even if the client validated.
9. Audit: every mutation on audited tables writes `activity_log` (trigger, with before/after) and
   important mutations emit a `domain_events` row in the same transaction.
10. Security headers (CSP, HSTS, frame-ancestors none, referrer policy) set in `next.config`/proxy.
11. Rate-limit auth-adjacent endpoints (login, magic link, invite accept, reset).
12. Uploaded files: private `client-files` bucket, server-chosen paths, one-time signed upload URLs, signed download URLs
    issued only for rows the caller can SELECT, MIME/size validation. Avatars/logos use the public `public-assets`
    bucket with UUID paths (images only, no SVG) — ADR-020.
13. Internal agency data never reaches client users: `visibility` columns + agency-only tables, enforced by RLS and
    covered by `tests/db/rls-portal.test.ts`.

## 9. Definition of Done (applies to every phase and every PR)

A feature is done only when **all** are true:

- [ ] Works end to end against a real local Supabase (no mocks in the running app).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm test:e2e` all green.
- [ ] New tables: RLS enabled, policies written, RLS tests cover allow **and** deny cases.
- [ ] New permissions are seeded, appear in the permission matrix, and are enforced by RLS.
- [ ] Every string translated in `ar` and `en`; screen checked in RTL and LTR.
- [ ] Light and dark mode; mobile (≥360px) and desktop layouts.
- [ ] Loading (skeleton), empty, and error states designed — no blank screens.
- [ ] Keyboard accessible, visible focus, labels on inputs, color contrast ≥ WCAG AA.
- [ ] Important mutations emit domain events; audited tables record before/after.
- [ ] No `TODO`/`FIXME` inside delivered scope; no `console.log`; no `any` without a justification comment.
- [ ] `CLAUDE.md` and relevant `docs/` updated; decision logged in `docs/DECISIONS.md` if one was made.
- [ ] `docs/ROADMAP.md` checkboxes updated.

### Phase 0 exit criteria

- [ ] App runs locally; lint, typecheck, tests all green.
- [ ] Login / invite / onboarding / reset work end to end.
- [ ] Roles & permission matrix editable from UI and enforced by RLS.
- [ ] Every screen works in AR/EN, RTL/LTR, light/dark, mobile/desktop.
- [ ] Design system page (`/dev/design-system`) complete.
- [ ] `CLAUDE.md` and `docs/` up to date.

## 10. Working agreements for AI sessions

- Start by reading this file, `docs/HANDOFF.md` and `docs/ROADMAP.md`; run `pnpm setup`; continue from the first unchecked item.
- Build only the current phase. Design for later phases (schema shape, extension points) but don't build them.
- Prefer adding to an existing module over creating a new one; create a module when a new domain appears.
- When you make a non-obvious choice, append it to `docs/DECISIONS.md`.
- Before ending a session: run `pnpm check`, update ROADMAP checkboxes, commit with Conventional Commits.
