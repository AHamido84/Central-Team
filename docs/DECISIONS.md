# Decision Log

Append-only. Format: **ADR-NNN — Title** · date · status (Proposed / Accepted / Superseded by ADR-x).
Proposed decisions become Accepted when the owner approves the plan. The owner approved building Phase 0 + 1
with recommended defaults on 2026-09-28; ADR-001…016 are therefore Accepted unless superseded below.

---

### ADR-001 — Single Next.js app with `(agency)` and `(portal)` route groups
2026-09-28 · Accepted
One deployable, shared auth/design system/modules. Agency routes live at root (`/dashboard`, `/admin/*`), portal at
`/portal/*` (route groups don't change URLs, so the portal needs a prefix). A later split to `app.` / `portal.`
subdomains is a proxy rewrite. *Rejected*: two apps in a monorepo — duplicated auth/session handling and
deployment cost with no benefit at this size.

### ADR-002 — Postgres is the authorization authority
2026-09-28 · Accepted
RLS policies call `app.has_permission()`; TypeScript `can()` is computed from `app.effective_permissions()` and used
only for UX and early rejection. Permissions are not stored in the JWT (staleness up to token lifetime).

### ADR-003 — App queries run through Drizzle as `authenticated` with JWT claims (`withRls`)
2026-09-28 · Accepted
Each request's DB work runs in a transaction that sets `request.jwt.claims` and `set local role authenticated`, so
RLS applies to Drizzle queries and `auth.uid()` works in triggers (audit actor). Service role only in listed places.
*Rejected*: Drizzle as superuser + app-side checks (RLS becomes decorative); supabase-js only (loses typed SQL,
transactions, and transactional outbox).

### ADR-004 — Drizzle schema in TS, migrations emitted into `supabase/migrations`
2026-09-28 · Accepted
drizzle-kit generates table DDL with the Supabase timestamp prefix; RLS policies, functions, triggers and grants are
hand-written SQL migrations alongside. `supabase db reset` is the single way to rebuild. One migration history.

### ADR-005 — Own invitations table instead of Supabase `inviteUserByEmail`
2026-09-28 · Accepted
Need resend with rotation, revoke, pre-assigned roles/department/client, bilingual branded email, and audit.
Tokens: 32 random bytes, SHA-256 stored, 7-day expiry, single use. Accept creates the auth user via admin API with
`email_confirm=true` (the click proves email ownership). Public sign-up disabled.

### ADR-006 — All auth emails via Supabase Send Email Hook → React Email → `EmailProvider`
2026-09-28 · Superseded by ADR-017
One bilingual template system for every email; provider swappable (Resend in prod, SMTP→Mailpit locally, Console in tests).

### ADR-007 — Minimal `clients` table in Phase 0
2026-09-28 · Accepted
Client users and client-scoped roles (Owner/Member/Viewer) must attach to a client to be invitable and testable in
Phase 0. Only id/org/name/slug/status/logo now; agency-side client management UI is Phase 1.

### ADR-008 — Binary permissions + relationship-aware RLS for data scope
2026-09-28 · Accepted
Scope variants are separate permissions (`clients:read_all` vs `clients:read_assigned`); RLS combines them with
relationship tables (e.g. `client_assignments`, Phase 1). Keeps the matrix a simple grid of checkboxes.

### ADR-009 — Overrides: deny wins; anti-escalation enforced in DB
2026-09-28 · Accepted
Effective = roles ∪ grants − denies. Nobody (except Super Admin) can grant permissions they don't hold — enforced by
trigger, not just UI. Super Admin role is locked to all permissions and cannot be deleted; the last Super Admin
cannot be removed or deactivated.

### ADR-010 — Locale without URL prefix; Arabic formats use Latin digits + Gregorian calendar
2026-09-28 · Accepted
It's an authenticated app, not SEO content; locale follows the user (profile → cookie → header → `ar`).
`Intl` with plain `ar-SA` defaults to the Islamic (Umm al-Qura) calendar and Arabic-Indic digits, which Saudi
business users rarely expect in operational software; we use `ar-SA-u-nu-latn-ca-gregory` and offer Hijri as a
user preference. *Pending owner confirmation (see open questions).*

### ADR-011 — Localized org-defined content as `jsonb {ar, en}`
2026-09-28 · Accepted
Role, department, client, permission labels are stored as `LocalizedText`. Simpler than translation tables; fine for
two languages; falls back to the other language if one is empty.

### ADR-012 — Transactional outbox for domain events; audit via triggers
2026-09-28 · Accepted
`emitEvent()` writes `domain_events` in the mutation's transaction (no lost/phantom events). Row-level before/after
audit comes from a generic trigger so it can't be forgotten. Dispatcher/consumers start in Phase 1.

### ADR-013 — Language-neutral notifications
2026-09-28 · Accepted
Store `type` + `params`, translate at render. History re-renders in the user's current language; emails render in the
recipient's language at send time.

### ADR-014 — Next.js 16 `proxy.ts` for session refresh & routing
2026-09-28 · Accepted
Next 16 renamed `middleware` to `proxy`. Proxy uses JWT claims only (no DB); layouts re-check against DB.

### ADR-015 — Deploy on Vercel with a custom domain
2026-09-28 · Accepted
Vercel is the reference platform for Next.js 16 features (RSC, Server Actions, ISR). A custom domain is mandatory
because `*.pages.dev` / `*.netlify.app` are blocked on the owner's network (`*.vercel.app` will only be used for
previews if reachable). Cloudflare (OpenNext) remains a fallback.

### ADR-016 — Brand color & font
2026-09-28 · Accepted (default applied: A "Najd Indigo"; per-agency brand color configurable in settings)
Two proposals in `UI.md §3`; recommendation: A "Najd Indigo" + Sand. Fonts: IBM Plex Sans Arabic + Inter.

### ADR-017 — Auth emails via GoTrue bilingual templates; app emails via `EmailProvider`
2026-09-28 · Accepted (supersedes ADR-006)
The Send Email Hook requires GoTrue (inside Docker) to call back into the Next.js app, which is fragile locally and in
CI. Auth emails (magic link, recovery, email change) now use GoTrue's own templates (`supabase/templates/*.html`), each
bilingual and switched on `user_metadata.locale`, and links go to `/auth/confirm?token_hash=…` (no PKCE state). App
emails (invitations, notifications) use React Email + `EmailProvider`. In production GoTrue sends through Resend SMTP.

### ADR-018 — Client roles live on `client_users.role_id`; `user_roles` is agency-only
2026-09-28 · Accepted
A client user's role is scoped to one client and a person may belong to several clients. `app.has_client_permission`
reads `client_users`; `app.has_permission` reads `user_roles` + overrides. The active client is chosen by cookie
(client switcher in the portal header).

### ADR-019 — Internal agency data in separate tables or `visibility` columns, enforced by RLS
2026-09-28 · Accepted
`client_notes` is its own agency-only table (column-level hiding would also hide it from agency staff running as
`authenticated`). Files, folders, threads and comments carry `visibility internal|client`; client-side policies require
`visibility = 'client'`. A trigger forces comments in internal threads to be internal.

### ADR-020 — Storage: private `client-files` + public `public-assets`; signed URLs only
2026-09-28 · Accepted
Client files are private. Uploads: the server validates rights/type/size, then issues a one-time signed upload URL for a
server-chosen path; the browser uploads directly (XHR for progress); `finalize` verifies the object and inserts the row
under RLS. Downloads/previews: short-lived signed URLs issued only for rows the caller can SELECT. Avatars and logos
are low-sensitivity images in the public `public-assets` bucket under unguessable UUID paths (SVG not allowed).
No `storage.objects` policies grant `authenticated` anything.

### ADR-021 — Domain events, notifications and invitation acceptance written from TypeScript
2026-09-28 · Accepted
`emitEvent()` inserts into `domain_events` inside the RLS transaction (policy: actor = `auth.uid()`). `notify()` and
invitation acceptance run with the service connection because they write rows for *other* users / users who are not
members yet; recipients are always computed server-side. These are the listed service-role paths (CLAUDE.md §6).

### ADR-022 — Package usage as a ledger
2026-09-28 · Accepted
`package_usage_entries` (append rows with `source_type/source_id`) instead of counters, so Phase 3 deliverables and
revision rounds can feed usage idempotently and history is auditable. Manual entries (with negative corrections) are
allowed until then.

### ADR-023 — Messages: one polymorphic `threads`/`comments` model; mentions as inline markup
2026-09-28 · Accepted
`threads.subject_type/subject_id` lets requests (Phase 2) and deliverables (Phase 3) reuse messaging. Mentions are stored
as `@[Name](uuid)` in the body plus a `mentions uuid[]` column; notifications only reach mentioned users who can see the
message. Read receipts are `thread_reads.last_read_at` per user.

### ADR-024 — Realtime subscriptions authenticate before joining
2026-09-28 · Accepted
Realtime validates `postgres_changes` joins with the token present at join time; joining before the browser session
loads validates as `anon` (no privileges) and is rejected. `ensureRealtimeAuth()` sets the user's access token first.

### ADR-025 — Typed message keys and a compile-time i18n guard
2026-09-28 · Accepted
next-intl `AppConfig.Messages` is typed from the Arabic JSON files, so a missing or misspelled key fails `tsc`.
`pnpm i18n:check` (also in the pre-commit hook and a unit test) enforces identical ar/en keys and ICU placeholders.
Quoted placeholders use Unicode isolates (U+2068/U+2069) so English file names inside Arabic sentences render correctly.

### ADR-026 — Agency pages at the root, portal under `/portal`, design system under the agency shell
2026-09-28 · Accepted
`/dev/design-system` lives in the `(agency)` group (shell + `design_system:view` + `dev.design_system` flag).
Upcoming-phase portal routes (`/portal/requests`, `/approvals`, `/calendar`) exist but return 404 until their feature
flag is enabled; the portal home has designed-in slots with empty states for them.

### ADR-027 — In-process domain-event dispatcher with per-consumer deliveries
2026-09-28 · Accepted (implements the consumer side of ADR-012)
Consumers (`src/lib/events/consumers.ts`) subscribe to event types. `dispatchPendingEvents()` materializes one
`domain_event_deliveries` row per (event × consumer), claims batches with `for update skip locked` plus a lease
(`locked_until`), runs handlers, and marks `processed_at` or records `last_error` with exponential backoff
(30 s → 1 h, 8 attempts). It is kicked with `after()` once every committed `defineAction` (and invitation acceptance)
has responded, and `/api/cron/dispatch-events` (Bearer `CRON_SECRET`, Vercel Cron; daily on Hobby — ADR-044) is the safety net.
Events older than 2 days when a consumer first sees them are skipped (no surprise backfills when a consumer is added).
Handlers are idempotent: `notify()` skips recipients that already have a notification for the same event and type.
*Rejected for now*: Supabase Database Webhooks / `pg_net` → Edge Function (needs the DB to call back into the app,
fragile locally and in CI — same reason as ADR-017) and an external queue (new infrastructure without a need yet).
The dispatcher's contract (claim → handle → ack) lets either replace the trigger later without touching consumers.

### ADR-028 — All notification fan-out lives in event consumers
2026-09-28 · Accepted
Producers only emit events; recipients are computed by consumers from the committed event and the database (service
connection, listed in CLAUDE.md §6). Messages/mentions, files, invitations, roles and requests all moved. Emails for
recipients with in-app disabled are not deduplicated on retry (accepted: rare, and better than dropping them).

### ADR-029 — Versioned request forms as JSON field definitions
2026-09-28 · Superseded by ADR-032
`request_form_versions.fields` holds an ordered array of typed fields (8 types, AR/EN labels). Published versions are
immutable (trigger) and requests keep the `form_version_id` they were answered with. A single Zod builder
(`buildAnswersSchema`) validates in the portal and in the server action. At most one draft per form; publishing freezes
it. *Rejected*: JSON Schema + a generic renderer (heavier, weaker bilingual labelling) and per-field tables (migrations for
every form change).

### ADR-030 — Request lifecycle rules enforced by triggers; SLA counted in working hours
2026-09-28 · Superseded by ADR-033 (triggers kept; SLA now in working days)
Status transitions, client-restricted columns (clients may only cancel; priority limited to normal/high at submit),
server-owned timestamps (`first_response_at`, `resolved_at`, SLA due dates), per-org numbering and history rows are
enforced in Postgres so crafted PostgREST writes can't bypass them. Changes made inside another trigger
(`pg_trigger_depth() > 1`, e.g. a client reply resuming a "waiting on client" request) are system changes. SLA
groundwork: form-level response/resolution hours counted on Sunday–Thursday in the org time zone (`app.sla_due`);
pausing while waiting on the client, business-hour calendars, holidays and breach alerts are Phase 5 (SLA policies).

### ADR-031 — Request conversations reuse `threads`, created by trigger
2026-09-28 · Accepted
Every request gets exactly one `threads` row (`subject_type = 'request'`, unique per request) created by an
`after insert` trigger, so client users without `portal_messages:send` still get a conversation. Internal notes are the
existing internal comments. General message lists show only `subject_type = 'client'` threads; request notifications
link to the request page. Attachments added at submission are `files` with `source = 'attachment'`, linked through
`request_attachments`.

### ADR-032 — Request types carry their brief form; requests keep a snapshot
2026-09-28 · Accepted
Revision 2 of Phase 2 replaces versioned `request_forms` with `request_types` (settings + `form_schema` JSON with 12
field types, AR/EN labels/help, required, `showIf` conditions on an earlier choice/checkbox/platform field). Every form
change bumps `schema_version` (trigger); a request copies the field list into `form_snapshot` when created and the
snapshot is frozen at submit, so later edits never break old briefs and the needs-info resubmit validates against what
the client originally saw. One validator (`validateBrief`) runs in the wizard, the submit/resubmit actions; hidden
fields are dropped. Long text is light Markdown rather than WYSIWYG. The migrations were rewritten in place because
Phase 2 had not been released.

### ADR-033 — Lifecycle per side, reasons through a transaction setting, per-client numbering
2026-09-28 · Accepted
Allowed transitions live in `app.request_transition_allowed(from, to, side)` and in `requestTransitions` (a unit test
parses the SQL to keep them identical). Clients: submit drafts, cancel while submitted/under review/needs info,
resubmit from needs info, close deliveries. Agency: triage moves need `requests:triage`; work moves are open to the
assignee with `requests:update`. Needs info and reject require a reason, passed by the action as the transaction-local
setting `app.transition_reason` so the trigger can both enforce it and store it in `request_status_history`.
References are `<PREFIX>-0001` per client (`clients.request_prefix`, default from the slug), assigned at submit under
an advisory lock. Due date = submit date + type SLA days on Sunday–Thursday.

### ADR-034 — Package consumption on acceptance, computed "extra" on submit
2026-09-28 · Accepted
A request counts against the package when the agency accepts it (not at submit), via one idempotent
`package_usage_entries` row per request written by `app.request_sync_usage`; rejecting, cancelling or marking it extra
removes the row. At submit the trigger computes `is_extra` from `app.request_quota` (allowed − used − pending of the
type's item); the client is warned in the wizard but may still submit. Agency can override extra/billable in triage.

### ADR-035 — Drafts are private to their author
2026-09-28 · Accepted
Drafts are saved server-side (resume from any device) but RLS shows them only to their author: not to teammates at the
client and never to the agency, which sees a request only once it is submitted. Drafts have no number, due date or
thread; only the author can delete one.

### ADR-036 — Task statuses are organization-defined; behaviour keys off a fixed category
2026-09-29 · Accepted
Agencies rename, add and reorder task statuses (`task_statuses`), but every status belongs to one of six categories
(`todo · active · review · changes · blocked · done`). Completion stamps, unblocking notifications, My Work buckets,
"due soon" reminders and the deliverable ↔ task sync use the category, never a status name. The category is copied onto
`tasks.status_category` by trigger for fast filters. At least one `done` status must exist (deferred constraint trigger).

### ADR-037 — Workflow steps carry review/approval flags instead of being separate review tasks
2026-09-29 · Accepted
A template step says whether it produces a deliverable and whether that deliverable needs internal review and/or
client approval; "Internal review" and "Client approval" are stages of the deliverable, not tasks of their own. So the
Social post example becomes Copywriting → Design (internal review + client approval) → Scheduling, and the request page
still shows the review stages. *Rejected*: explicit review steps — they duplicate state (a review task and a deliverable
status that must agree) and need auto-completion rules. "Convert to tasks" runs in one transaction: accept the request
if needed (package consumption, ADR-034) → one task per step with dependencies, assignee (client account manager / the
client-team member with a role, preferring the step's department / a fixed person), reviewer (client account manager),
due dates chained in working days (`scheduleSteps`) → deliverables → request `in_progress`; `converted_at` makes it
one-off. Tasks are numbered per organization (`T-123`).

### ADR-038 — The approval state machine lives in triggers; the task and the request follow the deliverable
2026-09-29 · Accepted
Submitting a version is an update to `status` that the trigger turns into the first stage the deliverable needs;
decisions are rows in `approvals` (insert-only, one per stage per version) whose trigger moves the version, the
deliverable (`in_progress → internal_review ⇄ internal_changes → client_review ⇄ client_changes → approved`), the
task's status category, and — when every deliverable of the request is approved — the request to `delivered` (a
system transition in `request_status_history`). Feedback is required for "changes requested". A new version restarts
the review; undecided older versions become `superseded`, decided ones keep their decision for the history. The TS
mirror (`submitTarget`, `applyDecision`) is unit-tested; the SQL is tested in `tests/db/rls-tasks.test.ts`.

### ADR-039 — Client revision rounds count against the package, with a warning, never a block
2026-09-29 · Accepted
Each client "changes requested" writes one `package_usage_entries` row (`revision_round`, `source_type = 'approval'`)
into the client's current package and increments `deliverables.revision_rounds`. The portal shows how many rounds are
left before the client sends feedback and warns when they're used up, but still lets them ask (the agency decides on
billing). Internal changes never count.

### ADR-040 — Deliverable files: resumable uploads to signed URLs, visible to the client only through a sent version
2026-09-29 · Accepted
Deliverable files are `files` rows with `source = 'deliverable'` and `visibility = 'internal'`; `files_select` lets a
client user read one only when it belongs to a version with `sent_to_client_at`, so nothing leaks before the internal
review and nothing appears in the client's files library. Uploads use TUS (6 MB chunks, retries, resume after a
reload via a stored ticket) against Supabase Storage's `/upload/resumable/sign` with the server-issued signed token, so
the server still chooses every path (ADR-020) and files never pass through Next.js. The browser makes the preview (a
640px WebP for images, the ~1 s frame for videos) and uploads it next to the file; the server records dimensions and
duration. Limits: images 50 MB, videos 2 GB (bucket raised to 2 GB), documents 100 MB.

### ADR-041 — Tasks always belong to a client; internal collaboration reuses existing building blocks
2026-09-29 · Accepted
`tasks.client_id` is required, so every task inherits the client-access rules (`agency_can_access_client`) and
specialists only see work for their clients; internal agency work (not tied to a client) is deferred. Task comments are
an internal `threads` row per task (`subject_type = 'task'`) reusing the messaging UI, @mentions and read receipts;
task-thread notifications go to the task's assignees, watchers, reviewer and commenters, and any agency member can be
mentioned. Time tracking is internal (`time_entries`, one running timer per person, only your own entries, everyone's
with `time:read_all`).

### ADR-042 — Annotations are their own threads, positioned on the picture, internal until the client sees the version
2026-09-29 · Accepted
`annotations` (+ `annotation_replies`) store a point as fractions of the image (0–1, physical left/top, so pins land on
the same spot at any zoom or page direction), a video moment in seconds, or a general comment. Agency annotations are
forced internal while the version hasn't been sent; client annotations are always client-visible and allowed only
while the version awaits them. Kept separate from `threads/comments` because they're positional, per version and
resolvable.

### ADR-043 — Time-based reminders come from a sweep that emits events
2026-09-29 · Accepted
Due soon (today/tomorrow), overdue and "still waiting for your approval" (every `organizations.approval_reminder_days`,
default 2) are emitted as domain events by `runReminderSweep()` from the cron route (before the dispatcher; daily
on the Hobby plan — ADR-044), with per-task/per-deliverable markers so each reminder fires once. It uses the service connection because
it scans every organization (listed in CLAUDE.md §6); notifications still come only from consumers (ADR-028).

### ADR-044 — Daily safety-net cron on the Vercel Hobby plan
2026-09-29 · Accepted
The `centralteam` Vercel project is on the Hobby plan, which only allows daily cron jobs, so `vercel.json` runs
`/api/cron/dispatch-events` once a day at 05:00 UTC (08:00 Riyadh). Events are still dispatched right after each
action (`after()`), so notifications stay immediate; what slows down is the retry of events that failed to dispatch
and the reminder sweep (due soon/overdue/approval reminders arrive with the morning run). On the Pro plan, restore
`*/5 * * * *` (or call the route from an external scheduler with `CRON_SECRET`).

### ADR-045 — Production migrations run in the Vercel build
2026-09-29 · Accepted
The Vercel ↔ Supabase integration stores the database connection strings as sensitive variables that only Vercel
builds and functions can read, so `vercel.json` runs `pnpm db:deploy` before `next build`. `scripts/deploy-db.ts`
applies pending files from `supabase/migrations` (production builds only), recording them in
`supabase_migrations.schema_migrations` like the Supabase CLI, and loads the demo seed (`supabase/seed.sql`, then
`scripts/seed.ts`) once when `SEED_ON_DEPLOY=1` and no auth user exists. The app accepts the integration's `POSTGRES_URL*` names
(`src/lib/db/url.ts`). The demo seed on the public URL is a deliberate, temporary choice by the owner: turn
`SEED_ON_DEPLOY` off and remove or re-password the demo accounts before real client data goes in.

### ADR-046 — App claims are mirrored into app_metadata
2026-09-29 · Accepted
On hosted Supabase the custom access token hook (ADR-014) must be switched on in the dashboard; until it is, tokens
lack `app` and every sign-in is refused. Triggers on `organization_members` and `profiles.onboarded_at` now also
write the same claims (`app.app_claims_for`, identical logic to the hook) into `auth.users.raw_app_meta_data.app`,
which Supabase puts in every token as `app_metadata.app`. `readAppClaims` prefers the hook's `app` and falls back to
the metadata. App metadata is writable only by the service role, so it is as trustworthy as the hook. Keep the hook
enabled where possible (it reflects changes on the next refresh without relying on the triggers).

### ADR-047 — Metrics are entered by hand or imported from CSV until Phase 7
2026-09-29 · Accepted
Live ad-platform APIs come with the integrations phase, so Phase 4 takes numbers two ways: a week-at-a-time grid per
channel, and CSV imports of the platforms' own daily exports. `src/modules/campaigns/csv.ts` parses in the browser
(delimiter, BOM, report-title rows, totals rows, Arabic digits, thousands/decimal separators, day/month order) and
recognises Meta, TikTok, Snapchat and Google exports by their headers; the user can fix the column mapping and date
order before importing. The server re-validates the rows with Zod and upserts one row per channel per day, so
re-importing a period replaces it; `metric_imports` keeps the trail. `metrics_daily.source` already allows `api` and
`campaign_channels.external_ref` holds the platform id for the Phase 7 sync.

### ADR-048 — `metrics_daily` is a plain table (no partitioning yet)
2026-09-29 · Accepted
The forward sketch planned monthly partitions. With manual/CSV entry the volume is one row per channel per day —
tens of thousands of rows a year for an agency this size — which a unique (channel, date) index and (campaign, date)
/ (client, date) indexes serve comfortably, and Drizzle has no first-class partition support. Revisit when API sync
adds ad-level or hourly rows.

### ADR-049 — Published reports are snapshots; PDF comes from the browser's print
2026-09-29 · Accepted
Drafts compute numbers live; publishing stores everything the report shows (`reports.snapshot`: totals, previous
period, campaign KPIs and pacing as of the period end, channels, daily series, creatives) so a later correction to
the metrics never changes what the client already read. Taking a report back to draft clears the snapshot. PDF is
the browser's "Print / Save as PDF" on the report page — print CSS hides the app shell and forces light tokens —
because server-side PDF engines shape Arabic poorly and add heavy dependencies; emails link to the portal page
instead of attaching a file. Scheduled reports (weekly Sunday–Saturday or monthly) are created by the daily sweep as
drafts for the owner to review, or published directly when the schedule says so.

### ADR-050 — Charts are plain SVG on validated palette tokens
2026-09-29 · Accepted
No chart library: the few forms needed (trend lines, channel bars, pacing meters) are small SVG/HTML components
that follow the dataviz rules — one y-axis (a trend shows one metric; reports draw one chart per metric), 2px
lines, legend for 2+ series with direct end labels up to four, crosshair tooltip on hover and arrow keys, and a table
view. `--chart-1…8` hold the reference categorical palette in fixed order with separate dark steps; validated against
our surfaces (`#ffffff`, `#161a22`): all checks pass in both modes, three light slots sit below 3:1 contrast, which
the legend/labels/table view relieve. Channels keep their slot across charts. Arabic time axes run right to left.
Compact numbers ("25K", "25 ألف") are built from translations rather than `Intl` `notation: 'compact'`, and bidi marks
are stripped from formatted values, because Node's and the browser's ICU disagree on both and break hydration.

### ADR-051 — Pacing and health are computed in TypeScript and cached on the campaign
2026-09-29 · Accepted
The rules (DATA_MODEL §3e: volume KPIs projected to the end of the flight, costs inverse, rates as is, ±15 % budget
pacing, worst status wins) live once in `metrics.ts` and run on the server (list, detail, snapshots, sweep) and in
the browser (charts). Lists read `campaigns.health`, refreshed after every metric/KPI/budget change and by the daily
sweep. The cache is written only through `app.campaign_store_health()` (security definer, requires
`metrics:manage` or `campaigns:manage`; direct updates of the cache columns are ignored by the trigger), which also
records the health last alerted so "at risk / off track" notifies the owner once per slip.

### ADR-052 — SLA policies are matched by specificity and applied once, at submit
2026-09-29 · Accepted
`sla_policies` carry optional criteria (client, request type, priority) and targets (first reply in business hours,
delivery in working days, or the type's own `sla_days`). When a request is submitted the most specific active policy
wins (client 4 + type 2 + priority 1, ties by `sort_order`) — `app.sla_policy_for` in SQL, `matchPolicy` in TS, kept
identical by a DB test. The trigger `requests_sla` stores `sla_policy_id` and `response_due_at` and computes
`due_date`, which stays the delivery target, so the Phase 2 SLA badge, inbox sort and portal "expected on" keep working.
Targets are a snapshot: editing or deleting a policy never moves requests already submitted (the FK is `set null`).
SLA columns are server-owned (user writes are reset by the trigger). *Rejected*: evaluating the policy on read (targets
would silently change under people) and a policy per request type only (no client-specific promises).

### ADR-053 — One working calendar: Sunday–Thursday, org business hours, holidays; SQL is the source of truth
2026-09-29 · Accepted
Working days stay Sunday–Thursday (the Saudi week, CLAUDE.md §7); `holidays` removes dates (Saudi public holidays and
agency days off are seeded) and `organizations.business_hours_start/end` (minutes after midnight, default 09:00–17:00)
bound reply targets. `app.org_add_working_days`, `app.org_working_days_between` and `app.org_add_business_hours` compute
targets in the org time zone; `src/modules/sla/calendar.ts` mirrors them for previews and live states, and a DB test
compares both on a grid of instants, holidays included. Business hours are changed through `app.set_business_hours`
(security definer, requires `sla:manage`) because `organizations`' update policy needs `organization:update`.
Configurable working days and per-client calendars are deferred.

### ADR-054 — Waiting on the client pauses delivery; the due date moves on resume
2026-09-29 · Accepted
Under a policy with `pause_on_client`, entering Needs info stamps `sla_paused_at`; leaving it adds the working days spent
waiting to `due_date` (unless the same statement changed the date by hand), accumulates `sla_paused_days` and logs the
move as a *system* `due_date_changed` event (visible to the client: "the date moved because we waited on you").
While paused the resolution state is `paused` (no alerts). The reply target isn't paused: asking for information is
itself the first response.

### ADR-055 — Live SLA states on read; the sweep records breaches once and alerts
2026-09-29 · Accepted
Every screen computes response / delivery states from the request row at render time (`responseState`, `slaState`), so
the monitor and dashboard are right even between sweeps. `runSlaSweep()` (cron, service connection — listed in
CLAUDE.md §6) writes `sla_breaches` once per request × kind × level (unique index; no at-risk row once breached), emits
`sla.at_risk` / `sla.breached`, and marks rows resolved when the reply or delivery arrives or the request ends. The
consumer notifies the assignee (at risk) or the assignee + account manager + the policy's escalation contact
(breached) in the new `sla` notification category (agency only). People may only acknowledge a breach with a note
(column grant + trigger stamps who/when). On the Hobby plan the sweep runs daily (ADR-044), so alerts can lag by up to a
day — the live states don't; restore a 5-minute schedule on Pro.

### ADR-056 — Operations views are RLS-scoped read models; client health is a transparent penalty score
2026-09-29 · Accepted
The ops dashboard, Client 360 and team pages are grouped queries in `src/modules/operations/server/queries.ts` run with
`withRls`, so every number is limited to the clients the viewer can access (an account manager's "all clients" is their
own). No materialized views or cached counters: the volume (hundreds of open items) doesn't need them and freshness
matters more. Client health = 100 minus capped penalties (past SLA 15 each up to 45, off-track campaigns 15/30,
overdue tasks 4/20, unanswered conversations 5/15, approvals waiting past the reminder interval 5/15, recent breaches
3/15, at-risk SLA 5/15, at-risk campaigns 5/10); ≥ 80 healthy, ≥ 55 watch, else at risk; the reasons shown are the
costliest signals. *Rejected*: an opaque weighted model — the team needs to see why a client is flagged.

### ADR-057 — `operations:read` and `sla:manage`
2026-09-29 · Accepted
`operations:read` (Super Admin, Admin, Account Manager, Team Lead) shows the ops dashboard, `/team`, the SLA monitor and
Client 360; people without it keep the personal dashboard. `sla:manage` (Super Admin, Admin) edits policies, business
hours and holidays. Policies and holidays are readable by every agency member (targets appear on requests); breaches
need request access, and acknowledging needs `operations:read` or `requests:triage`. None of the SLA tables reach the
portal; the request list returns response targets only when the viewer can read the policy.

### ADR-058 — CRM ownership model and RLS
2026-09-30 · Accepted
Leads, deals and their children (contacts, activities, files, quotes) are agency-only tables. Reading needs
`leads:read` / `deals:read`; writing needs `leads:manage` / `deals:manage` **and** being the owner, or the record being
unassigned; `crm:manage_all` writes anyone's (reassign, merge, delete). Settings (pipelines, forms, rules, targets,
webhook tokens, stale days, onboarding workflow) need `crm:admin`. The checks live in `app.crm_can_write()` /
`app.can_write_deal()` / `app.can_write_lead()`, so the UI's "can edit" comes from the same SQL. Two seeded roles:
**Sales Manager** (all CRM rights, can create clients) and **Sales Rep** (own leads and deals); Account Managers read
the pipeline. Deal status, probability and won/lost stamps are derived from the stage by a trigger (losing requires a
reason; a converted deal stays won), and every stage change writes `deal_stage_history` for conversion metrics.
*Rejected*: per-client visibility for sales data — leads aren't clients yet, and a small sales team works one
shared pipeline.

### ADR-059 — Capacity demand model
2026-09-30 · Accepted
Capacity and demand are hours per department per week (Sunday–Saturday) for 8 weeks. Capacity is each member's
hours/week (default 40) × working days ÷ 5, minus org holidays and time off; someone in two departments is split
evenly. Demand has three parts: (1) open tasks with an estimate and a due date, spread over their working window
(overdue work lands this week); (2) package work, from a per-item **service effort** matrix (e.g. one reel = 4h video
+ 1h content), for what is left of the current period and then the full package while the client stays active;
(3) open deals with a target package, weighted by probability from their expected close. To avoid counting the same
work twice, a client's package demand in a department and week only counts what that client's scheduled tasks there
don't already cover (package work is a floor, not an addition). Levels: ≥ 85% tight, > 100% over. The simulator adds a
package at 100% from a chosen week. The maths is pure (`src/modules/capacity/calc.ts`) and runs in the browser for the
simulator. *Rejected*: time-tracking-based forecasts (too little history yet) and per-person scheduling.

### ADR-060 — Capacity readers are numbers-only definer functions
2026-09-30 · Accepted
Planning needs every estimated task, active package and weighted deal, even those the planner's own RLS hides (a team
lead can't read the pipeline; a sales manager doesn't see every task). `app.capacity_tasks`, `app.capacity_packages`
and `app.capacity_deals` are `security definer` functions that raise `42501` without `capacity:read` and return only
ids, dates, estimates, quantities and probabilities — no titles, names, notes or deal values. *Rejected*: the service
role in the page query (not an allowed service path) and widening task/deal RLS.

### ADR-061 — Won → client runs as the caller
2026-09-30 · Accepted
"Turn into client" is one transaction under the caller's RLS: client (+ account manager, team, default folders and
general thread) → package for today + 30 days → portal invitation to a chosen contact → onboarding request converted
to tasks through the workflow template in Sales settings → deal linked to the client (`deal.converted`). It needs the
same rights as doing each step by hand, so the Sales Manager role also holds `clients:create/update`,
`client_users:manage`, `packages:assign`, `requests:triage`, `tasks:create/update`, `files:upload` and
`messages:send`. Before starting, the action checks what the chosen workflow needs (deliverable steps also need
`deliverables:manage`) and fails with `onboarding_not_permitted` rather than a bare "forbidden". The seeded onboarding
workflow is five plain internal tasks, so a Sales Manager can run it; an agency that adds deliverable steps either
grants that right or leaves onboarding to an account manager. Sales Reps can't convert. *Rejected*: running the
conversion with the service role, which would let anyone with `clients:create` bypass every other check.

### ADR-062 — Public lead form: embeddable, signed, rate-limited
2026-09-30 · Accepted
`/f/[token]` is public and the only embeddable route (`frame-ancestors *`, no `X-Frame-Options`; everything else stays
`frame-ancestors 'none'`). Spam protection without a captcha: a hidden honeypot field, an HMAC-signed load-time ticket
(`FORM_SIGNING_SECRET`, falls back to the Supabase secret) that must be 3 seconds to 6 hours old, and rate limits of 5
submissions per IP per 10 minutes and 200 per form per hour. Submissions go through `ingestLead()` with the service
connection (listed service path, CLAUDE.md §6): the visitor has no session. The form speaks the visitor's language.
*Rejected*: a third-party captcha (another processor of visitor data, and blocked on some networks).

### ADR-063 — Inbound lead webhook contract (for Phase 7)
2026-09-30 · Accepted
`POST /api/webhooks/leads` with `Authorization: Bearer <token>`; tokens are created in Sales settings, shown once, and
stored as SHA-256 hashes (revocable, last use recorded). The body is the snake_case contract in ARCHITECTURE §21
(`external_ref` required). Replays with the same `source` + `external_ref` return `200 {duplicate: true}` without a
new lead; a new external lead matching an existing phone/email becomes an activity on that lead. Phase 7 connectors
(Meta lead ads, WhatsApp, TikTok) will call the same `ingestLead()` instead of the HTTP endpoint.

### ADR-064 — Duplicates and merge
2026-09-30 · Accepted
Phones are normalised to E.164, Saudi-first (`05…`, `5…`, `9665…`, `009665…`, Arabic-Indic digits all become
`+9665…`; landlines `01x…` become `+9661x…`); emails are lower-cased (also by trigger). A duplicate is any non-merged lead sharing the phone or the email.
Creating shows a warning; form and webhook repeats become an activity on the existing lead. Merging (`crm:manage_all`)
keeps the primary's values, fills its gaps from the other, unites services and tags, keeps the furthest status, moves
activities and deals, and marks the other `merged` (kept for the audit trail, hidden from lists).

### ADR-065 — Quotes
2026-09-30 · Accepted
Quote numbers and totals are server-owned: `app.quote_recalculate()` rounds each line (quantity × unit price, in
halalas) and subtracts the discount; client-sent totals are ignored. Only drafts can be edited or deleted; sent,
accepted and declined quotes are history. A quote prints in **its own** language and direction (chosen per quote), not
the viewer's, through the same print stylesheet as reports ("Print / PDF", ADR-049). Line items can come from a
package (name and price copied at the time) or free text. Prices exclude VAT unless stated.

### ADR-066 — Sales reminders and notifications
2026-09-30 · Accepted
`runCrmSweep()` runs with the other sweeps from the cron route (service connection, listed path): an open activity due
before the end of today (org time zone) is announced once (`reminded_at`, cleared when it is rescheduled), and an open
deal with no completed activity for `crm_settings.stale_days` (default 7) is announced once per quiet spell
(`stale_notified_at`). Notifications come from the `notifications.crm` consumer in a new **sales** category that
client users never see: lead assigned (new owner), follow-up due (owner), deal gone quiet (owner, else sales
managers), deal won (sales managers and owner). Scheduled activities don't count as contact; completed ones move a
new lead to contacted.

### ADR-067 — Integration tokens in Supabase Vault, OAuth state bound to a nonce
2026-09-30 · Accepted
Platform tokens (access, refresh, expiry) are one JSON secret per connection in **Supabase Vault**; no table has a token
column. `integration_secrets` maps a connection to its Vault id and has RLS on, no policies and no grants.
`app.integration_put_secret` (service path, or a member with `integrations:manage` — write-only),
`app.integration_get_secret` and `app.integration_drop_secret` (service role only) are the only way in; deleting the
mapping deletes the Vault entry. Service-path writes set the caller's id in the JWT claims (role unchanged) so the audit
trail names who connected or disconnected. OAuth: the server signs a `state` (organization, user, provider, mode,
optional connection to reconnect, nonce, 10-minute expiry, HMAC with `INTEGRATIONS_SIGNING_SECRET`, falling back to the
Supabase secret) and sets the nonce in an httpOnly cookie scoped to `/api/integrations`; the callback accepts the code only
when both match, the signed-in user is the one who started, and they still hold `integrations:manage`. Re-authorizing the
same platform user reuses the connection and its mappings. Integration token storage, platform sync, webhook processing
and WhatsApp sends are listed service paths (CLAUDE.md §6).
*Rejected*: encrypted columns with an app-held key (key management moves into the app and the key sits next to the data).

### ADR-068 — One provider interface with a deterministic sandbox
2026-09-30 · Accepted
Every platform implements `IntegrationProvider` (authorize / exchange / refresh / identify / accounts / campaigns / daily
metrics / lead fetch / WhatsApp templates and sends / revoke). Live adapters call the documented HTTP APIs (Meta Graph,
WhatsApp Cloud API, TikTok Business v1.3, Snapchat Marketing v1, Google Ads REST + Analytics Admin); a **sandbox** adapter
per platform returns fixed accounts and templates and daily numbers that are a pure function of (campaign, day), plays
the OAuth consent (`/integrations/sandbox/authorize`, with a 2-minute token option to see expiry) and the WhatsApp status
webhooks. The sandbox is always on outside production and in production only with `INTEGRATIONS_SANDBOX=1`; sandbox
connections are labelled everywhere. A platform without its environment variables shows "not configured" with the
missing names. Health: `connected · expiring (≤ 7 days) · expired · error · disconnected`; an expired or revoked token
(or a refresh that fails) marks the connection expired once and tells everyone with `integrations:manage`.
The live adapters could not be exercised without developer apps and network access from the build sandbox; they are
written against the platforms' documented contracts and are the first thing to verify when credentials arrive.

### ADR-069 — Metric sync: per channel and day, idempotent, API wins; signed webhooks
2026-09-30 · Accepted
Mapping is two steps: ad account → client, then platform campaign → one of that client's campaign channels (trigger-
enforced; several platform campaigns may feed one channel and are summed). A sync pulls a date range per sync-enabled
account and upserts `metrics_daily` on (channel, day) with `source = 'api'`; every day of the range inside the flight is
written (zeros when the platform has no row), so re-running a range — scheduled overlap, retries, backfills — gives the
same rows and corrects days the platform restated. A linked channel's numbers belong to the platform: manual or CSV
numbers for those days are replaced. No currency conversion: accounts are expected in SAR (the account currency is
shown). Scheduled runs re-pull the last 3 days daily (late attribution); backfills ≤ 90 days; a failed run retries after
15 min and 1 h (3 attempts), auth / permission errors are final, and a final failure notifies the managers.
Inbound webhooks (`/api/hooks/[provider]`) are verified before parsing: Meta and WhatsApp `X-Hub-Signature-256`,
TikTok `TikTok-Signature` (timestamped, 5-minute window), Snapchat `X-Snap-Signature`, Google's `google_key`, sandbox
`X-Central-Signature`. Rejected deliveries are logged without their body. Accepted items are stored deduplicated on the
platform's id (a replay inserts nothing), processed after the 200 and retried by the sweep. Lead ads go through
`ingestLead()` as source `lead_ad` with `external_ref = <provider>:<lead id>` (the ADR-063 contract), so assignment
rules and phone / email dedup apply. The TikTok and Snapchat payload and signature formats follow their documentation
and must be confirmed in their developer consoles.

### ADR-070 — WhatsApp: approved templates only, explicit opt-in per person and category
2026-09-30 · Accepted
Business-initiated WhatsApp messages must use approved templates, so the app sends only templates synced from the
WhatsApp Business account. Notifications go through one template per language marked "for notifications" (two variables:
title, then text + link). A person receives WhatsApp notifications only after opting in with their number and an explicit
consent (stored with the time; opting out keeps the row) **and** switching the category on — both off by default; the
channel is agency-only. `notify()` sends WhatsApp alongside in-app and email; a failure never blocks the other channels.
Sales reps (`whatsapp:send`) can send any approved template to a lead or a deal's primary contact from its page; every
message is logged with its delivery status, which only moves forward (`sent → delivered → read`, `failed` terminal once
sent) because status webhooks arrive out of order, and is recorded as a WhatsApp activity. Inbound messages are logged
but not shown (deferred).

### ADR-071 — Automation engine: a dispatcher consumer with run records and a loop guard
2026-09-30 · Accepted
A rule = one trigger from a curated catalog of `domain_events` types (each with the fields its conditions may test) +
conditions (all / any) + up to 10 ordered actions (notify, assign round-robin, create task, change status within the
lifecycle rules, send a WhatsApp template, HTTPS webhook signed with a per-organization HMAC key). The engine is one more
event consumer (`automations.engine`, ADR-027/028): it reloads the record the event is about, evaluates the saved rule
(re-validated with Zod) and runs actions with the service connection. Runs are unique per (rule, event); a failing action
stops the run and makes the dispatcher redeliver with backoff, completed actions are skipped on the retry, and after 3
attempts the run is failed for good and `automation.failed` notifies the rule managers. Loop protection: events emitted by
actions carry `automation_depth + 1` and the chain of rules that caused them (AsyncLocalStorage in `emitEvent`, users
can't forge the columns); depth ≥ 3 or a rule already in the chain → skipped; more than 100 runs of a rule in an hour →
skipped. A dry run evaluates the saved rule on a real recent event and records what each action would do, with no side
effects. Webhook actions refuse non-HTTPS URLs, credentials in URLs and private / loopback / link-local / CGNAT addresses
(checked again after DNS), don't follow redirects and time out after 10 s.
*Rejected*: running actions as the rule's author (their permissions change over time, and system events have no author).

### ADR-072 — Integration and automation permissions
2026-09-30 · Accepted
`integrations:read` (see connections, the sync log and webhooks), `integrations:manage` (connect, map, sync, disconnect,
pick the notification template), `automations:read`, `automations:manage` (rules act across the whole organization, so
the dry-run event picker is limited to them), `whatsapp:send`. Grants: Super Admin / Admin all; Account Manager
`integrations:read`, `automations:read`, `whatsapp:send`; Team Lead the two reads; Sales Manager `integrations:read`,
`automations:read`, `automations:manage`, `whatsapp:send`; Sales Rep `whatsapp:send`. Everything is agency-only; clients
only ever see the synced numbers through their existing campaign pages. Flag `module.integrations` (on).


### ADR-073 — AI behind one provider interface with a deterministic mock; Claude + Voyage live
2026-09-30 · Accepted
Every model call goes through `AiProvider` (`complete` for text, `embed` for vectors). The live provider uses Anthropic's
Claude through the official `@anthropic-ai/sdk` (Messages API, model from `AI_MODEL`, default `claude-opus-5-5`, effort set
per purpose, server-side refusal fallback `fallbacks: "default"`) and Voyage AI for embeddings (`voyage-3.5`, 1024
dimensions, multilingual — Anthropic has no embedding endpoint). A **mock** provider composes answers and drafts from the
facts and sources it is given and embeds text with feature hashing (1024 dimensions, Arabic-aware tokenization), so the
whole phase runs, demos and is tested without keys: always outside production, in production only with
`AI_PROVIDER=mock`. Without keys and without the mock, AI features show "not configured"; the deterministic parts
(detectors, recommendations) keep working. Each call records purpose, model and tokens in `ai_usage`; an organization's
monthly token budget stops further calls with a translated message; the assistant is rate-limited per user.
*Rejected*: calling a provider from components or actions directly (no single place for budgets, redaction, logging
and tests); an OpenAI-compatible shim (loses refusal handling and typed errors).

### ADR-074 — Insights are computed by code; the model only explains
2026-09-30 · Accepted
Anomalies, KPI / budget pacing and delivery stops are pure detectors over `metrics_daily` and the Phase 4 campaign
analysis: a robust z-score (median / MAD of the trailing 14 days, ≥ 7 days of history) with a minimum relative change
(30 %) and minimum volume, thresholds by sensitivity (low 4 · normal 3 · high 2.5; ≥ 2× → critical); a move in the good
direction is `info`, in the bad direction `warning`. Recommendations are rules with computed impact (e.g. move 20 % of a
channel's daily spend to the channel whose CPL is ≥ 25 % lower → expected extra leads per day). Titles and bodies render
from translations with the stored facts, so every insight exists in Arabic and English, costs nothing and never
contains a number the platform didn't compute. "Explain" asks the model for a short narrative from the same facts,
cached per insight and language. Detection runs as the `ai.analysis` consumer after metrics change and daily from the
cron; it is idempotent per dedupe key, auto-resolves cleared conditions and reopens them when they return.
*Rejected*: asking the model to find anomalies in raw numbers (non-deterministic, untestable, can invent figures).

### ADR-075 — Permission-aware retrieval through the sources' own RLS
2026-09-30 · Accepted
The assistant searches `ai_chunks` **inside `withRls`**. The table's SELECT policy requires `ai:use` and
`app.ai_source_visible(source_type, source_id)`, a `security invoker` SQL function that checks the source row exists
*as the caller* — so the clients, campaigns, requests, tasks, reports, leads, deals and insights tables' existing policies
decide, and a chunk can never be more visible than the record it came from (assigned clients, agency-only CRM, internal
rows). The index is written by the service path (indexer consumer + daily catch-up); a deleted source's chunk is removed
by the indexer and is invisible meanwhile because the policy finds no source row. The model sees only the top-k chunks
the user could read, numbered; the answer's `[n]` markers are validated against them and rendered as links to the
source pages, which enforce RLS again. Agency-only in Phase 8 (the same design would serve the portal later).
*Rejected*: a denormalized ACL column on each chunk (drifts from the real rules on every assignment change).

### ADR-076 — Data minimization for AI (PDPL)
2026-09-30 · Accepted
Indexed text has phone numbers and e-mail addresses redacted before it is stored, embedded or sent; prompts carry only
the retrieved snippets and computed facts, never whole tables or files. AI is an organization-level switch (off = no
model calls) that the owner turns on after accepting where the providers process data (Anthropic and Voyage process in
the US; see open question 6). Conversations are private to their author. Usage is logged without prompt text.

### ADR-077 — AI-drafted report text is a draft
2026-09-30 · Accepted
"Draft with AI" fills the commentary or next-steps section of a **draft** report in the report's language, grounded on
the report's own snapshot (totals vs the previous period, KPIs, budget, channels) and the period's open insights. The text
lands in the editor, unsaved, for the team to edit; publishing stays a human action. Scheduled report drafts can get AI
commentary automatically (`ai_settings.auto_draft_reports`, off by default); they are still drafts that notify the team.

### ADR-078 — AI permissions and visibility
2026-09-30 · Accepted
`ai:use` (assistant, report drafts, explanations) for every agency role; `ai:manage` (settings, usage, rebuild index) for
Super Admin and Admin. Insights and recommendations follow campaign access: read with `campaigns:read` on the client,
acknowledge / dismiss / accept with `campaigns:manage`. Flag `module.ai` (on). Nothing in Phase 8 is visible to client
users. Notifications: `ai_insight` (category `ai`) to the campaign owner and the client's account managers for warning
and critical insights.

### ADR-079 — Post-commit `complete` step in `defineAction`
2026-09-30 · Accepted
AI actions need an RLS-checked lookup (can this user see the insight / report / conversation?) and then a model call that
can take tens of seconds. Holding the RLS transaction open during the call would pin a pooled connection (5 per function
in production) and risk idle-in-transaction timeouts. `defineAction` therefore accepts an optional `complete` step: the
handler does the checked reads and writes in the transaction and returns what it prepared; after commit `complete` runs
with that and its return value (or failure) becomes the action's result. Writes in `complete` go through a fresh
`withRls` or a listed service path, and events they emit are dispatched like the handler's.
*Rejected*: raw Server Actions for AI (bypass validation, permission and error mapping); streaming route handlers
(deferred with streaming answers).
---

## Open questions (still open — defaults in use shown in brackets)

1. **Brand**: agency name in Arabic and English? Product name? [product "Central / سنترال"; seed agency "Ofoq Marketing Agency / وكالة أفق للتسويق" — fully editable in Agency settings]
2. **Logo**: PNG/WebP logo (SVG is not accepted for security)? [letter mark until uploaded in Agency settings]
3. **Colors**: Proposal A (Najd Indigo), B (Palm Teal), or existing brand colors (hex)? [A; the portal already uses the per-agency brand color from settings]
4. **Domain**: which domain/subdomains? (Suggested: `app.<domain>` for everything, portal at `/portal`; or
   `portal.<domain>` for clients.) Is `*.vercel.app` reachable on your network for preview deployments?
5. **Email**: sending domain and from-address (e.g. `no-reply@<domain>`)? Do you have a Resend account, or should
   I plan DNS records (SPF/DKIM/DMARC) for you to add?
6. **Hosting region / data residency**: any PDPL/client contract requirement to keep data in KSA or GCC? This
   determines the Supabase region (or self-hosting) — Vercel functions region should match.
7. **Numerals & calendar**: Latin digits (123) + Gregorian by default with Hijri optional — OK? Or Arabic-Indic
   digits (١٢٣) in the Arabic UI? [Latin + Gregorian, Hijri per-user preference — implemented]
8. **Roles**: are the default permission grants in `DATA_MODEL.md §2` right? In particular: may Account Managers
   invite client users? Should Team Leads see all clients or only their department's work?
9. **Accounts**: Supabase and Vercel accounts/org — should I prepare everything to run locally and hand over deploy
   steps, or will you provide project access for staging?
10. **Seed personas**: any real department names/people you want in demo data, or keep fictional?
