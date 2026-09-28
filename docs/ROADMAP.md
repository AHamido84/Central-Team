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

## Phase 2 — Requests (done)

Plan: clients submit structured requests from the portal using agency-defined, versioned forms; the agency triages
them in one inbox (assign, prioritize, move through the lifecycle) with SLA due dates; every request has its own
conversation (a `threads` row with `subject_type = 'request'`) and attachments (`files`). The domain-event dispatcher
arrives with this phase and becomes the only place notifications are fanned out. Converting requests into tasks is
Phase 3 (the `requests` row is the future task parent).

### 2.1 Data & security
- [x] Tables: `request_forms`, `request_form_versions` (JSON field definitions, immutable once published), `requests`, `request_events` (lifecycle history), `request_attachments`
- [x] Triggers: per-organization request number, SLA due dates (working days, Fri–Sat weekend), status-transition guard, client-restricted columns, lifecycle events, request thread creation, conversation activity (first response, waiting-on-client → in progress)
- [x] Permissions: `requests:read`, `requests:update`, `requests:triage`, `request_forms:manage` (agency), `portal_requests:create` (client) — seeded, granted to system roles, in the matrix, enforced by RLS
- [x] RLS: client isolation, Viewer read-only, internal lifecycle events and internal notes never reach the portal, specialists update only requests assigned to them
- [x] `module.requests` enabled by default; data dark for clients when the flag is off

### 2.2 Domain-event dispatcher
- [x] `domain_event_deliveries` claim/retry columns (`next_attempt_at`, `locked_until`, `created_at`)
- [x] Dispatcher: per-consumer delivery rows, `for update skip locked` claiming, exponential backoff, idempotent consumers
- [x] Triggered after every committed action (`after()`), plus a cron-safe route `/api/cron/dispatch-events` (`CRON_SECRET`)
- [x] All notification fan-out moved to consumers (messages, mentions, files, invitations, roles, requests); `notify()` idempotent per event

### 2.3 Agency — forms & triage
- [x] Request forms admin: list, create, settings (name AR/EN, description, icon, category, default priority, SLA hours), archive/restore
- [x] Form builder: field types (short/long text, number, date, single/multi select, checkbox, URL), AR/EN labels & help, required, options, reorder, live preview, draft → publish new version
- [x] Triage inbox `/requests`: stats (open, unassigned, overdue, due soon), views (open, mine, unassigned, closed, all), filters (status, priority, client, assignee, form), search, bulk assign / prioritize, SLA indicator, mobile cards
- [x] Request detail: answers (rendered from the version it was submitted with), attachments, conversation with internal notes, status actions, priority, assignee, SLA card, timeline
- [x] Client page "Requests" tab

### 2.4 Portal
- [x] `/portal/requests`: active / closed lists, status badges, empty states
- [x] New request: choose a form → dynamic form (validated client + server from the same definition) → attachments with progress → submit
- [x] Request page: status tracker, "waiting for you" banner, answers, attachments, conversation, client-visible timeline, cancel
- [x] Home "Active requests" slot live

### 2.5 Notifications
- [x] New request → account manager + assigned team; assignment → assignee; status change → client users (and agency on client cancel); request conversation → message / mention notifications linking to the request page
- [x] New `requests` preference category (in-app + email)

### 2.6 Quality
- [x] Seed: 7 forms (one with two published versions, one draft), 23 requests across the 5 clients in every status, with conversations, internal notes, attachments and history
- [x] Unit tests: answers schema builder, transition map, SLA/status helpers, catalog sync across migrations
- [x] RLS tests: client isolation, Viewer read-only, internal notes/events hidden, restricted client updates, transition guard, forms visibility, published versions immutable
- [x] DB test: dispatcher delivery, retry with backoff, no double delivery
- [x] Playwright: client submits request → agency triages and replies → client notified (realtime, bell, email)
- [x] Docs: ROADMAP, DATA_MODEL, ARCHITECTURE (dispatcher), DECISIONS, HANDOFF, CLAUDE.md

### 2.7 Deferred (tracked for later phases)
- [ ] Convert a request into tasks (Phase 3)
- [ ] SLA policies per client/package, pause while waiting on the client, holidays, breach alerts (Phase 5)
- [ ] Per-client form availability; agency UI to log a request on a client's behalf (the action already supports it)
- [ ] AR/EN × light/dark × mobile/desktop human QA pass on the new screens (automated screenshots done)

## Phase 3 — Tasks & Deliverables
Tasks (list/board/calendar), workflow templates per service, deliverables with versions, client approvals with
annotations, comments & mentions, time tracking.

## Phase 4 — Campaigns
Campaigns, channels, KPIs & targets, analytics dashboards, scheduled/branded client reports (PDF), metrics storage.

## Phase 5 — Agency Operations
Internal ops dashboard, Client 360, team views, SLA policies & breach alerts.

## Phase 6 — CRM & Capacity
Leads, pipelines, deals, activities, won-deal → client, team capacity planning & utilization.

## Phase 7 — Integrations & Automation
Meta (Ads + Pages), WhatsApp Business, TikTok, Snapchat, Google Ads/Analytics connections; data sync; automation
engine (trigger = domain event, conditions, actions); WhatsApp notifications channel.

## Phase 8 — AI Intelligence
Campaign analysis & anomaly detection, recommendations, AI-drafted reports (AR/EN), assistant over the agency's data
with citations and permission-aware retrieval.
