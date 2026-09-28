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
has responded, and `/api/cron/dispatch-events` (Bearer `CRON_SECRET`, Vercel Cron every 5 min) is the safety net.
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
