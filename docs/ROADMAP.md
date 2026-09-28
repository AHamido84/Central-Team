# Roadmap

Legend: `[ ]` todo · `[x]` done. Update checkboxes in the same PR that completes the work.

## Phase 0 — Foundation (current)

### 0.1 Planning
- [x] `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/UI.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`
- [ ] Owner answers open questions (brand, logo, colors, domain, email, region) — see DECISIONS "Open questions"

### 0.2 Project scaffold & tooling
- [ ] Next.js 16 + TypeScript strict + pnpm; `src/` layout; path aliases
- [ ] Tailwind v4, shadcn/ui init, lucide-react, Framer Motion, next-themes
- [ ] ESLint flat config (incl. logical-properties rule, no cross-module deep imports, no hardcoded JSX strings), Prettier
- [ ] Husky + lint-staged + commitlint (Conventional Commits)
- [ ] Vitest (unit + db projects), Playwright config
- [ ] `.env.example`, env validation with Zod (`src/lib/env.ts`)
- [ ] GitHub Actions CI: lint → typecheck → unit → Supabase up → db tests → build → e2e
- [ ] Security headers + CSP in `next.config` / proxy

### 0.3 Database foundation
- [ ] Supabase CLI local stack, `config.toml` (sign-up disabled, hooks, Mailpit, redirect URLs)
- [ ] Drizzle config → `supabase/migrations` (supabase prefix), schema barrel
- [ ] `app` schema, `updated_at` trigger, generic `app.audit_trigger`
- [ ] Tables: organizations, profiles, organization_members, clients (minimal)
- [ ] Tables: permissions, roles, role_permissions, user_roles, user_permission_overrides
- [ ] Tables: departments, department_members
- [ ] Tables: invitations, rate_limits
- [ ] Tables: feature_flags, organization_features
- [ ] Tables: domain_events, domain_event_deliveries, activity_log
- [ ] Tables: notifications, notification_preferences (+ realtime publication)
- [ ] Functions: `is_org_member`, `is_agency_member`, `has_permission`, `has_client_permission`, `effective_permissions`, `feature_enabled`, `emit_event`, `notify`, `assert_can_grant`, `get_invitation_preview`, `custom_access_token_hook`
- [ ] RLS policies for every table
- [ ] Seed: permission catalog, system roles & grants, departments, flags (`seed.sql`)
- [ ] Dev seed script: 1 agency, ~10 team members across departments & all roles, demo client + 3 client users, invitations, notifications
- [ ] `pnpm db:reset` = reset + migrate + seed, idempotent

### 0.4 Core libraries
- [ ] Supabase clients (browser / server / admin), session helpers (`getSession`, `requireUser`, `requireSide`)
- [ ] `withRls()` transaction helper, `dbAdmin`
- [ ] `defineAction()` + `Result` + error codes
- [ ] `emitEvent()` + typed event registry
- [ ] `can()` / `loadPermissions()` / `<Can>`
- [ ] `isFeatureEnabled()` + module registry
- [ ] `EmailProvider` + Resend / SMTP / Console providers + `sendEmail()`
- [ ] i18n: next-intl config, message loading per module, formats (`ar-SA-u-nu-latn-ca-gregory`, SAR), `localized()`, `DirIcon`
- [ ] Rate limiter (Postgres-backed)

### 0.5 Design system
- [ ] Tokens (brand scale from chosen proposal), light + dark, fonts via `next/font`
- [ ] shadcn primitives themed and RTL-verified (list in UI.md §5)
- [ ] AppShell: collapsible sidebar, top bar, breadcrumbs, mobile sheet
- [ ] PageHeader, DataTable, EmptyState, ErrorState, ForbiddenState, Skeletons, StatCard, FileCard, Avatar/AvatarGroup, Badge, Tabs, Dialog, Drawer, Toasts
- [ ] Command palette shell (`Ctrl/⌘ K`), language switcher, theme toggle
- [ ] `/dev/design-system` page: all components, AR/EN × light/dark grid

### 0.6 Auth
- [ ] Login (password + magic link), logout
- [ ] Forgot / reset password
- [ ] Email change verification
- [ ] Send Email Hook → React Email templates (AR/EN): magic link, reset, email change
- [ ] `proxy.ts`: session refresh, side routing, onboarding redirect, locale cookie
- [ ] Layout guards `(agency)` / `(portal)`; 403 page
- [ ] Custom access token hook claims

### 0.7 Invitations & onboarding
- [ ] Invite team member (role(s), department) / invite client user (client, client role)
- [ ] Invitations list: status, resend, revoke, expiry display
- [ ] Accept page: preview, set password, errors (expired/revoked/used)
- [ ] Invite email template (AR/EN)
- [ ] Onboarding: name, avatar upload (private bucket, resize), phone (+966), language, theme
- [ ] Portal: Client Owner team page (invite / revoke / change client role)

### 0.8 Users, roles & departments admin
- [ ] Users list (DataTable: search, filter by role/department/status), user detail drawer
- [ ] Deactivate / reactivate user
- [ ] Roles list, create / edit / delete custom role (localized name)
- [ ] Permission matrix editor (grouped, bulk toggle, locked Super Admin, diff before save)
- [ ] Assign roles to users; per-user overrides (grant/deny with reason)
- [ ] Departments CRUD + membership + lead
- [ ] Feature flags page
- [ ] Audit log viewer (filter by actor/table/date, before/after diff)
- [ ] Organization settings (name AR/EN, logo, defaults)

### 0.9 Profile & preferences
- [ ] Profile page (name, avatar, phone, email change)
- [ ] Preferences (language, theme, timezone, calendar Gregorian/Hijri)
- [ ] Notification preferences

### 0.10 Notifications
- [ ] `notify()` + in-app rows + email per preference
- [ ] Realtime bell with unread count, popover
- [ ] Inbox page (all/unread, mark read, mark all)
- [ ] Phase 0 producers: invitation accepted → inviter; roles changed → user

### 0.11 Dashboards (Phase 0 scope)
- [ ] Agency dashboard (welcome, my roles/departments, team by department, pending invitations, recent visible activity)
- [ ] Portal home (welcome, account, team shortcut for owners)

### 0.12 Quality & release
- [ ] Unit tests: `can()` (deny-wins, locked role, side mismatch), formatters, Zod schemas, i18n parity
- [ ] RLS tests: every table × personas, allow + deny; meta-test "RLS on every table"
- [ ] Playwright: login (password + magic link via Mailpit), invite → accept → onboarding, password reset, language switch (dir flips, persisted), side protection
- [ ] Manual QA pass: AR/EN × light/dark × mobile/desktop on every screen
- [ ] Vercel + Supabase staging deployment on custom domain; Resend domain verified
- [ ] Docs updated; Phase 0 report

## Phase 1 — Client Portal
Portal shell completion, portal home with activity, files (folders, upload, preview, versions), messages (threads,
realtime), agency-side client management (clients CRUD, contacts, brands, assignments), event dispatcher + first
notification rules.

## Phase 2 — Requests
Dynamic request form builder (versioned), client request submission, request lifecycle & statuses, agency triage
inbox (assign, prioritize, convert to tasks), SLA timers groundwork.

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
