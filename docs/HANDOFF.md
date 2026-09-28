# Handoff — state of the project

Last updated: 2026-09-28 · Branch: `claude/stoic-cray-wud1ib` · Read with `CLAUDE.md` (rules) and `docs/ROADMAP.md` (next work).

## Where we are

| Phase | Status |
|---|---|
| 0 — Foundation | **Built.** Auth (password, magic link, reset, email change), invitations, onboarding, RBAC with permission matrix + overrides, departments, feature flags, audit log, notifications, design system, AR/EN RTL/LTR, light/dark |
| 1 — Client Portal | **Built.** Agency client management (clients, portal users, packages + usage ledger, files, messages inbox) and the client portal (home, files, messages, company settings, flag-guarded Requests/Approvals/Calendar) |
| 2 — Requests | **Built (revision 2).** Request types with a no-code form builder (12 field types, conditions, drag & drop, live preview), portal wizard with drafts and package quota check, per-client references, DB-enforced lifecycle with reasons, triage inbox + preview drawer with SLA states, package consumption on accept, client dashboard (stats, usage chart, activity), notifications via the event dispatcher |
| 3 — Tasks & Deliverables | **Next.** Start with "convert request → tasks" (the `requests` row is the parent) |

Verified green on a fresh seed: `pnpm lint`, `pnpm typecheck`, `pnpm i18n:check`, 66 unit tests, 68 DB tests
(RLS + dispatcher), 16 Playwright e2e tests, `pnpm build`. The CI workflow (`.github/workflows/ci.yml`) is written but has not run on GitHub yet.

## Run it

```bash
bash scripts/bootstrap.sh     # deps, Docker, local Supabase, .env.local, migrations + seed
pnpm dev                      # http://localhost:3000 — every seed password is Passw0rd!
```

Key accounts: `sara@ofoq.test` (Super Admin), `faisal@ofoq.test` (Admin), `noura@ofoq.test` (Account Manager),
`khalid@ofoq.test` (Specialist), `mohammed@najd.test` (Client Owner), `abeer@najd.test` (Client Member),
`saad@najd.test` (Client Viewer). Full table in `README.md`.

## How the code is organized (quick map)

- `supabase/migrations/` — `…183222_initial_schema.sql` (drizzle-kit generated from `src/**/db/schema.ts`),
  `…183300_app_functions.sql` (permission functions, guards/triggers, audit, auth hook),
  `…183400_rls_policies.sql`, `…183500_reference_data.sql` (permission catalog, flags, `app.bootstrap_organization`, buckets).
  New tables: edit Drizzle schema → `pnpm db:generate` → add a hand-written SQL migration for RLS/triggers.
- `src/lib/` — `db/rls.ts` (`withRls`), `actions/define-action.ts` (every mutation), `auth/context.ts`
  (`requireAgency` / `requirePortal`), `events/`, `email/`, `i18n/`, `storage.ts`, `permissions/`.
- `src/modules/<module>/` — `db/schema.ts`, `server/{queries,actions}.ts`, `components/`, `constants.ts`.
- `messages/{ar,en}/<namespace>.json` — typed keys (Arabic is the source of truth); `pnpm i18n:check` enforces parity.
- Tests: `tests/unit`, `tests/db` (RLS as each persona, rolled back), `e2e/` (Playwright + Mailpit).

## Gotchas learned the hard way

1. **Realtime**: call `ensureRealtimeAuth()` before subscribing, or the join is validated as `anon` and rejected (ADR-024).
2. **`'use server'` files** may export only async functions — put constants in `constants.ts`.
3. **SQL subqueries in Drizzle `select`** must reference the outer table literally (`threads.id`), not `${threads.id}`
   (which renders unqualified and becomes ambiguous).
4. **Policies with subqueries** must qualify outer columns (`packages.id`), or they bind to the inner table.
5. **Mixed-direction text**: wrap names/files in `<bdi>` or use `t.rich` with `<b>`; quoted placeholders in messages
   use Unicode isolates (U+2068/U+2069).
6. **Tests depend on seed data**: run `pnpm db:reset` before `pnpm test:db`; e2e creates unique users and is re-runnable.
7. Sandboxes may block ghcr/ECR image pulls — `bootstrap.sh` falls back to Docker Hub.
8. **Constants used by Server Components can't live in `'use client'` files** — they become client references
   (e.g. `inboxViews.includes is not a function`). Put them in the module's `constants.ts`.
9. **Grid children with truncated text need `min-w-0`** (and `grid-cols-1` on mobile), or the column grows to the
   text's full width and the page scrolls sideways.
10. **Request lifecycle is trigger-enforced**: service-role writes (seed) are trusted; user writes get server-owned
    timestamps, numbering and transition checks. Updates made inside another trigger count as `system`.
11. **Notifications only come from event consumers** (`src/lib/events/consumers.ts`). In tests/scripts outside a request,
    `scheduleEventDispatch()` runs the dispatcher detached.
12. **`request_attachments` has no UPDATE grant** — sync attachments with delete + insert, never `ON CONFLICT DO UPDATE`.
13. **Status reasons** travel as `set_config('app.transition_reason', …, true)` inside the same transaction as the update.
14. Dev-only: the Next.js dev indicator ("N" bubble) overlaps the bottom-left of mobile screenshots; it is not in builds.

## Open items (need the owner)

- Answers to open questions in `docs/DECISIONS.md` (brand, logo, domain, sending email, data residency/PDPL).
- Staging deploy on Vercel + Supabase Cloud with a custom domain; Resend domain verification; production GoTrue SMTP.
- Full human QA pass (AR/EN × light/dark × mobile/desktop) on every screen.
- Production: set `CRON_SECRET` (Vercel Cron hits `/api/cron/dispatch-events` every 5 min, see `vercel.json`).

## Suggested Phase 3 scope (from the roadmap)

Tasks (list/board/calendar) with a "convert request to tasks" action on the request page, workflow templates per
service (request type category → template), deliverables with versions and client approvals (turn on `module.approvals` —
the portal home slot is ready), comments reusing `threads` (`subject_type = 'deliverable'`), time tracking, and package
usage entries fed by delivered items (ADR-022). New notifications go in a consumer, not in actions (ADR-028).
