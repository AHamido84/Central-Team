# Handoff — state of the project

Last updated: 2026-10-01 (Feedback Round 3) · Branch: `claude/sharp-euler-zr273f` · Read with `CLAUDE.md` (rules) and `docs/ROADMAP.md` (next work).

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
| Feedback Round 1 | **Built and deployed.** Also: people pickers above drawers, done tasks shown by default. Soft delete + Trash + bulk delete + data reset (ADR-080/081); tasks performance (1,000 tasks interactive < 1 s) and a History-API drawer (ADR-082); reviewed conversion plan + ad-hoc tasks (ADR-083); per-field task permissions enforced by the DB (ADR-084); AI keys in Vault from `/admin/ai` (ADR-085); personal connected accounts incl. X / LinkedIn (ADR-086); email change fixed (ADR-087) |
| Feedback Round 3 | **Built and deployed (2026-10-01).** Assistant crash fixed (an effect returned Chrome's scroll Promise — ADR-089), every AI failure is an inline reason with "Fix in AI settings", the assistant answers with only an Anthropic key through read-only tools that run as the user (ADR-090), index health + background re-index, "Test assistant" in `/admin/ai`, model check on key save |
| Feedback Round 2 | **Built and deployed (2026-10-01).** Settings → Mail (Gmail / Workspace / Outlook / Zoho / Resend / SMTP) with tests, one outbox for app and auth emails (retries, fallback, daily limit, 90-day log at `/admin/mail/log`), email change through the configured sender (ADR-088) |

**Feedback Round 4, verified on a fresh seed**: 277 unit, 262 DB, 57 Playwright e2e tests, `pnpm build` (not deployed yet).
**Feedback Round 2, verified on a fresh seed**: `pnpm check` (243 unit tests), 239 DB tests, `pnpm build`. Feedback Round 1: 229 unit tests, 231 DB tests, 46 Playwright e2e tests,
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
| Deployed from | branch `claude/sharp-euler-zr273f`, commit `903d7f1` (Phases 0–8 + Feedback Rounds 1–3), deployment `dpl_7sv3yYVW78eNhVwMbH3BqVDQHAE7` on 2026-10-01 — all 35 migrations applied (last: `20261001164811_assistant_reasons`, applied by `dpl_3gXJii5JbRSyWr3cyKTNH8tuajRV`); demo data already present, seeds skipped |
| Data | the demo seed (agency "Ofoq", 5 clients, 25 users incl. `majed@` / `ruba@ofoq.test`, password `Passw0rd!` for all) + demo campaigns, SLA data and sales pipeline |

How it works:
- **Deploy** = a Vercel production build of the branch (`POST /v13/deployments` with `gitSource` {repoId `1393530120`,
  ref, sha}, project `prj_XODM4coZmkrKhmNgADNZn8uhYN1S`, team `team_ebxCHVmhrJd2Dp3TV0x1IG9D`, `target: production`).
  The sandbox proxy sometimes drops the POST mid-request: list `/v6/deployments?target=production` before retrying so
  nothing is created twice. `vercel.json` runs `pnpm db:deploy && pnpm build`:
  `scripts/deploy-db.ts` applies pending `supabase/migrations` (tracked in `supabase_migrations.schema_migrations`,
  CLI-compatible) and, while `SEED_ON_DEPLOY=1`, seeds an empty DB once / adds the demo campaigns once / adds the Phase 5 SLA demo data once (`scripts/seed-sla-standalone.ts`) / adds the Phase 6 sales team, leads, deals and capacity settings once (`scripts/seed-crm-standalone.ts`, creates `majed@` and `ruba@ofoq.test`) (ADR-045).
  Trigger it from the Vercel dashboard (Redeploy) or the Vercel API with a token — tokens are **not** stored in the
  repo or the environment; the owner provides one per session.
- **Env vars on Vercel** (set): the integration's `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*`, `POSTGRES_URL*` (read via
  `src/lib/db/url.ts`), plus `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `SEED_ON_DEPLOY=1`. **Not set**: `EMAIL_PROVIDER` /
  `RESEND_API_KEY` / `EMAIL_FROM`, `INTEGRATIONS_SANDBOX`, `AI_PROVIDER`.
- **Email in production: nothing is delivered until the owner configures Settings → Mail** (e.g. Gmail App Password,
  see "Email delivery"). Since FR2 every email, including sign-in and reset links, goes through our outbox; with no
  sender configured and no `EMAIL_PROVIDER`, the environment sender is the console (rows show as sent in the log, no
  inbox receives them).
- **Auth**: the custom access token hook is **not** enabled in the Supabase dashboard; the app works anyway because
  the claims are mirrored into `app_metadata` (ADR-046). Site URL / redirect URLs in Supabase Auth should be set to the
  Vercel URL (owner's task) for magic links and password resets.
- **Cron**: daily at 05:00 UTC (08:00 Riyadh) — reminder sweep, campaign sweep, SLA breach sweep, CRM sweep (follow-ups due, quiet deals), integrations sweep (token expiry, daily sync + retries, stuck webhooks, WhatsApp retry — after Phase 7 deploys), AI detectors + assistant index catch-up (after Phase 8 deploys), dispatcher safety net (ADR-044/055/066/069/074).
- **Network (cloud sessions)**: `api.vercel.com` must be allowed; Supabase (Postgres and HTTPS) is blocked from the
  sandbox, so DB changes only happen through the Vercel build. Headless Chromium can drive the
  site through the sandbox proxy when it trusts the proxy CA (gotcha 62).

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
54. **Never send auth email through GoTrue** (`signInWithOtp`, `resetPasswordForEmail`, `updateUser({ email })`): use
    `sendAuthLinkEmail` / `sendEmailChangeEmails` (ADR-088). `generateLink` creates users for unknown addresses (look the
    member up first) and returns the wrong `hashed_token` for `email_change_new` (we hash new email + OTP ourselves).
55. **Tables with column-level insert grants need a raw `insert` with explicit columns**: Drizzle lists every column
    (defaults included) and the insert is denied (`mail_settings`, `ai_credentials`).
56. **The outbox claim counts the attempt**: `recordFailure` uses the claimed row's `attempts` as is.
57. **Seeded package periods start in the month two weeks back**: seeding on the 1st used to put every seeded request
    outside the package period (nothing consumed, `rls-requests` red for the first days of each month).
58. **Effect callbacks need a block body**: React calls whatever an effect returns as its cleanup. Current Chrome's
    `scrollIntoView` / `scrollTo` return a Promise, so `useEffect(() => el.scrollIntoView())` crashed the assistant
    (ADR-089). ESLint rejects expression-bodied effect callbacks. The sandbox's Chromium 141 still returns `undefined`:
    to reproduce, make the scroll methods return a Promise in the test browser (`e2e/assistant-failure.spec.ts`).
59. **Assistant tools run as the user** (ADR-090): a new tool queries inside the round's `withRls` transaction, renders
    records through `buildChunks` (redaction, titles, URLs) and numbers them in the `SourceRegistry`. Never run a model
    or embedding call inside that transaction: compute query vectors first.
60. **The tool loop is append-only**: assistant turns carry the provider's own content blocks (`raw`, including thinking
    blocks) and go back unchanged. The last round sends `tool_choice: none`; forced tool use is rejected by current
    models.
61. **New AI failure → add it to `aiFailureCodes`**, `actionErrorCodes`, `errors.<code>` and
    `ai.assistant.reason.<code>` (AR/EN); `tests/unit/ai-assistant.test.ts` checks all four.
62. **Headless Chromium can reach production through the sandbox proxy** with
    `proxy: { server: process.env.HTTPS_PROXY }` and `--ignore-certificate-errors-spki-list=<sha256 of the proxy CA key>`
    (`openssl x509 -in /root/.ccr/agent-proxy-ca.crt -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst
    -sha256 -binary | base64`), which trusts exactly that CA. Vercel's `vercel.com/api/logs/request-logs?projectId=…&ownerId=…&startDate=…&endDate=…&search=…`
    (Bearer token) returns the last hour's requests with function events; Hobby keeps about an hour.

## Email delivery (Feedback Round 2, ADR-088)

Every email (invitations, sign-in links, password resets, email-change links, notifications, reports, security notices)
goes through **one queue** (`email_outbox`) and **one sender**: the organization's sender from **Settings → Mail**
(`/admin/mail`, Super Admin / Admin).
- The environment provider (`EMAIL_PROVIDER`) is the fallback, and the sender until one is configured.
- Auth links are generated by GoTrue's Admin API and sent by us, so Supabase's own SMTP setting no longer matters
  for the app.
- Locally everything lands in Mailpit (http://localhost:54324) unless `EMAIL_DEV_REAL_SEND=1`.
- The email log is at `/admin/mail/log`.

### Connect a Gmail account
1. On the Google account that should send: **Google Account → Security → 2-Step Verification → turn on** (App
   Passwords need it).
2. Open https://myaccount.google.com/apppasswords → name it `Central` → **Create** → copy the 16-character password
   (spaces don't matter).
3. In Central: **Settings → Mail** → **Gmail**:
   - **Username** = the full Gmail address.
   - **Password / App password** = the 16 characters.
   - **From email** = the same Gmail address (or an alias verified in Gmail → Settings → Accounts → "Send mail as").
   - Add the From names in Arabic and English, an optional reply-to, and a daily limit (500 is the preset).
4. **Test connection** → "Connected and signed in"; **Save**; **Send test email** to yourself.
5. Production only sends through it once deployed; locally set `EMAIL_DEV_REAL_SEND=1` in `.env.local` to try it from
   your machine.

Limits: about 500 messages a day for a personal Gmail account (Workspace: about 2,000). The status card shows today's
count and admins are warned at 80%. Past the limit, mail goes through the fallback sender or waits until tomorrow.
Typical errors: "Wrong username or password" = not an App Password; "port blocked" = the host's outbound port 587 is
closed; "TLS failed" = security doesn't match the port.

### Move to your own domain later (Resend)
1. Create a Resend account → **Domains → Add domain** (e.g. `mail.<your-domain>`).
2. At your DNS host add the records Resend shows:
   - SPF: TXT on the sending subdomain, e.g. `send.mail.<domain>` → `v=spf1 include:amazonses.com ~all`. Keep one SPF
     record per name.
   - DKIM: TXT `resend._domainkey.mail.<domain>` with the key Resend shows.
   - Return path: the MX record Resend lists.
   - DMARC: TXT `_dmarc.<domain>` → `v=DMARC1; p=none; rua=mailto:dmarc@<domain>`; move to `p=quarantine` once reports
     are clean.
3. Wait for **Verified**, create an API key (sending access).
4. **Settings → Mail → Resend**: paste the key, From = `no-reply@mail.<domain>`. Test, save, send a test email.
5. Optional but recommended: set the same key as the environment fallback on Vercel (`EMAIL_PROVIDER=resend`,
   `RESEND_API_KEY`, `EMAIL_FROM="Central <no-reply@mail.<domain>>"`). The fallback is then a real sender rather than
   the console.

Supabase itself only needs a sender for emails triggered from its dashboard. Its URL settings still matter: Site URL =
the app URL, redirect URLs = `<app>/**` (the links point to `/auth/confirm`).

## Open items (need the owner)

0. **Anthropic credit**: the organization's key decrypts and is accepted, but Anthropic answers every call with
   "Your credit balance is too low to access the Anthropic API" (verified on production with "Test assistant" and the
   three FR3 questions; each shows the reason inline). Add credit at console.anthropic.com → Plans & Billing, then
   re-run "Test assistant" and the three questions (FR3.7).
1. **Connect a sender in Settings → Mail** on production (Gmail App Password steps above) — until then no email is
   delivered. Optionally also `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM` on Vercel as the fallback.
2. **Vercel production branch** still says `claude/modest-faraday-3u6pzy`; point it at `claude/sharp-euler-zr273f` or
   `main` (a push to that other branch would replace the live deploy).
3. **Demo env on Vercel**: `INTEGRATIONS_SANDBOX=1` and `AI_PROVIDER=mock` (otherwise integrations / AI show "not
   configured"), then redeploy.
4. **Security before real clients**: revoke the Vercel tokens pasted into chats, rotate the Supabase DB password,
   set `SEED_ON_DEPLOY=0`, remove or re-password the demo accounts (`Passw0rd!`), enable the custom access token hook,
   set Supabase Auth Site URL / redirect URLs to the app URL.
5. **Live AI** (ADR-073/085): an Anthropic key + a Voyage key, either on Vercel (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`)
   or in `/admin/ai`. Decide data residency first (open question 6 / ADR-076).
6. **Live platforms** (ADR-068 / ADR-086): the owner's developer apps — Meta (App ID / secret / verify token, app review
   for `ads_read`, `leads_retrieval`, `pages_*`, `business_management`), WhatsApp Business (system-user token, phone
   number id, WABA id, approved templates), TikTok for Business, Snapchat Marketing API (+ webhook secret), Google Cloud
   OAuth + Google Ads developer token (+ MCC id) + lead form key. People can already paste personal tokens in Settings →
   Connected accounts (`docs/INTEGRATIONS.md`).
7. Custom domain (the owner's network blocks some `*.app` hosts — ADR-015), a Pro plan for a 5-minute cron, a dedicated
   `FORM_SIGNING_SECRET`.
8. Answers to the open questions in `docs/DECISIONS.md` (brand, logo, domain, sending email, data residency / PDPL) and
   human QA on real devices.

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

## Feedback Round 2 — manual test checklist (local; Mailpit at http://localhost:54324)

1. `/admin/mail` as `sara@`: each preset fills host / port; Gmail with a different From shows the warning; Test
   connection with port 1 → "port blocked"; custom SMTP `127.0.0.1:54325`, security none, any password → "Connected";
   Save → reload → password field empty, only the masked hint.
2. Send test email → arrives in Mailpit with the branded template; `/admin/mail/log` shows it as Sent; filters work.
3. Sign out → magic link and forgot password → both arrive (bodies not kept in the log).
4. Profile → change email (`omar@`) → two emails (old + new) → confirm both → sign in with the new address; errors for
   your own address and `sara@ofoq.test`; resend / cancel.
5. As `khalid@` → `/admin/mail` shows "no access".
6. Repeat the screens in AR / EN × light / dark × mobile / desktop.

## Feedback Round 3 — manual test checklist (local; or production after deploy)

1. `/admin/ai` as `sara@` with **only an Anthropic key** (no Voyage): Provider says "Text by …" and "Search: keyword
   search…"; the Voyage badge says "Not set — optional"; the index card says it isn't used and that Voyage is optional.
2. **Test assistant** → seven steps: switch, budget, key decrypt, Anthropic call (with time), embedder (warning: keyword
   fallback), retrieval (sources found), final answer (sources, tools, search mode). Turn AI off → step 1 fails, the
   rest are "not run".
3. `/assistant`: "عايز تقرير بطلبات العملاء المفتوحة", "إيه المهام المتأخرة النهارده؟", "Summarize client Najd's month" →
   answers with numbered citations that open the records.
4. Edit the key's model to `claude-3-opus-20240229` → save → warning that it was switched to a current model.
5. Failures inline: a wrong key → "Anthropic rejected the API key" + "Fix in AI settings" (admins only; `khalid@` sees
   the reason without the link); budget 0 → "used this month's AI budget". The composer and the conversation list keep
   working.
6. As `khalid@` (Specialist): ask about Lujain (not his client) or a lead by name → nothing from them is cited.
7. With a Voyage key added: the index card shows the model, last build and progress, and a re-index starts in the
   background; Test assistant's embedder step passes.
8. Repeat the screens in AR / EN × light / dark × mobile / desktop.

## Feedback Round 4 — manual test checklist (local: `pnpm db:reset`, password `Passw0rd!`; Mailpit at http://localhost:54324)

Built on branch `claude/blissful-hawking-7crr14` (ADR-091…093). **Not deployed yet** — the production migrations
`20261002142836_portal_multi_client` and `…142900_portal_multi_client_security` and the multi-client seed user
(`scripts/seed-multi-client-standalone.ts`, run by `deploy-db.ts`) go out with the next deploy.

Multi-client login: **`hala@group.test`** (هالة القحطاني) is Owner of Darb Coffee (can approve), Member of Future Smile
(can approve) and Viewer of Najd Heritage.

1. Sign in as Hala → "Choose an account" with 3 cards (role, can-approve, pending approvals). Pick Darb → home and
   requests show only Darb (DARB-…). Sign out/in → straight to Darb (last used).
2. Header switcher → logos, current client ticked, approval badges, a dot when approvals wait elsewhere → switch to
   Najd: only NAJD-… data, and approving isn't offered (Viewer). Phone width: the same list is under "More".
3. Settings → Notifications as Hala → "Notifications for" Najd → switch a toggle → "Customized"; "Use the default for
   this client" resets it.
4. As `faisal@ofoq.test`: Clients → Gulf Vision → Portal users → "Invite user" → type "hala" → pick her → "already
   has a portal account (clients: …). Add them?" → Add. Hala gets the in-app notice (with a client badge) and the
   "You now have access" email; clicking the notice opens Gulf Vision.
5. Same dialog with `noura@ofoq.test` → "agency team member" and the button is disabled.
6. Invite a new address, then "Change email" on the invitation row → the old link says invalid, the new address
   gets a fresh invitation.
7. A portal user's ⋯ → "Change email":
   - **Change it now** → sign in with the new address. The old address gets a notice naming Faisal, and other sessions
     end.
   - **Ask them to confirm** → the row shows "Waiting for … to confirm" (cancel available). The Mailpit link →
     `/email-change/confirm` → "Confirm new email" → done; the link is single use.
   - The address of another portal user → the error plus "Add that user to this client instead".
8. A user's name (or ⋯ → Details) → drawer: every client with role, approval, status and date added. Change the
   role or approval per client, "Remove from this client", "Add to a client", and the separate "Deactivate account".
9. Admin → Users → **Portal users** tab: every portal user with their clients; a row opens the same drawer.
10. As `yasser@darb.test` (Owner of Darb) → Company → Team → Hala's drawer shows only Darb.

Gotchas:
- Portal links that change the client must be plain `<a>` (full navigation). With `<Link>` the persisted layout
  keeps the old client's shell (ADR-091).
- `app.active_client` narrows membership functions inside policies too. A policy that must accept any of the user's
  own clients (e.g. `notification_client_preferences` inserts) uses `app.my_portal_clients()`, not `client_users`.
- In the Playwright mobile viewport the Next.js dev badge covers the bottom-bar "More" button (dev only).

## Starting a new session

1. Read `CLAUDE.md`, this file, `docs/ROADMAP.md` (latest: "Feedback Round 4"), and `docs/DECISIONS.md` (next ADR:
   **094**). Work on the branch the session names (Round 4: `claude/blissful-hawking-7crr14`); Conventional Commits with a
   lowercase subject (commitlint); push after each logical step.
2. Local stack (cloud sandboxes lose it on every container restart):
   - `rm -f /var/run/docker.pid; dockerd > /tmp/dockerd.log 2>&1 &` (wait for `docker info`).
   - `npx supabase start` (CLI 2.118.0; config changes need `supabase stop && supabase start`).
   - `.env.local` from `supabase status -o env` (`bash scripts/bootstrap.sh` does all of this on a fresh machine).
   - `pnpm db:reset` → `pnpm dev` in the background (first compile of a route can take minutes in the sandbox).
   - Playwright: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`. Clear login limits with
     `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "delete from public.rate_limits"`.
3. Verify: `pnpm check` (277 unit), `pnpm test:db` after a fresh `db:reset` (262), `pnpm test:e2e` (57; re-run a spec
   that timed out on a cold route before calling it a failure), `pnpm build`.
4. Deploy only when the owner says so and gives a Vercel token in that session (never store it) — see "Production".
5. Never commit secrets: GitHub push protection rejects even the local Supabase CLI keys; tests read them from the
   environment / `.env.local`.

## Next steps

All roadmap phases (0–8) and Feedback Rounds 1–2 are built and deployed. In order:
1. The owner's open items above (sender in Settings → Mail first).
2. Plug in live AI keys and the platform developer apps, then verify the live adapters (ROADMAP 7.8, 8.8).
3. Human QA pass (AR/EN × light/dark × mobile/desktop) and the "Deferred" lists in `docs/ROADMAP.md`.
4. Wait for the owner's next feedback round — plan it in ROADMAP first, then build.
