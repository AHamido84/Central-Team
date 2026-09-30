# Handoff — state of the project

Last updated: 2026-09-30 · Branch: `claude/stoic-cray-wud1ib` · Read with `CLAUDE.md` (rules) and `docs/ROADMAP.md` (next work).

## Where we are

| Phase | Status |
|---|---|
| 0 — Foundation | **Built.** Auth (password, magic link, reset, email change), invitations, onboarding, RBAC with permission matrix + overrides, departments, feature flags, audit log, notifications, design system, AR/EN RTL/LTR, light/dark |
| 1 — Client Portal | **Built.** Agency client management (clients, portal users, packages + usage ledger, files, messages inbox) and the client portal (home, files, messages, company settings, flag-guarded Requests/Approvals/Calendar) |
| 2 — Requests | **Built (revision 2).** Request types with a no-code form builder (12 field types, conditions, drag & drop, live preview), portal wizard with drafts and package quota check, per-client references, DB-enforced lifecycle with reasons, triage inbox + preview drawer with SLA states, package consumption on accept, client dashboard (stats, usage chart, activity), notifications via the event dispatcher |
| 3 — Tasks & Deliverables | **Built.** Workflow templates + visual builder, configurable task statuses, "Convert to tasks", tasks (board with swimlanes, list, table with bulk/inline edit, calendar, My Work, saved views, keyboard drawer, realtime, time tracking), deliverables with resumable uploads and versions, internal review → client approval with image pins / video timestamps, revision rounds, portal approvals center + content calendar + request progress, reminders |
| 4 — Campaigns | **Built.** Campaigns per client with channels, budgets and KPI targets; daily metrics by hand (week grid) or CSV import with Meta/TikTok/Snapchat/Google detection; analytics (KPI pacing, budget pacing, health, trend + channel charts); report builder with published snapshots, print/PDF and weekly/monthly schedules; portal campaigns + reports; notifications (campaign live, at risk, stale numbers, report ready/published) |
| 5 — Agency Operations | **Built.** Ops dashboard across accessible clients (scope by account manager, tiles, client portfolio by health, needs-attention list, workload by department, SLA compliance); Client 360 on the client overview (health score with reasons, SLA compliance, deadlines, one activity stream) and health on the clients list; team workload (`/team`, `/team/[id]`); SLA policies (`/admin/sla`: match by client/type/priority, reply in business hours, delivery in working days, pause on client, escalation, business hours, holidays), SLA targets on requests, daily breach sweep + alerts, SLA monitor (`/sla`) with acknowledgement |
| 6 — CRM & Capacity | **Next** |

Verified green on a fresh seed: `pnpm lint`, `pnpm typecheck`, `pnpm i18n:check`, 134 unit tests, 113 DB tests
(RLS, dispatcher, approval state machine, reminders, campaign sweep, SLA calendar parity, SLA triggers/RLS, SLA sweep),
22 Playwright e2e tests, `pnpm build`. The CI workflow (`.github/workflows/ci.yml`) is written but has not run on GitHub yet.

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
14. **Deliverable files are internal rows** (`source = 'deliverable'`); clients read them only through a version that
    was sent to them (`files_select`). Never flip their visibility to share them.
15. **Resumable uploads need exactly 6 MB chunks** (Supabase Storage TUS) and go to `/storage/v1/upload/resumable/sign`
    with the signed token in `x-signature`; the path is still chosen by the server.
16. **dnd-kit + React compiler lint**: destructure `useSortable`/`useDroppable` results (no `sortable.x` in render) and
    give each `DndContext` a stable `id` (`useId()`), or SSR hydration mismatches on `aria-describedby`.
17. **PL/pgSQL doesn't short-circuit**: `if tg_table_name = 'x' and new.col …` fails on tables without `col` — nest
    the IF, or use one trigger function per table.
18. **ICU differs between Node and the browser** (compact notation, bidi marks in Arabic currency): format compact
    numbers from translations and strip marks (`campaigns/components/format.ts`), or hydration fails.
19. **SVG `text-anchor` follows the text direction**: in RTL `start` is the right edge — pick anchors by the side the
    label grows towards (`grow()` in `charts.tsx`).
20. **Login is rate-limited** (10 per email per 15 min): repeated screenshot scripts time out on login — clear
    `public.rate_limits` locally.
21. Dev-only: the Next.js dev indicator ("N" bubble) overlaps the bottom-left of mobile screenshots; it is not in builds.
22. **UPDATE … FROM cannot use `lateral` against the target table** — compute the per-row value in a CTE and join it.
23. **`tx.execute(sql\`…${date}…\`)` with a `Date` fails in postgres-js** (Drizzle builders convert, raw `sql` doesn't) —
    pass `date.toISOString()` with a `::timestamptz` cast.
24. **SLA targets are snapshots set at submit** (ADR-052): changing a policy doesn't touch existing requests; tests that
    create policies must delete them (a leftover policy can win the match on the next run — see `e2e/operations.spec.ts`).
25. **`issuesOf()` / `openRequestsForSla()` are shared** by the SLA monitor, the ops dashboard and Client 360 — change the
    SLA state rules in `requests/constants.ts` (`slaState`, `responseState`), never in a view.
26. DataTables render desktop rows and hidden mobile cards: in Playwright filter to `{ visible: true }` before `.first()`.

## Production (live demo)

| | |
|---|---|
| URL | https://centralteam.vercel.app (Vercel project `centralteam`, Hobby plan) |
| Database | Supabase project `udqhetkwsqpyyuurajcb` (created through the Vercel ↔ Supabase integration) |
| Deployed from | branch `claude/stoic-cray-wud1ib` (Phase 4, commit `ee2e20c`). **Phase 5 is pushed but not deployed** — waiting for the owner's go and a Vercel token |
| Data | the demo seed (agency "Ofoq", 5 clients, 23 users, password `Passw0rd!` for all) + Phase 4 demo campaigns |

How it works:
- **Deploy** = a Vercel production build of the branch. `vercel.json` runs `pnpm db:deploy && pnpm build`:
  `scripts/deploy-db.ts` applies pending `supabase/migrations` (tracked in `supabase_migrations.schema_migrations`,
  CLI-compatible) and, while `SEED_ON_DEPLOY=1`, seeds an empty DB once / adds the demo campaigns once / adds the Phase 5 SLA demo data once (`scripts/seed-sla-standalone.ts`) (ADR-045).
  Trigger it from the Vercel dashboard (Redeploy) or the Vercel API with a token — tokens are **not** stored in the
  repo or the environment; the owner provides one per session.
- **Env vars on Vercel** (all set): the integration's `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*`, `POSTGRES_URL*` (read via
  `src/lib/db/url.ts`), plus `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `SEED_ON_DEPLOY=1`. Not set yet: `EMAIL_PROVIDER` /
  `RESEND_API_KEY` / `EMAIL_FROM` (so the app's own emails go to the console; Supabase Auth emails still send).
- **Auth**: the custom access token hook is **not** enabled in the Supabase dashboard; the app works anyway because
  the claims are mirrored into `app_metadata` (ADR-046). Site URL / redirect URLs in Supabase Auth should be set to the
  Vercel URL (owner's task) for magic links and password resets.
- **Cron**: daily at 05:00 UTC (08:00 Riyadh) — reminder sweep, campaign sweep, SLA breach sweep, dispatcher safety net (ADR-044/055).
- **Network (cloud sessions)**: `api.vercel.com` must be allowed; direct Postgres (port 5432/6543) to Supabase is
  blocked from the sandbox, so DB changes only happen through the Vercel build.

## Open items (need the owner)

- Vercel's **production branch** setting still says `claude/modest-faraday-3u6pzy`; point it at this branch or `main`
  (a push to that other branch would replace the live deploy).
- Before real clients: set `SEED_ON_DEPLOY=0`, delete the demo accounts or change their passwords, **rotate the Supabase
  DB password and the Vercel token** (both were pasted into a chat), enable the auth hook, set Auth URLs.
- Email: Resend account + verified sending domain, then `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`.
- Custom domain (the owner's network blocks some `*.app` hosts — ADR-015) and a Pro plan for a 5-minute cron.
- Answers to open questions in `docs/DECISIONS.md` (brand, logo, domain, sending email, data residency/PDPL).
- Human QA on real devices; deferred items in `docs/ROADMAP.md` §3.9 and §4.9.

## Starting a new session

1. Read `CLAUDE.md`, this file, `docs/ROADMAP.md`; then `bash scripts/bootstrap.sh` (or `pnpm db:start` +
   `pnpm db:reset` if the stack exists). In cloud sandboxes Docker may need `dockerd &` first, the Supabase CLI may be
   missing (install the release binary from github.com/supabase/cli, same version as CI: 2.118.0), Playwright needs
   `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`, and `pnpm dev` must be started in the background.
2. Verify: `pnpm check`, `pnpm test:db`, `pnpm test:e2e` (expect 134 / 113 / 22 green), `pnpm build`. On a cold dev
   server the first e2e run can time out on a first-compiled route; re-run that spec before treating it as a failure.
3. Work on branch `claude/stoic-cray-wud1ib` (or the one the owner names); Conventional Commits; plan in ROADMAP +
   DATA_MODEL before building a phase; decisions in DECISIONS (next ADR: **058**).

## Suggested Phase 6 scope (from the roadmap)

CRM & capacity: leads, pipeline stages, deals and activities, won deal → client (reusing client creation), and team
capacity planning (available hours per person/department vs task estimates — `/team` already shows open work, reviews
and logged time, and `tasks.estimate_minutes` exists). Deferred items: `docs/ROADMAP.md` §3.9, §4.9 and §5.8.
