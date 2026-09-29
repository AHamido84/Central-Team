# Data Model

Status: **Phases 0–2**. Conventions from `CLAUDE.md §6`: plural `snake_case` tables, `uuid` PKs,
`timestamptz` UTC, `organization_id` on tenant-scoped tables, `LocalizedText = jsonb {ar, en}`,
`created_at` / `updated_at` on every mutable table (`updated_at` maintained by trigger).

## 1. Phase 0 ERD

```mermaid
erDiagram
  organizations ||--o{ organization_members : has
  organizations ||--o{ clients : serves
  organizations ||--o{ roles : defines
  organizations ||--o{ departments : has
  organizations ||--o{ invitations : issues
  organizations ||--o{ organization_features : configures
  organizations ||--o{ domain_events : records
  organizations ||--o{ activity_log : records
  organizations ||--o{ notifications : scopes

  auth_users ||--|| profiles : "1:1"
  profiles ||--o{ organization_members : "member of"
  clients ||--o{ organization_members : "client users"

  roles ||--o{ role_permissions : grants
  permissions ||--o{ role_permissions : "granted by"
  roles ||--o{ user_roles : "assigned via"
  profiles ||--o{ user_roles : holds
  clients |o--o{ user_roles : "client-scoped"
  permissions ||--o{ user_permission_overrides : ""
  profiles ||--o{ user_permission_overrides : ""

  departments ||--o{ department_members : ""
  profiles ||--o{ department_members : ""

  invitations }o--o{ roles : "pre-assigns (role_ids)"

  feature_flags ||--o{ organization_features : ""

  profiles ||--o{ notifications : receives
  profiles ||--o{ notification_preferences : sets

  organizations {
    uuid id PK
    text slug UK
    jsonb name "LocalizedText"
    text default_locale "ar"
    text default_timezone "Asia/Riyadh"
    char3 default_currency "SAR"
    text logo_path
    jsonb settings
  }
  profiles {
    uuid id PK "= auth.users.id"
    text full_name
    text email "mirror of auth email"
    text phone "E.164"
    text avatar_path
    text locale "ar | en"
    text theme "system | light | dark"
    text timezone
    text calendar "gregory | islamic-umalqura"
    timestamptz onboarded_at
  }
  organization_members {
    uuid id PK
    uuid organization_id FK
    uuid user_id FK
    text user_type "agency | client"
    uuid client_id FK "required when client"
    text job_title
    text status "active | deactivated"
    uuid invited_by FK
    timestamptz joined_at
  }
  clients {
    uuid id PK
    uuid organization_id FK
    jsonb name "LocalizedText"
    text slug
    text status "active | archived"
    text logo_path
  }
  permissions {
    text key PK "resource:action"
    text resource
    text action
    text side "agency | client"
    jsonb label "LocalizedText"
    jsonb description "LocalizedText"
    text module
    int sort_order
  }
  roles {
    uuid id PK
    uuid organization_id FK
    text key "super_admin, ..."
    jsonb name "LocalizedText"
    jsonb description
    text side "agency | client"
    bool is_system
    bool is_locked "Super Admin"
  }
  role_permissions {
    uuid role_id PK, FK
    text permission_key PK, FK
  }
  user_roles {
    uuid id PK
    uuid organization_id FK
    uuid user_id FK
    uuid role_id FK
    uuid client_id FK "null for agency roles"
    uuid assigned_by FK
  }
  user_permission_overrides {
    uuid id PK
    uuid organization_id FK
    uuid user_id FK
    text permission_key FK
    text effect "grant | deny"
    text reason
  }
  departments {
    uuid id PK
    uuid organization_id FK
    text key "design, video, ..."
    jsonb name "LocalizedText"
    text color "token name"
    text icon "lucide name"
    int sort_order
    bool is_archived
  }
  department_members {
    uuid department_id PK, FK
    uuid user_id PK, FK
    uuid organization_id FK
    bool is_lead
  }
  invitations {
    uuid id PK
    uuid organization_id FK
    text email
    text user_type
    uuid client_id FK
    uuid_array role_ids
    uuid department_id FK
    text locale "email language"
    text token_hash UK "sha256"
    text status "pending | accepted | revoked | expired"
    timestamptz expires_at
    int send_count
    timestamptz last_sent_at
    uuid invited_by FK
    uuid accepted_by FK
    timestamptz accepted_at
  }
  feature_flags {
    text key PK
    text module
    bool default_enabled
    jsonb description
  }
  organization_features {
    uuid organization_id PK, FK
    text flag_key PK, FK
    bool enabled
    jsonb config
    uuid updated_by FK
  }
  domain_events {
    uuid id PK "uuid v7"
    uuid organization_id FK
    text type
    text aggregate_type
    uuid aggregate_id
    uuid client_id
    uuid actor_id
    jsonb payload
    int version
    timestamptz occurred_at
  }
  activity_log {
    bigint id PK
    uuid organization_id FK
    uuid actor_id
    text action "insert | update | delete"
    text table_name
    uuid record_id
    jsonb before
    jsonb after
    text[] changed_fields
    text request_id
    inet ip
    timestamptz created_at
  }
  notifications {
    uuid id PK
    uuid organization_id FK
    uuid user_id FK
    text type
    text category
    jsonb params
    text link
    uuid event_id FK
    timestamptz read_at
    timestamptz created_at
  }
  notification_preferences {
    uuid user_id PK, FK
    uuid organization_id PK, FK
    text category PK
    bool in_app
    bool email
  }
```

Supporting (not in diagram): `rate_limits (key, window_start, count)` — used by auth rate limiting;
`domain_event_deliveries (event_id, consumer, processed_at, attempts, last_error)` — created in Phase 0, used from Phase 1.

### Key constraints & indexes

- `organization_members`: unique `(organization_id, user_id)`; check `user_type='client' ⇔ client_id is not null`.
- `roles`: unique `(organization_id, key)`; `user_roles`: unique `(user_id, role_id, coalesce(client_id, nil))`;
  trigger ensures `role.side` matches member `user_type`, and client roles carry the member's `client_id`.
- `invitations`: partial unique `(organization_id, lower(email)) where status = 'pending'`.
- `department_members`: only `agency` members (trigger check).
- `activity_log`, `domain_events`: append-only (no update/delete policies; revoke `update, delete` from `authenticated`).
  Index `(organization_id, created_at desc)`, `(table_name, record_id)`, `(type, occurred_at)`.
- `notifications`: index `(user_id, read_at nulls first, created_at desc)`; added to `supabase_realtime` publication.
- All FK columns indexed (RLS joins rely on them).

### Audited tables (generic `app.audit_trigger`)

`organizations`, `organization_members`, `profiles`, `clients`, `roles`, `role_permissions`, `user_roles`,
`user_permission_overrides`, `departments`, `department_members`, `invitations` (token_hash redacted),
`organization_features`. Excluded: high-volume/self-describing tables (`notifications`, `domain_events`, `activity_log`).

## 2. Seeded reference data

### Permission catalog (Phase 0)

| Resource | Actions | Side |
|---|---|---|
| `organization` | `read`, `update` | agency |
| `users` | `read`, `invite`, `update`, `deactivate` | agency |
| `invitations` | `read`, `create`, `resend`, `revoke` | agency |
| `roles` | `read`, `create`, `update`, `delete`, `assign` | agency |
| `permissions` | `override` | agency |
| `departments` | `read`, `manage` | agency |
| `clients` | `read_all`, `read_assigned`, `manage` | agency |
| `feature_flags` | `manage` | agency |
| `audit_log` | `read` | agency |
| `design_system` | `view` | agency |
| `portal` | `access` | client |
| `client_users` | `read`, `invite`, `manage` | client |

Later phases append to the catalog (e.g. `requests:create`, `tasks:assign`, `campaigns:read`, `leads:manage`).

### System roles & default grants

| Role (key) | Side | Default permissions |
|---|---|---|
| Super Admin (`super_admin`) | agency | **all** (locked) |
| Admin / Operations Manager (`admin`) | agency | all agency permissions except `feature_flags:manage` |
| Account Manager (`account_manager`) | agency | `users:read`, `departments:read`, `clients:read_assigned`, `invitations:read/create/resend/revoke` (client invites only — enforced by RLS on `user_type`), `design_system:view` |
| Team Lead (`team_lead`) | agency | `users:read`, `departments:read`, `clients:read_all`, `design_system:view` |
| Specialist (`specialist`) | agency | `users:read`, `departments:read`, `clients:read_assigned` |
| Client Owner (`client_owner`) | client | `portal:access`, `client_users:read/invite/manage` |
| Client Member (`client_member`) | client | `portal:access`, `client_users:read` |
| Client Viewer (`client_viewer`) | client | `portal:access` |

Everyone can always read/update **their own** profile and notification preferences (not permission-gated).

### Departments

Design (`design`), Video (`video`), Content (`content`), Media Buying (`media_buying`), Account Management (`account_management`).

### Dev seed (`pnpm db:reset`)

1 organization ("Demo Agency" / "وكالة تجريبية"), 10 agency users spread across departments with every
agency role represented, 1 demo client with 3 client users (Owner, Member, Viewer), a few pending/expired
invitations, sample notifications. All seed users: password `Passw0rd!` (local only), emails `@demo.local`.

## 3. RLS strategy

**Principles**

1. `alter table … enable row level security` on every table, **including** reference tables (`permissions`,
   `feature_flags` → `select` for `authenticated`, no writes).
2. Policies are written per command (`select`, `insert`, `update`, `delete`), never `for all`, so each can be
   tested and reasoned about separately.
3. Policies only call `app.*` helper functions (security definer, `search_path=''`), wrapped in `(select …)`
   so Postgres evaluates them once per statement.
4. Tenant isolation first: every policy on a tenant table includes `app.is_org_member(organization_id)`
   (implied by `has_permission`, which checks membership).
5. Side isolation: agency-only tables additionally require `app.is_agency_member(organization_id)`.
6. `anon` gets nothing, except the invitation lookup RPC (`app.get_invitation_preview(token)`, returns minimal
   fields: org name, email masked, status) — no direct table access.
7. Append-only tables: `insert` via helper/trigger only; no `update`/`delete` for anyone but `service_role`.

**Representative policies**

| Table | select | insert / update / delete |
|---|---|---|
| `profiles` | self; or agency member of a shared org with `users:read`; client users see profiles of members of the same client + their assigned agency contacts (Phase 1) | update self only (and `users:update` for admin fields via RPC) |
| `organization_members` | self row; `users:read` (agency); `client_users:read` scoped to same `client_id` | via RPC/actions: `users:update`, `users:deactivate`; client side `client_users:manage` on same client, never agency rows |
| `roles`, `role_permissions` | `roles:read` (agency); client users can read client-side roles (for their team page) | `roles:create/update/delete`; locked role rows immutable (trigger + policy) |
| `user_roles` | self; `roles:read` | `roles:assign`; client owners may assign client roles within own client; nobody can grant a role containing permissions they don't hold (anti-escalation trigger) |
| `user_permission_overrides` | self; `roles:read` | `permissions:override` (anti-escalation applies) |
| `departments`, `department_members` | agency members | `departments:manage` |
| `invitations` | `invitations:read` (agency); client owners see their client's invites | `invitations:create/resend/revoke`; client owners only for `user_type='client'` + own `client_id`; account managers only for client invites |
| `clients` | `clients:read_all`, or `read_assigned` + assignment (Phase 1 table), or client member of that client | `clients:manage` |
| `organization_features` | org members (read — the UI needs flags) | `feature_flags:manage` |
| `domain_events` | none for users (service/consumers only) | insert via `app.emit_event()` security definer |
| `activity_log` | `audit_log:read` | trigger only |
| `notifications` | `user_id = auth.uid()` | update self (`read_at` only, column-level grant); insert via `app.notify()` |
| `notification_preferences` | self | self |

**Anti privilege-escalation**: a user may only grant (via role edit, role assignment, override, or invitation)
permissions that they themselves hold; Super Admin is exempt. Enforced by a trigger calling
`app.assert_can_grant(permission_keys)` so it holds even for direct API calls.

**Testing** (`tests/db`): for each table, as each seeded persona (super admin, admin, account manager, specialist,
client owner, client viewer, other-org user, anon) assert allowed and denied `select/insert/update/delete`.
Plus a meta-test: every table in `public`/`app` schemas has RLS enabled and ≥ 1 policy.

## 3b. Phase 1 — client portal entities

```mermaid
erDiagram
  clients ||--o| client_notes : "internal notes"
  clients ||--o{ client_users : "portal users"
  roles ||--o{ client_users : "client role"
  clients ||--o{ client_assignments : "agency staff"
  profiles ||--o{ clients : "account manager"
  packages ||--o{ package_items : ""
  packages ||--o{ client_packages : ""
  clients ||--o{ client_packages : "per period"
  client_packages ||--o{ package_usage_entries : "usage ledger"
  clients ||--o{ file_folders : ""
  file_folders ||--o{ files : ""
  clients ||--o{ threads : ""
  threads ||--o{ comments : ""
  comments ||--o{ comment_attachments : ""
  files ||--o{ comment_attachments : ""
  threads ||--o{ thread_reads : "read receipts"

  clients {
    uuid id PK
    jsonb name "LocalizedText"
    text slug "unique per org"
    text industry
    text city
    text website
    jsonb social "instagram, x, tiktok, snapchat, linkedin, youtube"
    text status "onboarding | active | paused | archived"
    text logo_path
    uuid account_manager_id FK
    date start_date
  }
  client_notes {
    uuid client_id PK
    text body "agency-only via RLS"
  }
  client_users {
    uuid id PK
    uuid client_id FK
    uuid user_id FK
    uuid role_id FK "client_owner | client_member | client_viewer"
    bool can_approve
    text status "active | deactivated"
  }
  packages {
    uuid id PK
    jsonb name
    int price_minor "halalas per month"
  }
  package_items {
    uuid package_id FK
    text item_type "post, reel, story, video, photo_shoot, ad_campaign, revision_round"
    int quantity
  }
  client_packages {
    uuid id PK
    uuid client_id FK
    uuid package_id FK
    date period_start
    date period_end
  }
  package_usage_entries {
    uuid id PK
    uuid client_package_id FK
    text item_type
    int quantity
    text source_type "deliverable, revision, manual"
    uuid source_id
  }
  file_folders {
    uuid id PK
    uuid client_id FK
    uuid parent_id FK
    text kind "month | project | type | brand | custom"
    text visibility "internal | client"
  }
  files {
    uuid id PK
    uuid client_id FK
    uuid folder_id FK
    text storage_path
    text kind "image | video | pdf | document | archive | other"
    text visibility "internal | client"
    text source "library | attachment"
    text uploader_side "agency | client"
  }
  threads {
    uuid id PK
    uuid client_id FK
    text subject_type "client | request | deliverable"
    uuid subject_id "polymorphic"
    text visibility "internal | client"
  }
  comments {
    uuid id PK
    uuid thread_id FK
    text author_side "agency | client"
    text body
    text visibility "internal | client"
    uuid_array mentions
  }
```

**Client roles live on `client_users.role_id`** (ADR-018): a client user's role is scoped to one client, and a person
could belong to several clients with different roles. `user_roles` stays agency-only.

**Package usage** is a ledger (`package_usage_entries`) rather than counters: Phase 3 deliverables and revision rounds
append rows with `source_type/source_id`, and `getPackageUsage()` sums them per item type for the current period.

**Visibility rules** (enforced by RLS, not only by queries):

| Item | Agency staff with access to the client | Client users of that client |
|---|---|---|
| `files` / `file_folders` with `visibility = 'client'` | ✅ | ✅ (not soft-deleted; parent folder also client-visible) |
| `files` / `file_folders` with `visibility = 'internal'` | ✅ | ❌ |
| `threads` with `visibility = 'internal'` | ✅ | ❌ |
| `comments` with `visibility = 'internal'` (internal notes inside a client thread) | ✅ | ❌ |
| `client_notes` | ✅ | ❌ |
| Writing files / messages | `files:upload`, `messages:send` | `portal_files:upload`, `portal_messages:send` (Viewer has neither) |

Triggers force every client-scoped row to carry its client's `organization_id`, and force comments in an internal
thread to be internal, so a crafted request can't leak data across tenants or visibility levels.

## 3c. Phase 2 — requests (revision 2)

```mermaid
erDiagram
  request_types ||--o{ requests : "typed by"
  clients ||--o{ requests : submits
  requests ||--o{ request_status_history : "transitions"
  requests ||--o{ request_events : "internal changes"
  requests ||--o{ request_attachments : ""
  files ||--o{ request_attachments : ""
  requests ||--|| threads : "discussion (subject_type = request)"
  requests ||--o| package_usage_entries : "consumes (source_type = request)"
  profiles ||--o{ requests : "assignee (AM) / author"

  request_types {
    uuid id PK
    text key "unique per org"
    jsonb name "LocalizedText"
    jsonb description "LocalizedText"
    text icon "fixed icon list"
    text category "design | video | content | ads | web | branding | other"
    text default_priority "low | normal | high | urgent"
    int sla_days "working days to deliver (null = no SLA)"
    text package_item_type "post | reel | story | … (null = not counted)"
    bool is_active "visible to clients"
    jsonb form_schema "{ fields: RequestFormField[] }"
    int schema_version "bumped on every form change"
    int sort_order
  }
  requests {
    uuid id PK
    uuid client_id FK
    uuid request_type_id FK
    int number "per client, assigned on submit"
    text reference "NAJD-0042"
    text title
    jsonb brief "{ fieldId: value }"
    jsonb form_snapshot "fields the brief was written against"
    int schema_version
    jsonb reference_links "string[]"
    text status "draft … closed | rejected | cancelled"
    text priority
    uuid assignee_id FK "account manager"
    uuid created_by FK "author (drafts are private to them)"
    uuid submitted_by FK
    date desired_date "client"
    date due_date "SLA, agency-editable"
    bool is_extra "over package quota (computed on submit, agency-editable)"
    bool is_billable
    timestamptz submitted_at
    timestamptz first_response_at
    timestamptz accepted_at
    timestamptz delivered_at
    timestamptz closed_at
    timestamptz last_activity_at
  }
  request_status_history {
    uuid id PK
    uuid request_id FK
    text from_status
    text to_status
    text reason "required for needs_info / rejected"
    uuid actor_id
    text actor_side "agency | client | system"
  }
  request_events {
    uuid id PK
    uuid request_id FK
    text type "assigned | priority_changed | due_date_changed | flags_changed | brief_updated"
    text from_value
    text to_value
    text visibility "internal | client"
  }
  request_attachments {
    uuid request_id PK
    uuid file_id PK
    text field_id "brief file field, or null = general attachment"
  }
```

**Form schema.** `request_types.form_schema.fields` is an ordered array of
`{ id, type, label: LocalizedText, help?, required, options?, min?, max?, maxLength?, maxItems?, showIf? }` with
`type ∈ short_text | long_text | number | single_select | multi_select | date | file | links | platforms | dimensions |
color | checkbox`. `showIf = { field, equals }` shows a field only when an **earlier** field has that value (select /
checkbox / platforms); hidden fields are never required and are dropped from the saved brief. `validateBrief()` is the
single validator (portal wizard, server actions, builder preview); `draft` mode skips "required". Editing a type bumps
`schema_version`; each request stores `form_snapshot`, so old briefs always render with the questions they answered.

**Lifecycle** (`requestTransitions` in TS ≡ `app.request_transition_allowed(from, to, side)` in SQL):

| From | Client may move to | Agency may move to |
|---|---|---|
| `draft` | `submitted` (drafts are deleted, not cancelled) | — (agency never sees drafts) |
| `submitted` | `cancelled` | `under_review`, `needs_info`*, `accepted`, `rejected`* |
| `under_review` | `cancelled` | `needs_info`*, `accepted`, `rejected`* |
| `needs_info` | `under_review` (resubmit after editing), `cancelled` | `under_review` |
| `accepted` | — | `in_progress` |
| `in_progress` | — | `in_review`, `delivered` |
| `in_review` | — | `in_progress`, `delivered` |
| `delivered` | `closed` | `closed`, `in_progress` (rework) |
| `rejected` | — | `under_review` (reopen) |
| `closed`, `cancelled` | — | — |

\* reason required (enforced by the history trigger). Accept / reject / needs-info / priority / due date / assignee /
flags need `requests:triage`; the assignee with `requests:update` may move accepted work through in progress → delivered.

**Triggers.** On submit: per-client `number` + `reference` (`clients.request_prefix`, advisory lock), `submitted_at`,
`due_date` = submit date + `sla_days` working days (Fri/Sat skipped, org time zone), `is_extra` from the package quota
(`app.request_quota`), thread creation. Client users may change `title / brief / reference_links / desired_date /
priority (low–high)` only in `draft` or `needs_info`; everything else is server-owned. Every status change writes
`request_status_history`; assignment/priority/due date/flags write internal `request_events`, brief edits a client-visible one.
**Package consumption:** entering `accepted` inserts one `package_usage_entries` row (`source_type = 'request'`) into the
client package covering today when the type counts against an item the package includes and the request isn't extra;
`rejected` / `cancelled` or marking it extra removes it (idempotent, one row per request).

**RLS**

| Table | Agency | Client users of that client |
|---|---|---|
| `request_types` | read: members; write: `request_types:manage` | read active types |
| `requests` | read `requests:read` + client access, never drafts; update: `requests:triage`, or `requests:update` when assignee | read non-drafts + own drafts; insert/update: `portal_requests:create` (Viewer read-only); delete own drafts |
| `request_status_history` | read with the request | read with the request |
| `request_events` | read with the request | `visibility = 'client'` only |
| `request_attachments` | read with the request; insert by the file's uploader | same |

Internal notes are internal comments in the request thread (existing messaging RLS).

## 3d. Phase 3 — tasks, workflows, deliverables & approvals

```mermaid
erDiagram
  request_types ||--o{ workflow_templates : "default workflow"
  workflow_templates ||--o{ workflow_template_steps : "ordered steps"
  requests ||--o{ tasks : "converted into"
  workflow_template_steps ||--o{ tasks : "generated from"
  task_statuses ||--o{ tasks : status
  tasks ||--o{ tasks : subtasks
  tasks ||--o{ task_members : "assignees / watchers"
  tasks ||--o{ task_dependencies : "blocked by"
  tasks ||--o{ task_checklist_items : ""
  tasks ||--o{ task_attachments : ""
  tasks ||--o{ time_entries : ""
  tasks ||--o{ deliverables : produces
  requests ||--o{ deliverables : ""
  deliverables ||--o{ deliverable_versions : ""
  deliverable_versions ||--o{ deliverable_version_files : files
  deliverable_versions ||--o{ approvals : decisions
  deliverable_versions ||--o{ annotations : ""
  annotations ||--o{ annotation_replies : thread
  profiles ||--o{ saved_views : ""
```

| Table | Key columns | Notes |
|---|---|---|
| `task_statuses` | `key`, `name` (AR/EN), `category` (`todo · active · review · changes · done · blocked`), `color`, `sort_order`, `is_default` | Per organization, editable. Logic keys off the **category**, never the name. Seeded: To do, In progress, In review, Changes requested, Done, Blocked. |
| `workflow_templates` | `request_type_id?`, `name`, `description`, `is_active`, `is_default` | One default template per request type (partial unique index). |
| `workflow_template_steps` | `template_id`, `name`, `department_id?`, `assignee_mode` (`account_manager · role · user · none`), `assignee_role_id?`, `assignee_user_id?`, `sla_days`, `depends_on uuid[]` (step ids), `requires_internal_review`, `requires_client_approval`, `deliverable_type?`, `sort_order` | Dependencies must point to steps of the same template (trigger, no cycles). |
| `tasks` | `client_id` (required), `request_id?`, `parent_id?` (one level of subtasks), `workflow_step_id?`, `number` (per org, shown `T-123`), `title`, `description` (Markdown), `department_id?`, `status_id` + denormalized `status_category`, `priority`, `start_date`, `due_date`, `estimate_minutes`, `tags text[]`, `reviewer_id?`, `position` (board order), `requires_internal_review`, `requires_client_approval`, `completed_at`, reminder markers | Agency-only. Status category maintained by trigger; `completed_at` set/cleared with `done`. |
| `task_members` | `task_id`, `user_id`, `role` (`assignee · watcher`) | Active agency members only (trigger). |
| `task_dependencies` | `task_id`, `depends_on_id` | Same client, no self/cycles (trigger). A task whose blockers are all done is *unblocked* → event. |
| `task_checklist_items` | `task_id`, `body`, `is_done`, `sort_order`, `done_by`, `done_at` | |
| `task_attachments` | `task_id`, `file_id` | Files with `source = 'attachment'`, `visibility = 'internal'`. |
| `time_entries` | `task_id`, `user_id`, `started_at`, `ended_at?`, `minutes`, `note`, `source` (`timer · manual`) | Internal only. One running timer per user (partial unique index). Users write only their own. |
| `saved_views` | `owner_id`, `is_shared`, `name`, `layout` (`board · list · table · calendar`), `config jsonb` (filters, grouping, swimlanes, sort) | Personal or shared with the agency. |
| `deliverables` | `client_id`, `request_id?`, `task_id?`, `type` (`design · video · copy · document · other`), `title`, `status`, `requires_internal_review`, `requires_client_approval`, `current_version_id`, `version_count`, `revision_rounds`, `scheduled_for?`, `approved_at`, `client_visible_at`, `reminded_at` | Status: `in_progress → internal_review ⇄ internal_changes → client_review ⇄ client_changes → approved`; stages skipped when not required. |
| `deliverable_versions` | `deliverable_id`, `number`, `notes`, `status`, `uploaded_by`, `submitted_at`, `sent_to_client_at`, `decided_at` | A new version restarts review; undecided older versions become `superseded`, decided ones keep their decision. |
| `deliverable_version_files` | `version_id`, `file_id`, `sort_order` | Files with `source = 'deliverable'` (+ `thumbnail_path`, `width`, `height`, `duration_seconds` on `files`). |
| `approvals` | `deliverable_id`, `version_id`, `stage` (`internal · client`), `decision` (`approved · changes_requested`), `reviewer_id`, `comment` | Insert-only. A trigger validates the stage against the version status, requires a comment for changes, and advances version → deliverable → task (→ request `delivered`). |
| `annotations` | `version_id`, `file_id?`, `kind` (`point · timestamp · general`), `x`, `y` (0–1), `time_seconds`, `body`, `visibility` (`internal · client`), `author_side`, `resolved_at`, `resolved_by` | Each annotation is a thread (`annotation_replies`), resolvable. |
| `annotation_replies` | `annotation_id`, `author_id`, `author_side`, `body` | Inherits the annotation's visibility. |

Changes to existing tables: `threads.subject_type` gains `task` (internal task comments), `files.source` gains
`deliverable`, `requests` gains `workflow_template_id` and `converted_at`.

**Lifecycle rules (triggers)**
- *Convert to tasks* (action, one transaction): accept the request if needed → one task per template step with
  dependencies, assignee (account manager / first client-team member with the role / a fixed user), reviewer
  (client account manager), due dates computed step by step (start = latest due date of its blockers, due = start +
  `sla_days` working days) and a deliverable for steps that produce one → request `in_progress`. Idempotent
  (`converted_at`).
- *Review*: submitting a version moves it to `internal_review` (or straight to `client_review` when the step needs no
  internal review) and the task to its `review` status. Internal approval sends it to the client if required, else
  approves. Changes requested (internal or client) → task back to `changes` with the feedback; a new version restarts
  the review.
- *Revision rounds*: every client "changes requested" writes one `package_usage_entries` row
  (`item_type = 'revision_round'`, `source_type = 'approval'`); the portal warns when the package allowance is used up.
- *Delivered*: when every deliverable of a request is approved, the request moves to `delivered`.

**RLS**

| Table | Agency | Client users of that client |
|---|---|---|
| `task_statuses`, `workflow_*` | read: agency members; write: `workflows:manage` | — |
| `tasks` and task child tables | read `tasks:read` + client access; write `tasks:create/update/delete` | — (never) |
| `time_entries` | own entries; everyone's with `time:read_all` | — |
| `saved_views` | own + shared | — |
| `deliverables` | read with `tasks:read` + client access; write `deliverables:manage` | only once sent for client approval (`client_visible_at`) |
| `deliverable_versions` / `_files` | same | only versions sent to the client |
| `files` (`source = 'deliverable'`) | client access | only files of versions sent to the client |
| `approvals` | all stages; insert internal with `deliverables:review` | `stage = 'client'` only; insert when `can_approve` and the version awaits them |
| `annotations` / replies | all | `visibility = 'client'` only; insert on versions they can see |

Portal progress on the request page comes from `app.request_progress(request_id)` (security definer): step names and
state only — never internal tasks, assignees or comments.


## 3e. Phase 4 — campaigns, metrics & reports

```mermaid
erDiagram
  clients ||--o{ campaigns : ""
  profiles ||--o{ campaigns : owner
  campaigns ||--o{ campaign_channels : "platforms + budget split"
  campaigns ||--o{ campaign_kpis : targets
  campaign_channels ||--o{ campaign_kpis : "optional scope"
  campaign_channels ||--o{ metrics_daily : "one row per day"
  campaigns ||--o{ metric_imports : "CSV import log"
  campaigns ||--o{ requests : "optional link"
  campaigns ||--o{ deliverables : "creatives"
  clients ||--o{ reports : ""
  campaigns ||--o{ reports : "optional scope"
  reports ||--o{ report_sections : ordered
  clients ||--o{ report_schedules : ""
  report_schedules ||--o{ reports : generates
```

| Table | Key columns | Notes |
|---|---|---|
| `campaigns` | `client_id`, `number` (per org, shown `C-12`), `name`, `objective` (`awareness · traffic · engagement · leads · sales · app_installs · video_views`), `status` (`draft · planned · active · paused · completed · archived`), `start_date`, `end_date`, `budget_minor` + `currency`, `owner_id`, `description`, `visibility` (`internal · client`), `health` (`on_track · at_risk · off_track · no_data`), `health_notified`, `metrics_through` | Drafts never reach the portal (RLS: clients only see `planned · active · paused · completed`). `health` is cached by `refreshCampaignHealth()` after metric/KPI writes and by the daily sweep (ADR-051). |
| `campaign_channels` | `campaign_id`, `platform` (`meta · instagram · facebook · tiktok · snapchat · google · youtube · x · linkedin · other`), `name`, `budget_minor`, `external_ref` (platform campaign id — Phase 7 sync), `sort_order` | |
| `campaign_kpis` | `campaign_id`, `channel_id?` (null = whole campaign), `metric` (catalog key), `target` numeric, `sort_order` | Direction comes from the metric catalog (volume ↑, cost ↓). Unique per (campaign, channel, metric). |
| `metrics_daily` | `campaign_id`, `channel_id`, `client_id`, `date`, `impressions`, `reach`, `clicks`, `spend_minor`, `conversions`, `leads`, `video_views`, `engagements`, `revenue_minor`, `source` (`manual · import · api`), `import_id?`, `updated_by` | Unique (channel, date) → imports upsert. Not partitioned (ADR-048). Derived metrics (CTR, CPC, CPM, CPA, CPL, ROAS, frequency, engagement rate) are computed, never stored. |
| `metric_imports` | `campaign_id`, `channel_id`, `file_name`, `preset` (`meta · tiktok · snapchat · google · custom`), `row_count`, `date_from`, `date_to`, `imported_by` | Audit trail of CSV imports. |
| `reports` | `client_id`, `campaign_id?`, `schedule_id?`, `title`, `period_start`, `period_end`, `locale`, `status` (`draft · published`), `snapshot jsonb`, `published_at`, `published_by` | Drafts compute numbers live; publishing freezes them into `snapshot` so the client always sees what was published (ADR-049). |
| `report_sections` | `report_id`, `kind` (`kpi_summary · trend · channel_breakdown · top_creatives · commentary · next_steps`), `config jsonb` (metrics, grain), `body` (Markdown, commentary/next steps), `sort_order` | Read-only once the report is published. |
| `report_schedules` | `client_id`, `campaign_id?`, `cadence` (`weekly · monthly`), `sections` (template), `auto_publish`, `next_run_on`, `last_run_at`, `is_active` | The daily sweep creates the report for the period that just ended. |

Changes to existing tables: `requests.campaign_id` and `deliverables.campaign_id` (nullable, same client — trigger).

**Pacing & health** (pure functions in `src/modules/campaigns/metrics.ts`, mirrored nowhere else)
- Elapsed share of the flight `e = days elapsed / flight days` (clamped 0–1; uses the last day with metrics).
- Volume KPI (impressions, clicks, leads…): projected = actual ÷ e; ratio = projected ÷ target.
  Cost KPI (CPC, CPA, CPL, CPM): ratio = target ÷ actual. Rate KPI (CTR, ROAS, engagement rate): ratio = actual ÷ target.
- ratio ≥ 1 → on track, ≥ 0.85 → at risk, below → off track. Budget pacing uses spend ÷ (budget × e): > 1.15 or < 0.85 → at risk.
- Campaign health = the worst of its KPIs and budget pacing; `no_data` before the first metrics.

**RLS**

| Table | Agency | Client users of that client |
|---|---|---|
| `campaigns`, `campaign_channels`, `campaign_kpis` | read `campaigns:read` + client access; write `campaigns:manage` | read when the campaign is `visibility = 'client'` and not `draft`/`archived` (flag `module.campaigns`) |
| `metrics_daily` | read `campaigns:read`; write `metrics:manage` | read for campaigns they can see |
| `metric_imports` | read `campaigns:read`; insert `metrics:manage` | — |
| `reports`, `report_sections` | read `campaigns:read`; write `reports:manage` (published reports only unpublish → draft) | `status = 'published'` only |
| `report_schedules` | read `campaigns:read`; write `reports:manage` | — |

## 4. Forward-looking sketch (all phases — not built in Phase 0)

```mermaid
erDiagram
  organizations ||--o{ clients : ""
  clients ||--o{ client_contacts : ""
  clients ||--o{ client_assignments : "agency staff"
  clients ||--o{ brands : ""
  clients ||--o{ files : ""
  clients ||--o{ threads : "messages"
  threads ||--o{ messages : ""

  request_types ||--o{ requests : "brief conforms to (snapshot)"
  clients ||--o{ requests : submits
  requests ||--o{ request_status_history : lifecycle
  requests ||--o{ request_events : changes

  requests ||--o{ tasks : "spawns"
  workflow_templates ||--o{ workflow_template_steps : ""
  workflow_templates ||--o{ tasks : instantiates
  tasks ||--o{ task_assignees : ""
  tasks ||--o{ deliverables : produces
  deliverables ||--o{ deliverable_versions : ""
  deliverable_versions ||--o{ approvals : "client review"
  tasks ||--o{ time_entries : ""

  clients ||--o{ campaigns : ""
  campaigns ||--o{ campaign_kpis : targets
  campaigns ||--o{ ad_accounts_campaigns : "links platform campaigns"
  ad_accounts ||--o{ metrics_daily : ""
  campaigns ||--o{ reports : ""

  clients ||--o{ sla_policies : ""
  departments ||--o{ capacity_plans : ""

  leads ||--o{ deals : converts
  pipelines ||--o{ pipeline_stages : ""
  pipeline_stages ||--o{ deals : ""
  deals }o--|| clients : "won → client"

  integration_connections ||--o{ ad_accounts : ""
  integration_connections ||--o{ webhook_events : ""
  automations ||--o{ automation_runs : ""

  ai_insights }o--|| campaigns : about
  ai_conversations ||--o{ ai_messages : ""
  embeddings }o--|| files : indexes
```

| Phase | Main entities | Notes |
|---|---|---|
| 1 Portal | `clients` (extended), `client_assignments`, `brands`, `files`, `folders`, `threads`, `messages`, `thread_participants` | Storage bucket per org, path `org/<org>/client/<client>/…`; Realtime for messages |
| 2 Requests | **Built** — see §3c | Form definition versioned so old requests render correctly |
| 3 Tasks | `workflow_templates`, `workflow_template_steps`, `tasks`, `task_assignees`, `task_dependencies`, `deliverables`, `deliverable_versions`, `approvals`, `comments`, `time_entries` | Status machines per template; approvals by client users |
| 4 Campaigns | **Built** — see §3e | Metrics not partitioned (ADR-048); published reports are snapshots |
| 5 Ops | `sla_policies`, `sla_breaches`, read models/views for Client 360 & dashboard | Mostly views over earlier phases |
| 6 CRM | `leads`, `pipelines`, `pipeline_stages`, `deals`, `deal_activities`, `capacity_plans`, `availability` | Won deal → creates client |
| 7 Integrations | `integration_connections` (tokens in Supabase Vault), `ad_accounts`, `social_accounts`, `webhook_events`, `sync_jobs`, `automations`, `automation_runs`, `whatsapp_templates` | Automation triggers = `domain_events` types |
| 8 AI | `ai_insights`, `ai_recommendations`, `ai_conversations`, `ai_messages`, `embeddings` (pgvector) | Every AI output linked to source records for traceability |
