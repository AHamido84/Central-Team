# Roadmap

Legend: `[ ]` todo · `[x]` done. Update checkboxes in the same PR that completes the work.

## Phase 0 — Foundation (done — pending items below need the owner / hosting)

### 0.1 Planning
- [x] `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/UI.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`
- [ ] Owner answers open questions (brand, logo, colors, domain, email, region) — defaults applied meanwhile, see DECISIONS "Open questions"

### 0.2 Project scaffold & tooling
- [x] Next.js 16 + TypeScript strict + pnpm; `src/` layout; path aliases
- [x] Tailwind v4, shadcn/ui init, lucide-react, Framer Motion, next-themes
- [x] ESLint flat config (logical-properties rule, no importing other modules' `db/`, no hardcoded JSX strings), Prettier
- [x] Husky + lint-staged + commitlint (Conventional Commits)
- [x] Vitest (unit + db projects), Playwright config
- [x] `.env.example`, env validation with Zod (`src/lib/env.ts`)
- [x] GitHub Actions CI: lint → typecheck → unit → Supabase up → db tests → build → e2e
- [x] Security headers + CSP in `next.config` / proxy

### 0.3 Database foundation
- [x] Supabase CLI local stack, `config.toml` (sign-up disabled, hooks, Mailpit, redirect URLs)
- [x] Drizzle config → `supabase/migrations` (supabase prefix), schema barrel
- [x] `app` schema, `updated_at` trigger, generic `app.audit_trigger`
- [x] Tables: organizations, profiles, organization_members, clients (minimal)
- [x] Tables: permissions, roles, role_permissions, user_roles, user_permission_overrides
- [x] Tables: departments, department_members
- [x] Tables: invitations, rate_limits
- [x] Tables: feature_flags, organization_features
- [x] Tables: domain_events, domain_event_deliveries, activity_log
- [x] Tables: notifications, notification_preferences (+ realtime publication)
- [x] Functions: `is_org_member`, `is_agency_member`, `has_permission`, `has_client_permission`, `effective_permissions`, `feature_enabled`, `assert_can_grant`, `custom_access_token_hook` (event emit, notify and invitation preview live in TS — ADR-021)
- [x] RLS policies for every table
- [x] Seed: permission catalog, system roles & grants, departments, flags (`seed.sql`)
- [x] Dev seed script: 1 agency, ~10 team members across departments & all roles, demo client + 3 client users, invitations, notifications
- [x] `pnpm db:reset` = reset + migrate + seed, idempotent

### 0.4 Core libraries
- [x] Supabase clients (browser / server / admin), session helpers (`getSession`, `requireUser`, `requireSide`)
- [x] `withRls()` transaction helper, `dbAdmin`
- [x] `defineAction()` + `Result` + error codes
- [x] `emitEvent()` + typed event registry
- [x] `can()` + effective permissions loaded per request in `getAppContext()`
- [x] `isFeatureEnabled()` + module registry
- [x] `EmailProvider` + Resend / SMTP / Console providers + `sendEmail()`
- [x] i18n: next-intl config, message loading per module, formats (`ar-SA-u-nu-latn-ca-gregory`, SAR), `localized()`, `DirIcon`
- [x] Rate limiter (Postgres-backed)

### 0.5 Design system
- [x] Tokens (brand scale from chosen proposal), light + dark, fonts via `next/font`
- [x] shadcn primitives themed and RTL-verified (list in UI.md §5)
- [x] AppShell: collapsible sidebar, top bar, breadcrumbs, mobile sheet
- [x] PageHeader, DataTable, EmptyState, ErrorState, ForbiddenState, Skeletons, StatCard, FileCard, Avatar/AvatarGroup, Badge, Tabs, Dialog, Drawer, Toasts
- [x] Command palette shell (`Ctrl/⌘ K`), language switcher, theme toggle
- [x] `/dev/design-system` page: all components, AR/EN × light/dark grid

### 0.6 Auth
- [x] Login (password + magic link), logout
- [x] Forgot / reset password
- [x] Email change verification
- [x] Bilingual auth email templates (AR/EN): magic link, reset, email change — via GoTrue templates (ADR-017 supersedes the Send Email Hook)
- [x] `proxy.ts`: session refresh, side routing, onboarding redirect, locale cookie
- [x] Layout guards `(agency)` / `(portal)`; 403 page
- [x] Custom access token hook claims

### 0.7 Invitations & onboarding
- [x] Invite team member (role(s), department) / invite client user (client, client role)
- [x] Invitations list: status, resend, revoke, expiry display
- [x] Accept page: preview, set password, errors (expired/revoked/used)
- [x] Invite email template (AR/EN)
- [x] Onboarding: name, avatar upload (resized, public-assets bucket — ADR-020), phone (+966), language, theme
- [x] Portal: Client Owner team page (invite / revoke / change client role)

### 0.8 Users, roles & departments admin
- [x] Users list (DataTable: search, filter by role/department/status), user detail drawer
- [x] Deactivate / reactivate user
- [x] Roles list, create / edit / delete custom role (localized name)
- [x] Permission matrix editor (grouped, bulk toggle, locked Super Admin, diff before save)
- [x] Assign roles to users; per-user overrides (grant/deny with reason)
- [x] Departments CRUD + membership + lead
- [x] Feature flags page
- [x] Audit log viewer (filter by actor/table/date, before/after diff)
- [x] Organization settings (name AR/EN, logo, defaults)

### 0.9 Profile & preferences
- [x] Profile page (name, avatar, phone, email change)
- [x] Preferences (language, theme, timezone, calendar Gregorian/Hijri)
- [x] Notification preferences

### 0.10 Notifications
- [x] `notify()` + in-app rows + email per preference
- [x] Realtime bell with unread count, popover
- [x] Inbox page (all/unread, mark read, mark all)
- [x] Phase 0 producers: invitation accepted → inviter; roles changed → user

### 0.11 Dashboards (Phase 0 scope)
- [x] Agency dashboard (welcome, my roles/departments, team by department, pending invitations, recent visible activity)
- [x] Portal home (welcome, account, team shortcut for owners)

### 0.12 Quality & release
- [x] Unit tests: `can()` (deny-wins, locked role, side mismatch), formatters, Zod schemas, i18n parity
- [x] RLS tests: every table × personas, allow + deny; meta-test "RLS on every table"
- [x] Playwright: login (password + magic link via Mailpit), invite → accept → onboarding, password reset, language switch (dir flips, persisted), side protection
- [ ] Manual QA pass: AR/EN × light/dark × mobile/desktop on every screen (automated screenshot pass done on key screens; full human pass pending)
- [ ] Vercel + Supabase staging deployment on custom domain; Resend domain verified
- [x] Docs updated; Phase 0 report

## Phase 1 — Client Portal (done)

Plan: agency-side client management (minimal; full Client 360 is Phase 5) + the client portal foundation.
Requests (Phase 2) and approvals (Phase 3) get designed-in navigation entries and home-page slots that stay
behind feature flags with proper empty states until those phases ship.

### 1.1 Data & security
- [x] Tables: `clients` (extended), `client_notes` (agency-only), `client_users` (client role + `can_approve`), `client_assignments`
- [x] Tables: `packages`, `package_items`, `client_packages`, `package_usage_entries` (usage ledger fed by later phases)
- [x] Tables: `file_folders`, `files` (`visibility`: internal | client, `source`: library | attachment)
- [x] Tables: `threads` (polymorphic `subject_type/subject_id`), `comments` (`visibility`, mentions), `comment_attachments`, `thread_reads`
- [x] RLS: client isolation (`app.is_client_member`, `app.agency_can_access_client`), internal items never reach the portal, Viewer can't write
- [x] Storage: private `client-files` bucket, path `org/<org>/clients/<client>/<folder|root>/<file>-<name>`, signed URLs only, per-type size limits
- [x] Realtime publication for `comments`, `thread_reads`, `notifications`

### 1.2 Agency — client management
- [x] Clients list (DataTable: search, status/industry/AM filters, mobile cards)
- [x] Client create / edit form (name AR/EN, logo, industry, city, website, social handles, status, AM, start date, internal notes, assigned team)
- [x] Client detail: overview, portal users (invite / role / approval / deactivate / resend / revoke), package, files, messages
- [x] Packages admin (monthly items, price) and assigning a package to a client for a period
- [x] `getPackageUsage()` service (allowed vs used per item type)
- [x] Agency messages inbox across accessible clients (+ internal notes and internal threads)

### 1.3 Portal
- [x] Portal shell: org branding (logo, brand color), calmer layout, desktop top nav, mobile bottom nav, client switcher
- [x] Home: greeting, account manager card (photo, WhatsApp + email), package summary, recent files, recent activity, "Waiting for your approval" + "Active requests" slots
- [x] Files: folders (month / project / type / brand), upload with progress (brand assets), image / PDF / video preview, signed downloads, client-visible only
- [x] Messages: threads, realtime, @mentions, attachments, read receipts
- [x] Company settings (Client Owner): company profile, team (invite, role, approval right, deactivate)
- [x] Flag-guarded routes: Requests (Phase 2), Approvals (Phase 3), Calendar (Phase 3)

### 1.4 Notifications
- [x] New message (client ↔ agency) and mentions — in-app + email per preferences
- [x] New file shared with the client / uploaded by the client — in-app + email per preferences

### 1.5 Quality
- [x] Seed: 5 Saudi client companies with 2–3 portal users, package, folders + files, threads
- [x] RLS tests: client A ≠ client B (files, messages, users), internal items hidden, Viewer can't write
- [x] Playwright: invite client → accept → upload file → agency replies → client notified
- [ ] AR/EN × light/dark × mobile/desktop pass on every portal screen

## Phase 2 — Requests (revision 2 — done)

Revision 2 (owner brief, 2026-09-28) replaces the first cut's versioned "request forms" with **request types** that carry
their brief form (`form_schema`), a richer lifecycle with drafts, needs-info and delivery, per-client numbering, package
consumption and a client dashboard. The domain-event dispatcher, notification consumers, request threads and
attachments from the first cut are kept.

### 2.1 Data & security
- [x] `request_types` (name AR/EN, icon, description, category, default priority, SLA days, package item, active, `form_schema` + `schema_version`)
- [x] `requests` (per-client number/reference `NAJD-0042`, brief + schema snapshot, references, desired/due date, extra/billable flags, lifecycle timestamps), `request_status_history` (with reasons), `request_events` (internal changes), `request_attachments` (per brief field or general)
- [x] `clients.request_prefix` (defaults from the slug)
- [x] Triggers: numbering on submit, due date from SLA days (working days, Fri–Sat off), role-aware transition guard, required reasons, client-editable columns only in Draft / Needs info, server-owned timestamps, history rows, thread on submit, package consumption on accept (and reversal)
- [x] RLS: drafts private to their author, agency never sees drafts, client isolation, Viewer read-only, internal events/notes hidden
- [x] Domain-event dispatcher + consumers (first cut, kept)

### 2.2 Agency — request types & form builder
- [x] Request types admin: list, create, settings, active toggle
- [x] Builder: short/long (light formatting) text, number, select, multi-select, date, file upload, links, platform picker (7 networks), dimensions/aspect ratio, color, checkbox; AR/EN labels & help, required, conditional visibility, drag & drop reorder (+ keyboard), live preview
- [x] Seed types: Social post, Carousel, Reel/Video, Story, Ad campaign, Photoshoot, Website change, Branding, Other

### 2.3 Portal — submission & tracking
- [x] Wizard: type cards → brief → attachments & references → desired date & priority → review → submit; save draft at any step, resume drafts
- [x] Package check: remaining quota for the type's item, "extra" warning (still allowed, flagged)
- [x] Requests list: status tabs, search, type filter, cards on mobile
- [x] Request page: brief (editable only in Needs info → resubmit), status timeline, thread, attachments, assigned AM, cancel in early statuses, confirm delivery (close)

### 2.4 Lifecycle
- [x] Draft → Submitted → Under review → Needs info → Accepted → In progress → In review → Delivered → Closed, + Rejected, Cancelled; transitions per role; reasons for reject / needs info; `request_status_history`; domain event per transition

### 2.5 Agency — triage inbox
- [x] Views (new, pending, active, delivered, closed, mine, all), sort by age / SLA / priority, filters, quick preview drawer
- [x] Actions: accept, request info, reject, priority, due date, assign AM, extra / billable, internal notes; bulk assign/priority
- [x] SLA indicator (on track / at risk / overdue) from the type's SLA days
- [x] "Convert to tasks" behind `module.tasks` (off until Phase 3)

### 2.6 Client dashboard
- [x] Stats: open requests, waiting on you, delivered this month, average turnaround
- [x] Package usage chart per item type (current period)
- [x] Activity timeline including request updates

### 2.7 Notifications
- [x] Submitted → AM (+ assignee); needs info → client (with the question); status changed → client; client resubmit / cancel / close → AM; new comment → both; in-app + email

### 2.8 Quality
- [x] Seed: the 9 types, requests across the 5 clients in every status (with drafts, needs-info, extras, consumption)
- [x] Unit: state machine per role (valid/invalid), form-schema definition + answers validation (conditional fields), SLA
- [x] RLS: isolation, drafts privacy, Viewer read-only, internal hidden, restricted client edits, transitions/reasons, consumption
- [x] Playwright: client submits with files → AM requests info → client updates → AM accepts (+ package usage)
- [x] Docs: ROADMAP, DATA_MODEL, ARCHITECTURE, DECISIONS, HANDOFF, CLAUDE.md

### 2.9 Deferred (not in this phase)
- [ ] True WYSIWYG rich text (long text supports light Markdown: bold, lists, links)
- [x] SLA policies: pause while waiting on the client, business-hour calendars, holidays, breach alerts (Phase 5)
- [ ] "Convert to tasks" behaviour (Phase 3; the button is behind `module.tasks`)
- [ ] Per-client availability of request types; agency-created requests on behalf of a client (UI)
- [ ] UI to edit a client's request prefix (column + default exist)
- [ ] Human QA pass (AR/EN × light/dark × mobile/desktop) on every requests screen

## Phase 3 — Tasks & Deliverables (done)

Requests turn into tasks through workflow templates, the team produces deliverables with versions, and work passes
internal review then client approval — visible to the client in the portal. Data model: `docs/DATA_MODEL.md` §3d.

### 3.1 Data & security
- [x] Tables: `task_statuses`, `workflow_templates`, `workflow_template_steps`, `tasks`, `task_members`, `task_dependencies`, `task_checklist_items`, `task_attachments`, `time_entries`, `saved_views`
- [x] Tables: `deliverables`, `deliverable_versions`, `deliverable_version_files`, `approvals`, `annotations`, `annotation_replies`; `files` thumbnails/dimensions; `threads.subject_type = 'task'`
- [x] Permissions: `tasks:read/create/update/delete`, `workflows:manage`, `deliverables:manage`, `deliverables:review`, `time:read_all` (client approvals use `client_users.can_approve`)
- [x] Triggers: task numbering + status category, dependency cycles, approval state machine (version → deliverable → task → request delivered), revision-round consumption
- [x] RLS: tasks/time/internal review never reach the portal; clients see only deliverables and versions sent to them

### 3.2 Workflow templates
- [x] Templates admin linked to request types; visual builder (ordered steps, drag to reorder, dependency picker, department, assignee rule, SLA days, review/approval flags, deliverable type)
- [x] Seeded templates for every seeded request type (e.g. Social post: Copywriting → Design → Scheduling with internal review + client approval on Design)
- [x] "Convert to tasks" in triage (flag `module.tasks` on): generates the task chain with computed due dates, request → In progress

### 3.3 Tasks
- [x] Fields: title, Markdown description, client, request, department, assignees, reviewer, watchers, priority, status, start/due, estimate, tags, checklist, subtasks, blocked-by, attachments, internal comments with @mentions
- [x] Configurable statuses per organization (settings)
- [x] Views: Kanban (drag & drop, swimlanes by assignee/client), List, Table (sort/filter/group, inline edit, bulk actions), Calendar, My Work (today / overdue / this week / waiting on me)
- [x] Saved views (personal and shared)
- [x] Task drawer with keyboard shortcuts, realtime updates, optimistic updates
- [x] Time tracking: timer + manual entries (internal)
- [x] Unblocking: dependency done → next assignee notified

### 3.4 Deliverables & versions
- [x] Deliverables linked to task/request/client; versions with files and notes
- [x] Resumable uploads with progress (TUS to signed URLs), image thumbnails, video poster frames, type/size limits, signed URLs
- [x] Version compare (side by side)

### 3.5 Review & approvals
- [x] Internal review (reviewer / `deliverables:review`) → client approval, per workflow step
- [x] Annotations: image pins (x/y), video timestamps, document/copy comments; threaded, resolvable
- [x] Changes requested → task back to assignee with feedback; new version restarts review
- [x] Revision rounds counted against the package with a warning when exceeded
- [x] All deliverables approved → request Delivered

### 3.6 Portal
- [x] Approvals center + primary CTA on portal home (flag `module.approvals`)
- [x] Mobile-first review screen: preview, zoom, annotate, approve / request changes (feedback required), version history
- [x] Request page progress (active step) without internal tasks or comments
- [x] Content calendar (flag `module.calendar`)

### 3.7 Notifications
- [x] Task assigned, mention, due soon / overdue, dependency unblocked, ready for internal review, ready for client approval, client approved / requested changes, pending-approval reminder after N days

### 3.8 Quality
- [x] Seed: statuses, templates, converted requests with tasks, deliverables at every stage, hundreds of tasks
- [x] Unit: workflow generation, dependency & due-date computation, approval state machine
- [x] RLS: client sees only client-visible deliverables and versions; tasks/time/internal annotations hidden
- [x] Playwright: request → convert → designer uploads v1 → team lead approves → client annotates + requests changes → v2 → client approves → request Delivered
- [x] Docs: ROADMAP, DATA_MODEL, ARCHITECTURE, DECISIONS, HANDOFF, CLAUDE.md

### 3.9 Deferred (not in this phase)
- [ ] Setting screen for the approval-reminder interval (`organizations.approval_reminder_days`, default 2 days, exists)
- [ ] Anchored comments inside PDFs / copy text (documents and copy take general comments today)
- [ ] Side-by-side compare for videos (compare covers images)
- [ ] Drag-to-reschedule on the calendar; dragging across assignee swimlanes to reassign
- [ ] Internal tasks not tied to a client; @mentions inside annotations
- [ ] Virtualized board/table for thousands of tasks (verified smooth with ~320 seeded tasks; done tasks limited to 30 days)
- [ ] Human QA pass (AR/EN × light/dark × mobile/desktop) on every Phase 3 screen

## Phase 4 — Campaigns (done)

Campaigns per client with channels, budgets and KPI targets; daily metrics entered by hand or imported from the ad
platforms' CSV exports (live API sync is Phase 7); analytics with pacing and health; branded client reports
(published snapshots, print/PDF) built by hand or on a schedule — all visible to the client in the portal.
Data model: `docs/DATA_MODEL.md` §3e.

### 4.1 Data & security
- [x] Tables: `campaigns`, `campaign_channels`, `campaign_kpis`, `metrics_daily`, `metric_imports`, `reports`, `report_sections`, `report_schedules`; `requests.campaign_id`, `deliverables.campaign_id`
- [x] Permissions: `campaigns:read`, `campaigns:manage`, `metrics:manage`, `reports:manage` (clients: `portal:access` + flag `module.campaigns`)
- [x] Triggers: campaign numbering, scope (client/org forced from the parent), channel/KPI/metric consistency, report publish snapshot guard
- [x] RLS: clients see only their `client`-visible campaigns (never drafts), their metrics, and **published** reports; agency per client access

### 4.2 Campaigns
- [x] Campaign list: filters (client, status, platform, owner), flight, budget & spend pacing, headline KPI progress, health
- [x] Create / edit: client, name, objective, flight dates, budget (SAR), owner, description, visibility; channels with budget split; KPI targets (campaign-wide or per channel)
- [x] Status lifecycle: draft → planned → active ⇄ paused → completed (archived hidden); linked requests and deliverables (creatives)

### 4.3 Metrics
- [x] Daily metrics per channel: impressions, reach, clicks, spend, conversions, leads, video views, engagements, revenue
- [x] Manual entry grid (per channel, week at a time, keyboard friendly)
- [x] CSV import with auto-detected presets (Meta Ads Manager, TikTok Ads, Snapchat Ads, Google Ads) and manual column mapping; preview, validation, upsert by day; import log
- [x] Derived metrics: CTR, CPC, CPM, CPA, CPL, ROAS, frequency, engagement rate

### 4.4 Analytics
- [x] Campaign overview: KPI tiles vs target with pacing, budget pacing, trend chart (metric picker, daily/weekly), channel breakdown
- [x] Health (on track / at risk / off track) from KPI + budget pacing, shown on list, detail and client page
- [x] Charts in plain SVG following the dataviz rules (validated palette, one axis, hover tooltips, table fallback, dark mode)

### 4.5 Reports
- [x] Report builder: client or campaign scope, period, sections (KPI summary, trend, channel breakdown, top creatives, commentary, next steps), draft preview
- [x] Publish = frozen snapshot of the numbers; branded print/PDF view (agency logo + color, AR/EN, RTL)
- [x] Schedules: weekly / monthly per client or campaign → draft for review (or auto-publish) from the daily sweep

### 4.6 Portal
- [x] Campaigns & reports (flag `module.campaigns`): campaign list + detail (KPIs, trend, channels, approved creatives), published reports with print/PDF
- [x] Portal home: latest report + active campaigns summary

### 4.7 Notifications
- [x] Report published (client), scheduled report draft ready (agency), campaign at risk / off track (owner), metrics stale on an active campaign (owner)

### 4.8 Quality
- [x] Seed: campaigns for every client (active with ~90 days of metrics, completed, draft), KPIs, channels, published + draft reports, a schedule
- [x] Unit: derived metrics, pacing & health, CSV parsing + preset detection, report period math
- [x] RLS: client sees only its client-visible campaigns, metrics and published reports; drafts/internal campaigns and other clients denied
- [x] Playwright: AM creates a campaign with channels + KPIs → imports a Meta CSV → overview shows pacing → builds and publishes a report → client sees it in the portal and gets notified
- [x] Docs: ROADMAP, DATA_MODEL, ARCHITECTURE, DECISIONS, HANDOFF, CLAUDE.md

### 4.9 Deferred (not in this phase)
- [ ] Live metrics from ad-platform APIs (Phase 7; `metrics_daily.source = 'api'` and `campaign_channels.external_ref` are ready)
- [ ] Server-generated PDF attachments on report emails (reports print to PDF from the browser; emails link to the portal)
- [ ] Undo a CSV import (imports are logged and re-importing a period replaces it)
- [x] Cross-client analytics dashboard for the agency — Phase 5 ops dashboard (campaign health per client, attention list)
- [ ] Campaign picker on the deliverable page (deliverables inherit their request's campaign and can be linked from the campaign's Creatives tab)
- [ ] Human QA pass on real devices (screens were checked in AR/EN × light/dark × 390px/1440px with screenshots)

## Phase 5 — Agency Operations (done)

The agency's control room: one dashboard across every client the viewer can access, a Client 360 page with a
health score, team workload views, and SLA policies (business hours, holidays, pause while waiting on the client)
with at-risk / breach alerts. Mostly read models over Phases 1–4; new tables only for SLA.
Data model: `docs/DATA_MODEL.md` §3f.

### 5.1 Data & security
- [x] Tables: `sla_policies` (match on client / request type / priority, response business hours, resolution working days, pause on client, at-risk %, escalation contact), `holidays`, `sla_breaches` (response/resolution × at_risk/breached, acknowledge + note)
- [x] Columns: `organizations.business_hours_start/end`; `requests.sla_policy_id`, `response_due_at`, `sla_paused_at`, `sla_paused_days`
- [x] Permissions: `operations:read` (ops dashboard, team, SLA monitor), `sla:manage` (policies, business hours, holidays)
- [x] SQL: org working days with holidays, business-hour arithmetic, policy resolution (most specific wins), `requests_sla` trigger (targets at submit, pause in Needs info, due date extended on resume)
- [x] RLS: policies/holidays agency-only (write `sla:manage`); breaches readable with request access, only acknowledgement is writable; nothing reaches the portal

### 5.2 SLA policies admin (`/admin/sla`)
- [x] Policies: list, create / edit / delete, active toggle, match criteria, targets, pause, at-risk threshold, escalation person
- [x] Business hours (start / end, Sunday–Thursday) and holidays (add / remove; Saudi public holidays seeded)

### 5.3 SLA monitoring & alerts
- [x] Response (first agency reply or move) and resolution (delivery) targets on every submitted request; SLA card on the request page and response state in the triage inbox
- [x] Sweep: at-risk and breached rows once per request × kind × level, resolved when met or closed; `sla.at_risk` / `sla.breached` events
- [x] Notifications: at risk → assignee; breached → assignee + account manager + policy escalation contact
- [x] SLA monitor (`/sla`): open issues (live), breach log with filters and acknowledge, compliance (response / resolution) for 30 / 90 days per client

### 5.4 Operations dashboard (`/dashboard`)
- [x] Scope: all accessible clients / my clients / one account manager
- [x] Tiles: open requests, awaiting triage, SLA overdue / at risk, overdue tasks, waiting on client approval, waiting on internal review, campaigns at risk / off track, unanswered client messages
- [x] Needs attention (ranked), client portfolio with health, workload by department, SLA compliance
- [x] Viewers without `operations:read` keep the personal dashboard

### 5.5 Client 360
- [x] Health (healthy / watch / at risk) with reasons, computed from SLA, overdue work, waiting approvals, campaign health and unanswered messages
- [x] Overview: KPI tiles, SLA compliance, upcoming deadlines (14 days), unified activity timeline (requests, deliverables, reports, messages); health on the clients list

### 5.6 Team
- [x] `/team`: members with departments, open / overdue / due this week tasks, reviews waiting, assigned requests, clients managed, hours logged (with `time:read_all`), load bar; department filter and search
- [x] `/team/[userId]`: stats, tasks by bucket, assigned requests, clients, hours per day (14 days)

### 5.7 Quality
- [x] Seed: default + client + urgent policies, holidays, requests with breaches (acknowledged and open), paused request
- [x] Unit: business-hours / working-day math, policy matching, SLA states, client health
- [x] DB: SQL ↔ TS calendar parity, trigger targets + pause/resume, RLS (allow + deny, portal denied), sweep idempotency and notifications
- [x] Playwright: admin creates a policy → client submits → targets shown → sweep flags breach → assignee notified → ops acknowledges; ops dashboard, Client 360 and team pages render
- [x] Docs: ROADMAP, DATA_MODEL, ARCHITECTURE, DECISIONS, HANDOFF, CLAUDE.md

### 5.8 Deferred (not in this phase)
- [ ] Configurable working days and per-client calendars (Sunday–Thursday is fixed; holidays and business hours are editable)
- [ ] SLA targets on tasks and approvals (task due dates keep their overdue reminders; requests carry the SLA)
- [ ] Sub-daily breach alerts on the Vercel Hobby plan (the sweep runs daily — ADR-044/055; live states are always current)
- [ ] Re-applying a changed policy to requests already submitted (targets are a snapshot — ADR-052)
- [x] Capacity planning (hours available vs. estimates) — delivered in Phase 6 at `/capacity`
- [ ] Human QA pass on real devices (screens checked in AR/EN × light/dark × 390px/1440px with screenshots)

## Phase 6 — CRM & Capacity

The agency's own sales: leads (manual, CSV, a public embeddable form, an inbound webhook) → deals on configurable
pipelines → won → a client with package, portal invitation and onboarding tasks in one click; activities and
follow-ups; a sales dashboard; and capacity planning that answers "can we take this client?". Agency-only: nothing
reaches the portal. Data model: `docs/DATA_MODEL.md` §3g.

### 6.1 Data & security
- [x] Tables: `leads`, `pipelines`, `pipeline_stages`, `deals`, `deal_stage_history`, `deal_contacts`, `crm_activities`, `crm_files`, `quotes`, `quote_items`, `lead_forms`, `lead_assignment_rules`, `crm_webhook_tokens`, `sales_targets`, `crm_settings`
- [x] Tables: `member_capacity`, `time_off`, `service_efforts`
- [x] Permissions: `leads:read`, `leads:manage`, `deals:read`, `deals:manage`, `crm:manage_all`, `crm:admin`, `capacity:read`, `capacity:manage`; flag `module.crm`
- [x] Roles: Sales Manager, Sales Rep (seeded, and in `bootstrap_organization`); Sales department
- [x] Triggers: lead / deal / quote numbering, deal status + probability from the stage, stage history, won/lost stamps, activity → `last_activity_at`, quote totals
- [x] RLS: agency-only; read with `leads:read` / `deals:read`; write your own records (or unassigned) with `*:manage`, anyone's with `crm:manage_all`; settings with `crm:admin`; capacity with `capacity:*`; private `crm-files` bucket

### 6.2 Leads
- [x] Fields: name, company, phone (Saudi format → E.164), email, source (website form, WhatsApp, Instagram, referral, event, lead ad, manual, other) + `external_ref`, service interest, budget range, city, owner, status, score, tags, notes
- [x] Capture: manual form, CSV import (mapping, preview, validation), public embeddable form (`/f/[token]`, iframe snippet, honeypot + signed time token + per-IP rate limit), inbound webhook (`POST /api/webhooks/leads`, Bearer token per integration, idempotent on `external_ref`)
- [x] Duplicate detection by phone / email (warning on create; a repeat form or webhook submission becomes an activity on the existing lead) and merge (fields, tags, activities, deals)
- [x] Assignment rules: ordered, match by service / city / source, round-robin among members
- [x] Leads list (filters, search, mobile cards) and lead page (details, activities, duplicates, convert to deal)

### 6.3 Pipeline & deals
- [x] Pipelines and stages admin (default New → Contacted → Meeting → Proposal → Negotiation → Won / Lost), probability per stage
- [x] Kanban with drag & drop (+ keyboard), value (SAR), probability, expected close, weighted totals per stage
- [x] Deal page: stage bar, contacts, activities timeline, notes, files, quotes (line items from packages or free text, discount, validity, print / PDF in AR or EN), won / lost with reason
- [x] Won → convert to client: client (+ account manager, team), package for the current period, portal invitation to the primary contact, onboarding request converted to tasks through the configured workflow template

### 6.4 Activities & follow-ups
- [x] Calls, meetings, emails, WhatsApp notes, notes and tasks with due dates; complete / reopen
- [x] My follow-ups (overdue, today, upcoming); reminders when an activity is due; "no activity in N days" alerts for open deals
- [x] Notifications: lead assigned, follow-up due, deal gone quiet, deal won

### 6.5 Sales dashboard
- [x] Pipeline value (total and weighted) by stage, stage-to-stage conversion, win rate, average sales cycle, leads by source, per-salesperson table, forecast vs target by month
- [x] Sales targets per month (team and per person)

### 6.6 Capacity planning
- [x] Member capacity (hours / week) adjusted for time off and holidays; department capacity
- [x] Demand: estimated hours of scheduled tasks + remaining package work (effort per package item per department) + weighted pipeline deals (their target package from the expected close date)
- [x] Heatmap department × week (8 weeks), member over-allocation warnings
- [x] "Can we take this client?" simulator: package + start week → impact per department for 4–8 weeks
- [x] Settings: member hours, time off, service efforts

### 6.7 Quality
- [x] Seed: sales team, pipeline, leads from every source (duplicates included), deals in every stage, activities, quotes, targets, a public form, rules, capacity, time off, efforts
- [x] Unit: phone / email normalisation, dedup + merge, scoring, assignment rules, forecast / conversion / win rate / cycle, quote totals, capacity math, simulator
- [x] DB: numbering + stage triggers, RLS (own vs all, agency only, portal denied), public form + webhook paths, conversion
- [x] Playwright: public form → lead (assigned) → deal → stages → won → client with package, portal invitation and onboarding tasks
- [x] Docs: ROADMAP, DATA_MODEL, ARCHITECTURE, DECISIONS, HANDOFF, CLAUDE.md

### Deferred from Phase 6
- [ ] Sending a quote by email from the app, e-signature and a server-generated PDF file (today: print / "Save as PDF" in the browser, in AR or EN)
- [ ] Minute-accurate follow-up reminders: the Vercel Hobby cron runs once a day (08:00 Riyadh), so "due today" reminders arrive in the morning run; a more frequent schedule needs a paid plan or an external scheduler
- [ ] Lead / deal CSV export; custom lead fields; weighted or working-hours-aware round-robin
- [ ] Deals without a target package add no capacity demand (only packaged deals are weighted into the heatmap)
- [ ] Skills-based and per-person capacity planning (today: per department, with over-allocated people from assigned task estimates)
- [ ] Human QA pass (AR/EN × light/dark × mobile/desktop) on every sales and capacity screen (automated screenshot pass done)

## Phase 7 — Integrations & Automation

Per-organization connections to the ad and messaging platforms (tokens in Supabase Vault), a daily metrics sync into
`metrics_daily`, lead ads into `ingestLead()`, WhatsApp as a notification channel and a sales tool, and a rule engine
whose triggers are `domain_events` types. Every platform sits behind one provider interface with a **sandbox**
implementation, so the whole phase runs and is tested without live credentials. Agency-only: nothing reaches the
portal except the numbers the sync writes into campaigns. Data model: `docs/DATA_MODEL.md` §3h.

### 7.1 Data & security
- [ ] Tables: `integration_connections` (token only as a Vault secret id), `integration_accounts` (ad accounts, pages, WhatsApp numbers, analytics properties → client), `integration_campaign_links` (platform campaign → campaign channel), `integration_sync_runs` (sync log with retries), `integration_webhook_events` (inbound log, dedup key), `whatsapp_templates`, `whatsapp_messages`, `whatsapp_opt_ins`, `automations`, `automation_runs`
- [ ] Columns: `notification_preferences.whatsapp`; `domain_events.automation_depth` + `automation_chain` (loop guard)
- [ ] Vault: `app.integration_put_secret` / `app.integration_get_secret` / `app.integration_drop_secret` — service role only; no token column anywhere; `authenticated` / `anon` can't read `vault.*`
- [ ] Permissions: `integrations:read`, `integrations:manage`, `automations:read`, `automations:manage`, `whatsapp:send`; seeded for Super Admin / Admin (all), Account Manager, Team Lead, Sales Manager, Sales Rep; flag `module.integrations`
- [ ] Triggers: organization consistency (account → connection, link → account + channel of the mapped client), server-owned status / health columns, audit on every connection, account, link, template and automation change
- [ ] RLS: agency-only; read with `integrations:read` / `automations:read`, write with `*:manage`; WhatsApp messages readable with `whatsapp:send` or lead/deal read; opt-ins own-row only

### 7.2 Providers & connections (A)
- [ ] Provider interface (`authorizeUrl`, `exchangeCode`, `refresh`, `listAccounts`, `listCampaigns`, `fetchDailyMetrics`, `verifyWebhook`, `fetchLead`, WhatsApp `listTemplates` / `sendTemplate`) with live adapters for Meta (Ads + Pages + lead ads), WhatsApp Cloud API, TikTok, Snapchat, Google Ads / GA4 and a deterministic **sandbox** adapter per platform
- [ ] OAuth where supported (Meta, TikTok, Snapchat, Google): signed `state` (HMAC + nonce cookie, 10 min), callback exchanges the code, tokens straight into Vault; WhatsApp by system-user token + phone number id; sandbox consent page for local and demo use
- [ ] Admin `/admin/integrations`: provider cards (configured / not configured with the env vars it needs), connections with health; connect, reconnect (same connection, new token), disconnect (secret dropped, accounts kept unmapped for history), test connection
- [ ] Health: `connected · expiring · expired · error · disconnected`; token expiry and auth errors mark the connection expired with a clear, translated message and a Reconnect call to action; `integration.connection_expired` → notification to integration managers

### 7.3 Data sync (B)
- [ ] Discover accounts and platform campaigns; map ad accounts to clients and platform campaigns to campaign channels (same client enforced)
- [ ] Daily metrics pull into `metrics_daily` (`source = 'api'`): aggregate linked platform campaigns per channel per day, upsert by (channel, day) — re-running a range gives the same rows; health refresh after each run
- [ ] Sync now, backfill a date range (≤ 90 days), daily scheduled sync of the last 3 days (late attribution) from the cron
- [ ] Sync log: trigger, range, status, rows, error; retries with backoff (3 attempts), manual retry

### 7.4 Lead ads (C)
- [ ] `/api/hooks/[provider]`: Meta / WhatsApp verification challenge; signature verification for every provider (Meta `X-Hub-Signature-256`, TikTok signed header, Snapchat signed header, Google key, sandbox HMAC) — unsigned or badly signed requests are rejected and logged
- [ ] Webhook log with dedup on the platform's event id; processing after the response, retries from the sweep
- [ ] Meta / TikTok / Snapchat (and Google) lead forms → `ingestLead()` (source `lead_ad`, `external_ref` = `<provider>:<lead id>`, source detail = platform · form), assignment rules, duplicate → activity

### 7.5 WhatsApp (D)
- [ ] Templates synced from the WhatsApp Business account (approved only are usable); one template marked for notifications per language
- [ ] Channel: per-user opt-in (phone + consent, opt-out anytime) and a per-category WhatsApp switch in notification settings; `notify()` sends through the approved template, logs every message
- [ ] Send a template message to a lead from the lead page and the deal page (template picker, parameters, preview), message history with delivery status (sent → delivered → read / failed) from status webhooks; logged as a WhatsApp activity

### 7.6 Automation engine (E)
- [ ] Rules: trigger (a curated catalog of `domain_events` types with their fields), conditions (all / any; equals, not equals, in, not in, greater / less, contains, empty / not empty), ordered actions
- [ ] Actions: notify (people or roles on the record), assign (lead / deal / request), create task, change status (lead / request / task), send WhatsApp template, webhook (HTTPS, HMAC-signed, private addresses blocked)
- [ ] Runs as the `automations.engine` consumer (ADR-027/028): one run per rule × event (idempotent), completed actions skipped on retry, dispatcher backoff; loop protection (depth ≤ 3, a rule never re-triggers itself down its own chain, 100 runs per rule per hour)
- [ ] Builder UI (`/admin/automations`), run log with per-action results, dry run against a recent event (no side effects), enable / disable, duplicate

### 7.7 Quality
- [ ] Seed: sandbox connections (Meta, TikTok, WhatsApp) mapped to demo clients and campaigns, a sync log, webhook events, templates, opt-ins, example automations and runs
- [ ] Unit: condition evaluator, loop guard, signature verification per provider, OAuth state, sandbox determinism, metrics aggregation, template rendering, webhook URL guard
- [ ] DB: tokens never readable by agency or client users (Vault functions and views denied), RLS allow / deny, sync idempotency, lead-ad dedup through the webhook path, automation conditions / loop guard / retries / dry run
- [ ] Playwright: connect a sandbox provider → map account and campaign → sync → metrics on the campaign → an automation fires
- [ ] Docs: ROADMAP, DATA_MODEL, ARCHITECTURE, DECISIONS, HANDOFF, CLAUDE.md

## Phase 8 — AI Intelligence
Campaign analysis & anomaly detection, recommendations, AI-drafted reports (AR/EN), assistant over the agency's data
with citations and permission-aware retrieval.
