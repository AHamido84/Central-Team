# Architecture

Status: **Phases 0–1 built** · Owner: platform team · Related: `DATA_MODEL.md`, `UI.md`, `DECISIONS.md`

## 1. System overview

```mermaid
flowchart LR
  subgraph Browser
    A["Agency app<br/>/dashboard, /admin, ..."]
    P["Client portal<br/>/portal/..."]
  end

  subgraph Vercel["Vercel (custom domain)"]
    PX[proxy.ts<br/>session refresh · side routing · locale · headers]
    RSC[Server Components<br/>module queries]
    SA["Server Actions<br/>defineAction()"]
    API["Route handlers<br/>/auth/confirm, /auth/signout, /api/health"]
  end

  subgraph Supabase
    AUTH[Auth<br/>password · magic link · OTP]
    PG[(Postgres<br/>RLS · app.* functions · triggers)]
    RT[Realtime<br/>notifications channel]
    ST[Storage<br/>avatars bucket]
    EF["Edge Functions<br/>event dispatcher (Phase 1+)"]
  end

  MAIL[Email provider<br/>Resend / SMTP / Console]

  A & P --> PX --> RSC & SA
  RSC -- "withRls (role authenticated + JWT claims)" --> PG
  SA -- "withRls + emitEvent" --> PG
  A & P -- "supabase-js (anon key + session)" --> AUTH & RT & ST
  AUTH -- "SMTP · bilingual templates" --> MAIL
  SA --> MAIL
  PG -- "domain_events" --> EF
```

Key properties:

- **One Next.js app, two sides.** Route groups `(agency)` and `(portal)` have separate layouts, navigation
  and guards but share auth, design system and modules.
- **Postgres is the authorization authority.** RLS policies call `app.has_permission()`. The app never
  bypasses RLS for user-initiated work.
- **Event-first mutations.** Every important mutation writes a `domain_events` row in the same transaction;
  future consumers (notifications, automations, AI) subscribe to it without touching the producer.

## 2. Folder structure

```
.
├── CLAUDE.md
├── docs/                          # ARCHITECTURE, DATA_MODEL, UI, ROADMAP, DECISIONS
├── supabase/
│   ├── config.toml                # local stack config (auth hooks, email, ports)
│   ├── migrations/                # SQL — drizzle-kit generated + hand-written (RLS, functions, triggers)
│   ├── seed.sql                   # static reference data (permissions catalog, system roles, flags)
│   └── functions/                 # Edge Functions (Phase 1+: event dispatcher)
├── scripts/
│   ├── seed.ts                    # dev data: agency, ~10 users (via Auth admin API), departments, demo client
│   └── check-i18n.ts              # ar/en key parity
├── emails/                        # React Email templates (invite, magic-link, reset, verify, notification digest)
├── messages/                      # shared i18n namespaces (common, nav, errors, validation)
│   ├── ar/*.json
│   └── en/*.json
├── e2e/                           # Playwright specs + fixtures
├── src/
│   ├── proxy.ts                   # Next 16 "proxy" (formerly middleware)
│   ├── app/
│   │   ├── layout.tsx             # <html lang dir>, fonts, theme, providers
│   │   ├── (auth)/                # /login, /magic-link, /forgot-password, /reset-password,
│   │   │                          # /verify-email, /invite/[token], /onboarding
│   │   ├── (agency)/              # agency layout (sidebar + top bar) — URLs at root
│   │   │   ├── dashboard/
│   │   │   ├── notifications/
│   │   │   ├── settings/          # profile, preferences, notification prefs
│   │   │   └── admin/             # users, invitations, roles, permissions matrix, departments,
│   │   │                          # features, audit log, organization, packages
│   │   │   ├── clients/ messages/ # Phase 1: client management + agency inbox
│   │   │   └── dev/design-system/ # component showcase (design_system:view)
│   │   ├── (portal)/portal/       # client layout — URLs under /portal
│   │   │   ├── page.tsx           # portal home (Phase 0: welcome + profile; Phase 1 fills it)
│   │   │   ├── files/ messages/ company/ notifications/ settings/
│   │   │   └── requests/ approvals/ calendar/  # flag-guarded, upcoming phases
│   │   ├── auth/confirm, auth/signout   # email-link verification, sign out
│   │   └── api/health/
│   ├── components/
│   │   ├── ui/                    # shadcn/ui primitives (owned, themed)
│   │   ├── shell/                 # AppShell, Sidebar, TopBar, Breadcrumbs, CommandPalette
│   │   └── patterns/              # PageHeader, DataTable, EmptyState, StatCard, FileCard, AvatarGroup, ...
│   ├── lib/
│   │   ├── auth/                  # getSession, requireUser, requireSide, session types
│   │   ├── db/                    # drizzle client, withRls(), dbAdmin (service), schema barrel
│   │   ├── permissions/           # can(), loadPermissions(), permission catalog types
│   │   ├── events/                # emitEvent(), event registry & payload types
│   │   ├── flags/                 # isFeatureEnabled(), module registry
│   │   ├── actions/               # defineAction(), Result type, error codes
│   │   ├── email/                 # EmailProvider interface, Resend/SMTP/Console providers, sendEmail()
│   │   ├── i18n/                  # next-intl request config, formats, localized(), DirIcon
│   │   ├── supabase/              # browser/server clients, admin client
│   │   └── utils/
│   ├── modules/
│   │   ├── organizations/         # org settings, feature flags, logo upload
│   │   ├── identity/              # auth actions, profiles, onboarding, avatars, preferences
│   │   ├── invitations/           # tokens, team/client invites, acceptance
│   │   ├── rbac/                  # roles, permission matrix, overrides, team admin
│   │   ├── departments/
│   │   ├── clients/               # clients, portal users, packages + usage ledger
│   │   ├── files/                 # folders, uploads (signed URLs), previews
│   │   ├── messaging/             # threads, comments, mentions, read receipts
│   │   ├── notifications/         # notify(), bell, inbox, preferences
│   │   ├── portal/                # portal home read models
│   │   ├── dashboard/             # agency dashboard read models
│   │   ├── audit/                 # activity_log viewer
│   │   └── design-system/         # /dev/design-system showcase
│   └── styles/globals.css         # design tokens (CSS variables), Tailwind v4 @theme
└── tests/
    ├── unit/                      # permission helper, formatters, schemas
    └── db/                        # RLS integration tests (per table, allow + deny)
```

## 3. Routing & side separation

| Surface | URL space | Route group | Allowed `user_type` |
|---|---|---|---|
| Auth | `/login`, `/magic-link`, `/forgot-password`, `/reset-password`, `/verify-email`, `/invite/[token]`, `/onboarding` | `(auth)` | anyone (onboarding: signed-in, not onboarded) |
| Agency | `/dashboard`, `/notifications`, `/settings/*`, `/admin/*` (+ future `/clients`, `/tasks`, …) | `(agency)` | `agency` |
| Portal | `/portal/*` | `(portal)` | `client` |
| Dev | `/dev/design-system` | `dev` | agency staff in prod; anyone locally |

URL design keeps a future split to subdomains (`app.<domain>` / `portal.<domain>`) a proxy rewrite, not a refactor.

**Three layers of enforcement**

1. **`proxy.ts`** — refreshes the Supabase session cookie, reads custom JWT claims (`user_type`, `org_id`,
   `onboarded`), redirects: unauthenticated → `/login?next=…`; not onboarded → `/onboarding`;
   client on agency URL → `/portal`; agency user on `/portal` → `/dashboard`. Cheap, no DB call.
2. **Layout guards** — `(agency)/layout.tsx` calls `requireSide('agency')`, `(portal)/layout.tsx` calls
   `requireSide('client')`. These re-validate against the DB (`getUser()` + membership), so a stale JWT can't
   slip through.
3. **RLS** — agency-only tables check `app.is_agency_member(org)`; client data checks `app.client_access(client_id)`.

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant X as proxy.ts
  participant L as (side) layout
  participant DB as Postgres (RLS)
  B->>X: GET /admin/roles
  X->>X: refresh session, read claims
  alt no session
    X-->>B: 302 /login?next=/admin/roles
  else user_type = client
    X-->>B: 302 /portal
  else not onboarded
    X-->>B: 302 /onboarding
  else ok
    X->>L: continue
    L->>DB: requireSide('agency') — membership active?
    L->>DB: can('roles:read')?
    alt forbidden
      L-->>B: 403 page (translated)
    else allowed
      L->>DB: queries via withRls (RLS filters rows)
      L-->>B: HTML
    end
  end
```

## 4. Authentication

Supabase Auth handles identities and sessions (`@supabase/ssr`, HTTP-only cookies).

| Flow | Mechanism |
|---|---|
| Email + password | `signInWithPassword`. Public sign-up is **disabled** — accounts are created only via invitation (and seed). |
| Magic link | `signInWithOtp({ shouldCreateUser: false })` — existing users only. |
| Password reset | `resetPasswordForEmail` → `/reset-password` (PKCE code exchange) → `updateUser({ password })`. |
| Email verification | Invited users are verified by accepting the emailed token. Email changes use Supabase "secure email change" → `/verify-email`. |
| Invitations | Our own `invitations` table (not Supabase's invite) for full control: hashed token, expiry (7 days), resend (rotates token), revoke, role(s) + department/client pre-assigned. |
| Onboarding | First login when `profiles.onboarded_at is null`: name, avatar, phone (E.164, SA default), language. |

**Auth emails** (magic link, reset, email change) use GoTrue's own bilingual templates in `supabase/templates/`
(language from `user_metadata.locale`, kept in sync when the user switches language). Links land on
`/auth/confirm?token_hash=…&type=…`, which calls `verifyOtp` server-side — no PKCE state, works across devices.
Invitation and notification emails are rendered with React Email and sent through `EmailProvider` (ADR-017).

**Custom access token hook** (Postgres function `app.custom_access_token_hook`) adds claims:
`org_id`, `user_type` (`agency` | `client`), `client_id` (clients only), `onboarded` (bool).
Permissions are **not** put in the JWT (they would go stale for up to an hour); they're evaluated live in DB.

### Invitation flow

```mermaid
sequenceDiagram
  autonumber
  actor Admin
  participant App as Server Action<br/>invitations.create
  participant DB as Postgres
  participant Mail as EmailProvider
  actor Invitee
  participant Accept as /invite/[token]
  Admin->>App: email, user_type, role(s), department / client
  App->>DB: can('invitations:create')? (RLS enforces too)
  App->>DB: insert invitations (token_hash, expires_at = now()+7d)
  App->>DB: emitEvent('invitation.created')  [same tx]
  App->>Mail: send invite (raw token in link, invitee's language)
  Invitee->>Accept: open link
  Accept->>DB: lookup by sha256(token): pending & not expired?
  Invitee->>Accept: set password (+ confirm)
  Accept->>DB: [service role, audited] auth.admin.createUser(email_confirm=true)<br/>insert organization_members, user_roles, department_members<br/>mark invitation accepted, emitEvent('invitation.accepted')
  Accept-->>Invitee: signed in → /onboarding
```

Resend = new token + new expiry, old token invalid. Revoke = status `revoked`. Accepting an expired /
revoked / used token shows a translated explanation and "ask for a new invite".
If the email already has an account in the org, invite creation is rejected with `already_member`.

## 5. Authorization (RBAC)

### Model

- **Permissions** are a seeded catalog of `resource:action` keys, each with a `side` (`agency` | `client`)
  and localized label/description. Modules declare them in `permissions.ts`; a migration seeds them.
- **Roles** belong to an organization, have a `side`, and a set of permissions (`role_permissions`).
  System roles (`is_system`) can be edited but not deleted; **Super Admin is locked** to all permissions.
- **User roles** (`user_roles`) assign roles to a member within an organization (and within a client for
  client-side roles).
- **Overrides** (`user_permission_overrides`) grant or deny a single permission to a single user.
  **Effective = (∪ role permissions ∪ grants) − denies.** Deny wins.
- **Data scope** (e.g., Account Manager sees only *assigned* clients) is expressed as distinct permissions
  (`clients:read_all` vs `clients:read_assigned`) + relationship checks in the table's RLS policy.
  Permissions stay binary; RLS combines them with relationships.

### Postgres functions (source of truth)

```sql
app.current_user_id() -> uuid                        -- auth.uid()
app.is_org_member(org uuid) -> bool                  -- active membership
app.is_agency_member(org uuid) -> bool
app.has_permission(org uuid, perm text) -> bool      -- effective permission, deny-wins
app.has_client_permission(client uuid, perm text) -> bool -- client-side roles scoped to a client
app.effective_permissions(org uuid) -> setof text    -- used by the app to build can()
```

All `stable`, `security definer`, `set search_path = ''`, owned by a non-login role, `execute` granted to
`authenticated` only. Indexed lookups; per-statement caching via `(select app.has_permission(...))` in policies.

### TypeScript `can()`

```ts
const perms = await loadPermissions();        // one call: app.effective_permissions(org) — cached per request (React cache)
can(perms, 'roles:update');                   // pure function — used in Server Components, actions, and client UI
<Can permission="users:invite">…</Can>        // client component reads a serialized Set passed from the layout
```

`can()` never replaces RLS; it hides UI and rejects early with a nice error. Unit tests cover deny-wins,
side mismatch, locked Super Admin. RLS tests prove the DB rejects the same operations directly.

## 6. Data access: `withRls` and `defineAction`

```ts
// src/lib/db/rls.ts
await withRls(session, async (tx) => { … })
// BEGIN;
//   select set_config('request.jwt.claims', <jwt claims json>, true);
//   set local role authenticated;
//   …queries… (RLS applies, auth.uid() works, triggers see the actor)
// COMMIT;
```

```ts
// src/modules/rbac/server/actions.ts
export const updateRolePermissions = defineAction({
  input: updateRolePermissionsSchema,          // Zod
  permission: 'roles:update',                  // early can() check
  async handler({ input, tx, ctx }) {
    const before = await getRolePermissions(tx, input.roleId);
    await replaceRolePermissions(tx, input.roleId, input.permissionKeys);
    await emitEvent(tx, {
      type: 'role.permissions_updated',
      aggregate: { type: 'role', id: input.roleId },
      payload: { added, removed },
    });
    return { roleId: input.roleId };
  },
  revalidate: ['/admin/roles'],
});
```

`defineAction` guarantees: input validation → session → side check → `can()` → `withRls` transaction →
handler → commit → `revalidatePath` → `Result<T>` with translatable error codes. Rate limiting is opt-in per action.

## 7. Domain events

```ts
emitEvent(tx, { type, aggregate: { type, id }, payload, clientId? })
```

- Inserted into `domain_events` **in the same transaction** as the mutation (transactional outbox) by the
  `emitEvent()` TS helper; RLS only lets a member insert events whose `actor_id` is themselves.
- Event types are a typed registry (`src/lib/events/registry.ts`); payloads are Zod-validated in dev/test.
- Phase 0 events: `user.invited`, `invitation.resent`, `invitation.revoked`, `invitation.accepted`,
  `user.onboarded`, `user.profile_updated`, `user.deactivated`, `user.reactivated`, `role.created`,
  `role.updated`, `role.deleted`, `role.permissions_updated`, `user.roles_changed`,
  `user.permission_override_set`, `department.created`, `department.updated`, `department.members_changed`,
  `feature_flag.toggled`, `organization.updated`.
- **Consumers (Phase 1+)**: a dispatcher (Supabase Database Webhook / `pg_net` → Edge Function, or a
  cron-driven worker) reads unprocessed events, fans out to handlers (notifications rules, automations, AI
  indexing), and marks `processed_at` per consumer (`domain_event_deliveries`). Phase 0 builds the producer
  side and the table; one Phase 0 consumer exists inline: invitations send notification emails directly.

```mermaid
flowchart LR
  SA[Server Action] -->|same tx| T[(domain tables)]
  SA -->|same tx| E[(domain_events)]
  T -->|trigger| AL[(activity_log)]
  E -. Phase 1+ .-> D[Dispatcher]
  D -.-> N[Notification rules]
  D -.-> AU[Automation engine · Phase 7]
  D -.-> AI[AI indexing · Phase 8]
```

**Audit vs events** — `activity_log` is *what changed* (row-level before/after via a generic trigger on
audited tables, for compliance and the audit UI). `domain_events` is *what happened* in business terms
(for reactions). Both carry `actor_id` and `organization_id`.

## 8. Feature flags

- `feature_flags` (global catalog: key, module, default, description) + `organization_features`
  (per-org override, enabled, optional JSON config).
- `isFeatureEnabled(org, key)` in TS (request-cached); `app.feature_enabled(org, key)` in SQL for RLS where
  a module's data must be dark when disabled.
- **Module registry** (`src/lib/flags/modules.ts`): each module declares its flag key, nav entries and
  required permissions. Sidebar and command palette are generated from it, so disabled modules disappear
  everywhere at once. Admin UI: `/admin/features` (toggle per module; Super Admin only).
- Phase 0 flags: `module.portal`, `module.notifications_email`, `ui.command_palette`, `dev.design_system`
  (+ placeholders for later modules registered as disabled — they have no UI until their phase ships).

## 9. Notifications infrastructure

- `notifications` rows are **language-neutral**: `type` + `params` (JSON) + `link`; the UI renders them via
  i18n (`notifications.types.<type>`), so a user switching language sees all history translated.
- `notification_preferences` per user × notification category × channel (`in_app`, `email`), with defaults.
- `notify(tx, { userIds, type, params, link })` helper: inserts in-app rows, and enqueues email for users whose
  preference allows it (Phase 0: sent after commit via `EmailProvider`; Phase 1 moves to the dispatcher).
- **Realtime**: the bell subscribes to `postgres_changes` on `notifications` filtered by `user_id=eq.<uid>`;
  RLS makes sure a user only ever receives their own rows. Unread count via TanStack Query, invalidated on events.
- UI: bell with unread badge + popover (latest 10), full inbox page (tabs All / Unread, mark read, mark all read),
  preferences page. Phase 0 real producers: invitation accepted (to inviter), roles changed (to the user).

## 10. Email

```ts
interface EmailProvider { send(msg: { to; subject; react | html; text; tags?; replyTo? }): Promise<{ id: string }> }
```

Implementations: `ResendProvider` (prod), `SmtpProvider` (local → Mailpit at :54324), `ConsoleProvider` (tests).
Selected by `EMAIL_PROVIDER` env. Templates in `emails/` with a shared bilingual layout (RTL-aware), plain-text
fallback, and preview via `pnpm email:dev`.

## 11. i18n

- next-intl with **no locale in the URL** (app, not SEO content) — locale from profile → cookie → header → `ar`.
- `src/lib/i18n/request.ts` loads shared `messages/<locale>/*.json` + every module's `messages/<locale>.json`
  under the module's namespace.
- Formats preset (`src/lib/i18n/formats.ts`): `ar` → `ar-SA-u-nu-latn-ca-gregory`; `en` → `en-SA`
  (fallback `en-GB`); currency `SAR`; time zone from profile (default `Asia/Riyadh`).
- Language switcher updates cookie immediately and profile (if signed in), then `router.refresh()`.

## 12. Theming

- Tokens as CSS variables in `globals.css` (`:root` and `.dark`), mapped into Tailwind v4 `@theme`.
- `next-themes` with `class` strategy; user preference (`system` | `light` | `dark`) stored in profile.
- See `UI.md` for the token set.

## 13. Security headers & hardening

CSP (nonce-based for scripts; Supabase + Resend + storage origins allow-listed), HSTS (prod), `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal. Rate limit on auth routes and
invite acceptance (Postgres-backed token bucket in Phase 0 to avoid adding infra; swappable). Avatars in a
private bucket with org-scoped storage policies, served through signed URLs; images validated (type, ≤ 2 MB) and
resized client-side before upload.

## 14. Environments & deployment

| Env | App | DB | Email |
|---|---|---|---|
| Local | `pnpm dev` | Supabase CLI (Docker) | Mailpit |
| Preview | Vercel preview (protected by Vercel auth) | Supabase branch or staging project | Resend (sandbox domain) |
| Production | Vercel, custom domain (e.g. `app.<agency-domain>`) | Supabase Cloud (region: see open question) | Resend, verified domain |

CI (GitHub Actions): install → lint → typecheck → unit → start Supabase → migrate → `test:db` → build → Playwright.
Migrations are applied to staging/prod by CI (`supabase db push`) on merge, never by hand.

## 15. Extension points for later phases

| Need | Where it plugs in |
|---|---|
| New module (e.g. Requests) | `src/modules/requests`, flag in registry, permissions seeded, nav from registry |
| React to something | Subscribe a handler to a `domain_events` type in the dispatcher |
| Notify a user | `notify()` + a `notifications.types.*` translation + a preference category |
| Client-scoped data | `client_id` column + `app.client_access(client_id)` in RLS |
| Integrations (Phase 7) | `integration_connections` per org/client, secrets in Supabase Vault, webhooks under `/api/hooks/<provider>` |
| AI (Phase 8) | Consumes `domain_events` + read models; pgvector for embeddings; provider behind an interface |

## 16. Phase 1 — client portal flows

### Client access model

```mermaid
flowchart TB
  subgraph Agency
    RA[clients:read_all] --> ACC
    RS[clients:read_assigned] -->|account manager or client_assignments| ACC
  end
  subgraph Client
    CU[client_users active + org membership active] --> ACC2
  end
  ACC[app.agency_can_access_client] --> V1[sees internal + client items]
  ACC2[app.is_client_member] --> V2[sees visibility = client only]
```

Write rights are separate permissions: agency `files:upload`, `files:manage`, `messages:send`, `client_users:manage`,
`packages:assign`; client `portal_files:upload`, `portal_messages:send`, `portal_users:manage`, `portal_company:update`.
A Client Viewer holds only `portal:access` + `portal_users:read`.

### Upload flow (ADR-020)

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as Server actions
  participant DB as Postgres (RLS)
  participant S as Storage (client-files, private)
  B->>A: requestFileUpload(client, folder|thread, name, mime, size, visibility)
  A->>A: rights + classifyUpload (type & size limits)
  A->>DB: folder/thread visible to caller? (RLS)
  A->>S: createSignedUploadUrl(org/<org>/clients/<client>/<folder|root>/<fileId>-<slug>)
  A-->>B: signed URL
  B->>S: PUT file (XHR, progress events)
  B->>A: finalizeFileUpload(fileId, …)
  A->>S: object exists at the expected path? size ok?
  A->>DB: insert files (RLS) + emitEvent(file.uploaded)
  A-->>B: ok → notify client users / agency team (after commit)
```

### Messaging

`threads` (polymorphic `subject_type/subject_id`, `visibility`) → `comments` (`visibility`, `mentions uuid[]`) →
`comment_attachments` (files with `source = 'attachment'`) and `thread_reads` (read receipts). The conversation view
subscribes to Realtime `comments` and `thread_reads` for its thread (after `ensureRealtimeAuth()`, ADR-024); RLS decides
which rows each subscriber receives, so internal notes never reach client sockets. After commit, `postComment` fans out
`message_new` / `mention` notifications (in-app + email per preferences) to the correct side with side-specific links.

### Package usage

`getPackageUsage(tx, clientPackageId)` → allowed per item (from `package_items`) vs used (sum of
`package_usage_entries`), plus period progress. Runs inside the caller's RLS transaction, so the same service powers
the agency client page and the portal home.
