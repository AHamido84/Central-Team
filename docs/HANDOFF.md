# Handoff — state of the project

Last updated: 2026-09-30 (Feedback Round 1) · Branch: `claude/sharp-euler-zr273f` · Read with `CLAUDE.md` (rules) and `docs/ROADMAP.md` (next work).

## Where we are

| Phase | Status |
|---|---|
| 0 — Foundation | **Built.** Auth (password, magic link, reset, email change), invitations, onboarding, RBAC with permission matrix + overrides, departments, feature flags, audit log, notifications, design system, AR/EN RTL/LTR, light/dark |
| 1 — Client Portal | **Built.** Agency client management (clients, portal users, packages + usage ledger, files, messages inbox) and the client portal (home, files, messages, company settings, flag-guarded Requests/Approvals/Calendar) |
| 2 — Requests | **Built (revision 2).** Request types with a no-code form builder (12 field types, conditions, drag & drop, live preview), portal wizard with drafts and package quota check, per-client references, DB-enforced lifecycle with reasons, triage inbox + preview drawer with SLA states, package consumption on accept, client dashboard (stats, usage chart, activity), notifications via the event dispatcher |
| 3 — Tasks & Deliverables | **Built.** Workflow templates + visual builder, configurable task statuses, "Convert to tasks", tasks (board with swimlanes, list, table with bulk/inline edit, calendar, My Work, saved views, keyboard drawer, realtime, time tracking), deliverables with resumable uploads and versions, internal review → client approval with image pins / video timestamps, revision rounds, portal approvals center + content calendar + request progress, reminders |
| 4 — Campaigns | **Built.** Campaigns per client with channels, budgets and KPI targets; daily metrics by hand (week grid) or CSV import with Meta/TikTok/Snapchat/Google detection; analytics (KPI pacing, budget pacing, health, trend + channel charts); report builder with published snapshots, print/PDF and weekly/monthly schedules; portal campaigns + reports; notifications (campaign live, at risk, stale numbers, report ready/published) |
| 5 — Agency Operations | **Built.** Ops dashboard across accessible clients (scope by account manager, tiles, client portfolio by health, needs-attention list, workload by department, SLA compliance); Client 360 on the client overview (health score with reasons, SLA compliance, deadlines, one activity stream) and health on the clients list; team workload (`/team`, `/team/[id]`); SLA policies (`/admin/sla`: match by client/type/priority, reply in business hours, delivery in working days, pause on client, escalation, business hours, holidays), SLA targets on requests, daily breach sweep + alerts, SLA monitor (`/sla`) with acknowledgement |
| 6 — CRM & Capacity | **Built.** Leads (manual, CSV import with mapping, public embeddable form `/f/[token]` with honeypot + signed ticket + rate limits, inbound webhook), Saudi phone normalisation, duplicates + merge, assignment rules with round-robin; configurable pipelines, Kanban with drag & drop (+ keyboard), deal page (stage bar, contacts, activities, files, quotes with AR/EN print), won → client in one step (client, package, portal invitation, onboarding tasks); follow-ups view, due / quiet-deal reminders and sales notifications; sales dashboard (pipeline by stage, conversion, win rate, cycle, sources, per person, forecast vs target); capacity planning (`/capacity`: 8-week department heatmap, over-allocated people, "can we take this client?" simulator, hours / time off / service effort); Sales Manager + Sales Rep roles |
| 7 — Integrations & Automation | **Built, not deployed yet.** One `IntegrationProvider` interface with live adapters (Meta Ads + Pages + lead ads, WhatsApp Cloud API, TikTok, Snapchat, Google Ads / GA4) and a deterministic **sandbox** per platform; OAuth with signed state + nonce cookie, tokens only in Supabase Vault; `/admin/integrations` (connect / reconnect / disconnect / test, health with expiry, account → client and platform campaign → channel mapping, sync now, backfill ≤ 90 days, sync log with retries, webhook log, WhatsApp templates and messages); daily idempotent sync into `metrics_daily`; signed webhooks `/api/hooks/[provider]` → lead ads into `ingestLead()`; WhatsApp notifications (opt-in + per-category switch) and template messages from lead / deal pages with delivery status; automation engine (`/admin/automations`: trigger catalog, conditions, 6 action types, dry run, run log, retries, loop guard) |
| 8 — AI Intelligence | **Built, not deployed yet.** Campaign insights computed by code (robust z-score anomalies on complete days, KPI and budget pacing, delivery stopped) with rule-based recommendations and computed impact → one click to a task; `/insights` + campaign Insights tab + detail with an AI explanation; notifications (`ai_insight`) and an automation trigger; "Draft with AI" for report commentary / next steps in the report's language (and optional auto-drafts for scheduled reports); `/assistant` with private conversations, retrieval through pgvector **inside the user's RLS** (a chunk is visible only if its source row is) and validated citations; `/admin/ai` (switch, sensitivity, budget + usage, provider status, index rebuild). Everything behind `AiProvider` (Claude via the Anthropic SDK + Voyage embeddings) with a deterministic mock |
| Feedback Round 1 | **Built, not deployed.** Soft delete + Trash + bulk delete + data reset (ADR-080/081); tasks performance (1,000 tasks interactive < 1 s) and a History-API drawer (ADR-082); reviewed conversion plan + ad-hoc tasks (ADR-083); per-field task permissions enforced by the DB (ADR-084); AI keys in Vault from `/admin/ai` (ADR-085); personal connected accounts incl. X / LinkedIn (ADR-086); email change fixed (ADR-087) |

**Feedback Round 1, verified on a fresh seed**: `pnpm check` (229 unit tests), 231 DB tests, 46 Playwright e2e tests,
`pnpm build`. Earlier (Phase 8): `pnpm lint`, `pnpm typecheck`, `pnpm i18n:check`, 220 unit tests, 187 DB tests
(RLS, dispatcher, approval state machine, reminders, campaign sweep, SLA calendar parity, SLA triggers/RLS, SLA sweep,
CRM triggers/RLS, capacity readers, lead intake, CRM sweep, Vault isolation, integrations/automations RLS, sync
idempotency, lead-ad webhooks, WhatsApp statuses, automation engine, AI RLS + permission-aware retrieval, detector
idempotency, indexer, AI budget), 28 Playwright e2e tests, `pnpm build`. The CI workflow (`.github/workflows/ci.yml`) is written but has not run on GitHub yet.

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
27. **Actions that reuse other modules' services run as the caller** (e.g. won → client creates folders, a thread, tasks
    and task members): every table touched needs the caller's rights. `defineAction` maps Postgres `42501` to
    `forbidden` — to find which statement, log the original error there temporarily.
28. **`INSERT … RETURNING` fails when the table's SELECT policy looks the new row up through a STABLE function**
    (`app.can_access_client(clients.id)` can't see it yet): insert with an app-generated id and no `returning`, as
    `createClientRecord()` does.
29. **Deal and lead triggers stamp `last_activity_at = now()`** when a stage is set; a seed with historical dates must
    recompute it afterwards (`scripts/seed-crm.ts` does).
30. **`sr-only` spans inside table cells need `relative` on the cell**: absolute children escape an `overflow-x-auto`
    wrapper and widen the page on mobile (capacity heatmap).
31. Request form field types are `short_text` / `long_text` (not `text` / `textarea`) — seed forms are typechecked.
32. The capacity demand readers (`app.capacity_*`) raise `42501` without `capacity:read`; call them only from
    `getCapacity()` (ADR-060).

33. **Integration tokens never touch a table** (ADR-067): read them only through `openConnection()` (service path);
    users can write a secret (`app.integration_put_secret`) but nobody but the service role reads one.
34. **Guard triggers own integration columns**: a manager's UPDATE of a connection keeps only `name`; of an account only
    `client_id` / `sync_enabled`; of a campaign link only `channel_id`. `app.is_user_write()` tells users (role
    `authenticated`) from the service path — don't test `auth.uid() is null`, the service path sets a `sub` for the audit.
35. **Events emitted in background work need a dispatch**: `executeRunsQuietly()` calls `runDispatcher()` itself; a new
    background producer must too (or wait for the cron).
36. **Webhook items round-trip through jsonb**: dates in `WebhookItem` are ISO strings, never `Date`.
37. **next-intl key types are near TypeScript's limits**: importing an unrelated module into a page once made valid
    namespaces fail to type-check (`providers/sandbox.ts` into the consent page); `sandbox-code.ts` exists for that reason.
    If a correct `getTranslations('x')` suddenly errors in one file only, bisect that file's imports.
38. **Automation rules are unique per (rule, event)**: tests that create rules must drain pending events first, or the
    new rule also runs on events left over from earlier tests (`tests/db/integrations.test.ts`).

39. **Model calls never run inside the action's transaction**: put them in `defineAction`'s post-commit `complete` step
    (ADR-079) and go through `runtime.generate()` / `embedTexts()` (switch, budget, usage). Do the RLS-checked reads in
    the handler.
40. **A new assistant source type touches five places**: `sourceTypes` (`ai/types.ts`), `app.ai_source_visible` (SQL),
    `buildChunks` + the `sourceTable` map (`indexer-core.ts`) and `targetsOf` (`server/indexer.ts`). The chunk policy
    delegates to the source table's RLS through that `security invoker` function — never make it `security definer`.
41. **Detectors skip today** (partial day) and need 7 days of history in the last 14; to demo an anomaly change
    *yesterday's* numbers (`scripts/seed-ai.ts`). Anomaly insights are keyed by day; pacing ones reopen when they return.
42. **The mock embedder is lexical** (Arabic normalization + word pairs + trigrams, stop words): English questions over
    Arabic records find little. Retrieval cut-offs: 0.15 (mock) / 0.2 (live) cosine similarity.
43. **Raw `tx.execute` returns timestamps as Postgres text** ("2026-09-30 10:00:00.1+00"): normalize before `new Date()`
    (`iso()` in `indexer-core.ts`).
44. **Names inside insight / recommendation sentences are wrapped in U+2068/U+2069**; tests compare with `plain()`.
45. **The profile language wins over the `NEXT_LOCALE` cookie**: e2e personas with an Arabic profile (Noura) render Arabic
    even in an `en-US` browser context — assert the Arabic UI or use Sara.

## Production (live demo)

| | |
|---|---|
| URL | https://centralteam.vercel.app (Vercel project `centralteam`, Hobby plan) |
| Database | Supabase project `udqhetkwsqpyyuurajcb` (created through the Vercel ↔ Supabase integration) |
| Deployed from | branch `claude/stoic-cray-wud1ib`, commit `70541bb` (Phases 0–6; Phases 7–8 built, not deployed), deployment `dpl_5GC5GRe1SgdUKCYfQcdJ4SFBJ55m` on 2026-09-30 — migrations through `20260930020100` applied, Phase 5 SLA and Phase 6 sales demo data loaded |
| Data | the demo seed (agency "Ofoq", 5 clients, 25 users incl. `majed@` / `ruba@ofoq.test`, password `Passw0rd!` for all) + demo campaigns, SLA data and sales pipeline |

How it works:
- **Deploy** = a Vercel production build of the branch. `vercel.json` runs `pnpm db:deploy && pnpm build`:
  `scripts/deploy-db.ts` applies pending `supabase/migrations` (tracked in `supabase_migrations.schema_migrations`,
  CLI-compatible) and, while `SEED_ON_DEPLOY=1`, seeds an empty DB once / adds the demo campaigns once / adds the Phase 5 SLA demo data once (`scripts/seed-sla-standalone.ts`) / adds the Phase 6 sales team, leads, deals and capacity settings once (`scripts/seed-crm-standalone.ts`, creates `majed@` and `ruba@ofoq.test`) (ADR-045).
  Trigger it from the Vercel dashboard (Redeploy) or the Vercel API with a token — tokens are **not** stored in the
  repo or the environment; the owner provides one per session.
- **Env vars on Vercel** (all set): the integration's `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*`, `POSTGRES_URL*` (read via
  `src/lib/db/url.ts`), plus `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `SEED_ON_DEPLOY=1`. Not set yet: `EMAIL_PROVIDER` /
  `RESEND_API_KEY` / `EMAIL_FROM` (so the app's own emails go to the console; Supabase Auth emails still send).
- **Auth**: the custom access token hook is **not** enabled in the Supabase dashboard; the app works anyway because
  the claims are mirrored into `app_metadata` (ADR-046). Site URL / redirect URLs in Supabase Auth should be set to the
  Vercel URL (owner's task) for magic links and password resets.
- **Cron**: daily at 05:00 UTC (08:00 Riyadh) — reminder sweep, campaign sweep, SLA breach sweep, CRM sweep (follow-ups due, quiet deals), integrations sweep (token expiry, daily sync + retries, stuck webhooks, WhatsApp retry — after Phase 7 deploys), AI detectors + assistant index catch-up (after Phase 8 deploys), dispatcher safety net (ADR-044/055/066/069/074).
- **Network (cloud sessions)**: `api.vercel.com` must be allowed; Supabase (Postgres and HTTPS) is blocked from the
  sandbox, so DB changes only happen through the Vercel build. The site answers `curl`, but headless Chromium can't
  load its scripts through the sandbox proxy (forms submit as plain HTML), so check the logged-in UI from a real browser.

46. **Guard triggers silently keep server-owned columns**: `integration_connections` updates by users keep only `name`
    (and `owner_id` for managers, ADR-086) — a wrong column doesn't error, it just doesn't change. Check the guard first
    when an UPDATE "succeeds" without effect.
47. **Don't redefine an existing `app.*` function by accident**: `app.member_has_permission(org, user, perm)` already
    exists (CRM, used by service-path consumers) — grep the migrations before creating a helper with a generic name.
48. **Timestamps copied through a JS `Date` lose microseconds** and never compare equal to the column again: copy in
    SQL (`set x = y`), as the expiry warning does.
49. **Events inserted by database triggers on GoTrue's connection** (e.g. `user.email_changed`) are dispatched only when
    something schedules a dispatch — `/auth/confirm` calls `scheduleEventDispatch()`; otherwise the cron picks them up.
50. **GoTrue auto-confirm ignores double confirmation**: keep `enable_confirmations = true` (ADR-087). GoTrue answers
    `otp_expired` for used, replaced and expired links alike, and refuses another email within `max_frequency` (1 s).
51. **The factory reset deletes tables in `information_schema` order with retries**: triggers that re-validate a row on
    any UPDATE can fire through `on delete set null` — validate only when the checked columns change.
52. **Never sort server-rendered lists with `localeCompare`**: Node's and Chromium's ICU order mixed Arabic / Latin
    names differently and the rows reorder on hydration (team table). Compare code points, or sort on the server only.
53. **"Today" is the agency's day (`Asia/Riyadh`)**, three hours ahead of UTC: tests comparing with Postgres
    `current_date` fail between 21:00 and 24:00 UTC — use `(now() at time zone 'Asia/Riyadh')::date`.

## Email delivery (auth emails and app emails)

Two senders: **Supabase Auth** sends magic links, password resets and email-change confirmations; the **app** sends its
own notifications through `EMAIL_PROVIDER` (Resend in production). Locally both land in Mailpit
(http://localhost:54324).

For production (Supabase Cloud + Vercel):
1. **Supabase → Authentication → SMTP Settings**: enable custom SMTP (e.g. Resend: host `smtp.resend.com`, port 465 or
   587, user `resend`, password = a Resend API key, sender `no-reply@<domain>`). Without it Supabase only emails the
   project's team members, a few per hour — every other user gets nothing (the FR1.7 bug). Raise the email rate limit
   under Authentication → Rate Limits afterwards.
2. **Authentication → URL Configuration**: Site URL = the app URL (custom domain), redirect URLs = `<app>/**`.
3. **Authentication → Email Templates**: paste `supabase/templates/*.html` (they link to `/auth/confirm?token_hash=…`;
   the default templates also work through the PKCE `code` path). **Sign In / Providers → Email**: keep "Confirm email"
   and "Secure email change" on (ADR-087).
4. **DNS for the sending domain** (at the domain's DNS host; Resend shows the exact values under Domains):
   - SPF: TXT on the sending (sub)domain, e.g. `send.<domain>` → `v=spf1 include:amazonses.com ~all` (Resend's value);
     keep **one** SPF record per name — merge includes if one exists.
   - DKIM: the TXT record `resend._domainkey.<domain>` with the public key Resend gives.
   - Return-path / bounce: the MX record Resend lists for `send.<domain>`.
   - DMARC: TXT `_dmarc.<domain>` → `v=DMARC1; p=none; rua=mailto:dmarc@<domain>` to start; move to `p=quarantine` once
     reports are clean.
   Wait for "Verified" in Resend, then set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` on Vercel for the
   app's own emails (same domain).
5. Test: change an account's email to a real inbox from Settings → Profile; both addresses receive a link.

## Open items (need the owner)

- Vercel's **production branch** setting still says `claude/modest-faraday-3u6pzy`; point it at this branch or `main`
  (a push to that other branch would replace the live deploy).
- Before real clients: set `SEED_ON_DEPLOY=0`, delete the demo accounts or change their passwords, **rotate the Supabase
  DB password and the Vercel token** (both were pasted into a chat), enable the auth hook, set Auth URLs.
- Email: Resend account + verified sending domain, then `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`.
- **Phases 7 and 8 are not deployed yet** (waiting for the owner's go and a Vercel token). The next deploy applies
  migrations `20260930061507` / `20260930061600` (Phase 7) and `20260930102618` / `20260930102700` (Phase 8 — creates
  the `vector` extension in `extensions`) and, with `SEED_ON_DEPLOY=1`, loads the sandbox integrations demo once
  (`scripts/seed-integrations-standalone.ts`) and the AI demo once (`scripts/seed-ai-standalone.ts`). On Vercel set
  `INTEGRATIONS_SANDBOX=1` to keep the sandbox and `AI_PROVIDER=mock` to keep AI working in the demo without keys.
- **Live AI needs** (ADR-073): an Anthropic API key (`ANTHROPIC_API_KEY`, console.anthropic.com; model `AI_MODEL`,
  default `claude-opus-5-5`) and a Voyage AI key (`VOYAGE_API_KEY`, `AI_EMBEDDING_MODEL=voyage-3.5`, 1024 dims);
  outbound hosts `api.anthropic.com`, `api.voyageai.com`. With both keys set (and `AI_PROVIDER` unset or `anthropic`)
  the app switches to live; "Rebuild index" in `/admin/ai` re-embeds the mock index with the live model.
  **Decide data residency first** (open question 6 / ADR-076): both providers process in the US; AI stays off per
  organization until an admin turns it on (the demo seed turns it on).
- **Live platforms need the owner's developer apps** (see the report / ADR-068): Meta app (App ID, secret, verify token,
  app review for `ads_read`, `leads_retrieval`, `pages_*`, `business_management`), a WhatsApp Business system-user token
  + phone number id + WABA id and approved templates, TikTok for Business app, Snapchat Marketing API app + webhook
  secret, Google Cloud OAuth client + Google Ads developer token (+ MCC id) + lead form key; all callback / webhook URLs
  are on the custom domain. Outbound hosts: `graph.facebook.com`, `www.facebook.com`, `business-api.tiktok.com`,
  `accounts.snapchat.com`, `adsapi.snapchat.com`, `accounts.google.com`, `oauth2.googleapis.com`,
  `openidconnect.googleapis.com`, `googleads.googleapis.com`, `analyticsadmin.googleapis.com`.
- Optional: a dedicated `FORM_SIGNING_SECRET` on Vercel for the public lead form tickets (falls back to the Supabase secret key).
- Custom domain (the owner's network blocks some `*.app` hosts — ADR-015) and a Pro plan for a 5-minute cron.
- Answers to open questions in `docs/DECISIONS.md` (brand, logo, domain, sending email, data residency/PDPL).
- Human QA on real devices; deferred items in `docs/ROADMAP.md` (each phase has a "Deferred" list).

## Phase 7 — manual test checklist (sandbox, local or demo with `INTEGRATIONS_SANDBOX=1`)

Sign in as `sara@ofoq.test` (password `Passw0rd!`).
1. `/admin/integrations` → Snapchat "Connect sandbox" → Allow → the connection opens as Connected.
2. Accounts tab: pick a client. Campaigns tab: link a platform campaign to a channel. Sync tab: "Sync now" → the run succeeds
   and the numbers appear on that campaign. Backfill 30 days, then again → the numbers don't change.
3. Connect again with "Allow with a short-lived token" → after 2 minutes "Test connection" shows Expired with Reconnect.
   The seeded "Google Ads — Ofoq MCC" shows the expired state.
4. As `ruba@ofoq.test`, open the lead "ريم القحطاني" → Send message → the status reaches Read.
5. As `noura@ofoq.test`: Settings → Notifications → turn on WhatsApp with consent → the WhatsApp switches become available.
6. `/admin/automations` → a new rule on "Campaign numbers are synced" → sync → the notification arrives and the run log
   shows it; the Test tab runs a dry run.
7. On a connection's Webhooks tab: copy the URL; rejected deliveries appear in the log.
8. Repeat the screens in AR / EN × light / dark × mobile / desktop.

## Phase 8 — manual test checklist (mock provider locally, or the demo with `AI_PROVIDER=mock`)

Sign in as `sara@ofoq.test` (password `Passw0rd!`).
1. `/admin/ai`: provider shows "Demo (mock)" (or "Live" with keys), AI is on, usage and the index counts per source are
   shown; "Rebuild index" reports what it indexed. Turn AI off → the assistant and "Explain" show "AI is off".
2. `/insights`: the orthodontics campaign (Future Smile) shows a **critical** cost-per-lead jump and a leads drop from
   yesterday, plus KPI / budget / delivery insights on other campaigns. Filter by client, severity, type and status.
3. Open an insight → "Explain with AI" → a short explanation in your language. On a suggestion → "Create task"
   (assignee, due date) → the suggestion shows Accepted with "Open task", the insight turns Acknowledged, and the task
   opens in the tasks drawer with a link back. Dismiss another insight with a reason; reopen it.
4. A campaign's **Insights** tab lists its insights with a count badge.
5. As `noura@ofoq.test`: a draft report → "Draft with AI" on Commentary and Next steps → text in the report's
   language (not the UI's) → Save → Publish as usual. Turn on "Draft commentary for scheduled reports" in `/admin/ai`
   and generate a scheduled draft → its empty commentary / next steps are filled.
6. `/assistant`: ask "لخّص وضع حملة عروض تقويم الأسنان" → an answer with numbered markers and a Sources list; the
   links open the records. Rename / delete the conversation.
7. As `khalid@ofoq.test` (Specialist — no CRM access, two assigned clients): ask about a lead by name → no lead or deal
   is cited; ask about Lujain (not his client) → nothing from Lujain.
8. `/admin/automations` → a rule on "An AI insight is detected" (severity = critical) → notify; a critical insight
   triggers it. `/notifications` shows `ai_insight` alerts for campaign owners / account managers.
9. Repeat the screens in AR / EN × light / dark × mobile / desktop.

## Feedback Round 1 — manual test checklist (local: `pnpm db:reset`, password `Passw0rd!`)

1. **Trash & edit/delete** (`sara@`): delete a client from its page → the dialog lists the impact and wants the name
   typed → it disappears everywhere and appears in `/admin/trash`; restore it; delete again and purge (files leave
   Storage). Bulk-delete two requests from the inbox. Edit a file name, a deliverable title, your own message, a
   checklist item. Delete a department (move members to another). Delete a team member (their open tasks go to the
   person you pick).
2. **Data management** (`/admin/data`, Super Admin only): counts per option; download the backup ZIP; run "demo" with
   your password + `DELETE ALL DATA` → progress, then only non-demo data remains; the audit log still shows the reset;
   lock the reset and try again → refused.
3. **Tasks performance & drawer**: `pnpm db:seed:perf 1000`, `/tasks` loads in about a second in list / board / table;
   open a task → the URL gains `?task=`; close with X, Esc, a click outside, browser Back and (mobile) a swipe; type in a
   field then close → "Discard changes?"; focus returns to the row; copy the URL into a new tab → the same task opens.
4. **Convert to tasks** (`noura@`): an accepted request → Convert → review: rename, reassign, change dates / priority,
   remove one, add an ad-hoc task, reorder, set a dependency → Create. The request page lists the tasks ("Outside
   workflow" badge on the ad-hoc one) with Add task / edit / delete; progress recalculates.
5. **Task field permissions**: as `khalid@` (Specialist) a task assigned to him → only status, checklist, comments and
   time are editable; the others show a lock with the reason (drawer, table, card menu). As `lama@` (Team Lead) → her
   department's tasks fully editable. Bulk edit in the table; History tab lists every change; new reviewers / watchers
   get notifications.
6. **AI keys** (`/admin/ai`): add an Anthropic key → only `sk-…abcd` shows; Load models / Test connection (fails
   cleanly with a fake key); monthly limit; switch off → env fallback shown; delete.
7. **Connected accounts** (`khalid@`, sandbox on): Settings → Connected accounts → Connect (Meta, sandbox, any token of
   8+ characters, an expiry date within 7 days) → masked token, "Expiring soon" badge; Test connection → ad accounts;
   pick a client for one; Fetch campaigns → the list. As `sara@`: `/admin/integrations` → "People's connected accounts"
   shows it masked → Reassign to `omar@` → it leaves Khalid's list. As a client user there is no such page.
8. **Email change** (`omar@`): Settings → Profile → try your own address (error "already your email"), `sara@ofoq.test`
   ("already uses this email"), then a new address → pending box with both addresses, Resend and Cancel, and the
   Mailpit link (local only). In Mailpit open the link to the old address → "One more confirmation"; the new one →
   "Your email is changed"; the old inbox gets a security notice; sign in with the new address. As `sara@`: Team →
   a member → Sign-in email → Change email.
9. Repeat the new screens in AR / EN × light / dark × mobile / desktop.

## Starting a new session

1. Read `CLAUDE.md`, this file, `docs/ROADMAP.md`; then `bash scripts/bootstrap.sh` (or `pnpm db:start` +
   `pnpm db:reset` if the stack exists). In cloud sandboxes Docker may need `dockerd &` first, the Supabase CLI may be
   missing (install the release binary from github.com/supabase/cli, same version as CI: 2.118.0), Playwright needs
   `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`, and `pnpm dev` must be started in the background. If `dockerd` won't
   start after a container restart, remove the stale `/var/run/docker.pid` first. Repeated logins trip the login rate
   limit locally — `delete from public.rate_limits` via `docker exec supabase_db_central-team psql -U postgres`.
2. Verify: `pnpm check`, `pnpm test:db`, `pnpm test:e2e` (expect 229 / 231 / 46 green), `pnpm build`. On a cold dev
   server the first e2e run can time out on a first-compiled route; re-run that spec before treating it as a failure.
3. Deploys need a Vercel token from the owner each session (never store it); trigger a production deployment of this
   branch through the Vercel API (`POST /v13/deployments` with `gitSource` for repo id `1393530120`) and read the
   build log for the `[deploy-db]` / seed lines. Revoke-and-rotate reminders are under "Open items".
4. Work on branch `claude/stoic-cray-wud1ib` (or the one the owner names); Conventional Commits; plan in ROADMAP +
   DATA_MODEL before building a phase; decisions in DECISIONS (next ADR: **088**).

## After Phase 8

All eight roadmap phases are built. Suggested next steps, in order: deploy Phases 7–8 (production branch, env vars
above, the build log's `[deploy-db]` / seed lines, the two manual checklists); plug in live AI keys once data residency
is decided and verify the Claude / Voyage adapters (ROADMAP 8.8); verify the Phase 7 live platform adapters with the
owner's developer apps (7.8); then the human QA pass and the deferred lists in `docs/ROADMAP.md` (§2.9–§8.8) —
streaming assistant answers and a portal assistant are the most visible AI follow-ups.
