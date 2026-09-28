# Decision Log

Append-only. Format: **ADR-NNN — Title** · date · status (Proposed / Accepted / Superseded by ADR-x).
Proposed decisions become Accepted when the owner approves the plan.

---

### ADR-001 — Single Next.js app with `(agency)` and `(portal)` route groups
2026-09-28 · Proposed
One deployable, shared auth/design system/modules. Agency routes live at root (`/dashboard`, `/admin/*`), portal at
`/portal/*` (route groups don't change URLs, so the portal needs a prefix). A later split to `app.` / `portal.`
subdomains is a proxy rewrite. *Rejected*: two apps in a monorepo — duplicated auth/session handling and
deployment cost with no benefit at this size.

### ADR-002 — Postgres is the authorization authority
2026-09-28 · Proposed
RLS policies call `app.has_permission()`; TypeScript `can()` is computed from `app.effective_permissions()` and used
only for UX and early rejection. Permissions are not stored in the JWT (staleness up to token lifetime).

### ADR-003 — App queries run through Drizzle as `authenticated` with JWT claims (`withRls`)
2026-09-28 · Proposed
Each request's DB work runs in a transaction that sets `request.jwt.claims` and `set local role authenticated`, so
RLS applies to Drizzle queries and `auth.uid()` works in triggers (audit actor). Service role only in listed places.
*Rejected*: Drizzle as superuser + app-side checks (RLS becomes decorative); supabase-js only (loses typed SQL,
transactions, and transactional outbox).

### ADR-004 — Drizzle schema in TS, migrations emitted into `supabase/migrations`
2026-09-28 · Proposed
drizzle-kit generates table DDL with the Supabase timestamp prefix; RLS policies, functions, triggers and grants are
hand-written SQL migrations alongside. `supabase db reset` is the single way to rebuild. One migration history.

### ADR-005 — Own invitations table instead of Supabase `inviteUserByEmail`
2026-09-28 · Proposed
Need resend with rotation, revoke, pre-assigned roles/department/client, bilingual branded email, and audit.
Tokens: 32 random bytes, SHA-256 stored, 7-day expiry, single use. Accept creates the auth user via admin API with
`email_confirm=true` (the click proves email ownership). Public sign-up disabled.

### ADR-006 — All auth emails via Supabase Send Email Hook → React Email → `EmailProvider`
2026-09-28 · Proposed
One bilingual template system for every email; provider swappable (Resend in prod, SMTP→Mailpit locally, Console in tests).

### ADR-007 — Minimal `clients` table in Phase 0
2026-09-28 · Proposed
Client users and client-scoped roles (Owner/Member/Viewer) must attach to a client to be invitable and testable in
Phase 0. Only id/org/name/slug/status/logo now; agency-side client management UI is Phase 1.

### ADR-008 — Binary permissions + relationship-aware RLS for data scope
2026-09-28 · Proposed
Scope variants are separate permissions (`clients:read_all` vs `clients:read_assigned`); RLS combines them with
relationship tables (e.g. `client_assignments`, Phase 1). Keeps the matrix a simple grid of checkboxes.

### ADR-009 — Overrides: deny wins; anti-escalation enforced in DB
2026-09-28 · Proposed
Effective = roles ∪ grants − denies. Nobody (except Super Admin) can grant permissions they don't hold — enforced by
trigger, not just UI. Super Admin role is locked to all permissions and cannot be deleted; the last Super Admin
cannot be removed or deactivated.

### ADR-010 — Locale without URL prefix; Arabic formats use Latin digits + Gregorian calendar
2026-09-28 · Proposed
It's an authenticated app, not SEO content; locale follows the user (profile → cookie → header → `ar`).
`Intl` with plain `ar-SA` defaults to the Islamic (Umm al-Qura) calendar and Arabic-Indic digits, which Saudi
business users rarely expect in operational software; we use `ar-SA-u-nu-latn-ca-gregory` and offer Hijri as a
user preference. *Pending owner confirmation (see open questions).*

### ADR-011 — Localized org-defined content as `jsonb {ar, en}`
2026-09-28 · Proposed
Role, department, client, permission labels are stored as `LocalizedText`. Simpler than translation tables; fine for
two languages; falls back to the other language if one is empty.

### ADR-012 — Transactional outbox for domain events; audit via triggers
2026-09-28 · Proposed
`emitEvent()` writes `domain_events` in the mutation's transaction (no lost/phantom events). Row-level before/after
audit comes from a generic trigger so it can't be forgotten. Dispatcher/consumers start in Phase 1.

### ADR-013 — Language-neutral notifications
2026-09-28 · Proposed
Store `type` + `params`, translate at render. History re-renders in the user's current language; emails render in the
recipient's language at send time.

### ADR-014 — Next.js 16 `proxy.ts` for session refresh & routing
2026-09-28 · Proposed
Next 16 renamed `middleware` to `proxy`. Proxy uses JWT claims only (no DB); layouts re-check against DB.

### ADR-015 — Deploy on Vercel with a custom domain
2026-09-28 · Proposed
Vercel is the reference platform for Next.js 16 features (RSC, Server Actions, ISR). A custom domain is mandatory
because `*.pages.dev` / `*.netlify.app` are blocked on the owner's network (`*.vercel.app` will only be used for
previews if reachable). Cloudflare (OpenNext) remains a fallback.

### ADR-016 — Brand color & font
2026-09-28 · Proposed — awaiting owner choice
Two proposals in `UI.md §3`; recommendation: A "Najd Indigo" + Sand. Fonts: IBM Plex Sans Arabic + Inter.

---

## Open questions (to be answered before/while building Phase 0)

1. **Brand**: agency name in Arabic and English? Product name (e.g. "Central" / "المركز") if different from the agency?
2. **Logo**: SVG files (full logo, icon/mark, light & dark variants)? If none yet, we use a clean wordmark.
3. **Colors**: Proposal A (Najd Indigo), B (Palm Teal), or existing brand colors (hex)?
4. **Domain**: which domain/subdomains? (Suggested: `app.<domain>` for everything, portal at `/portal`; or
   `portal.<domain>` for clients.) Is `*.vercel.app` reachable on your network for preview deployments?
5. **Email**: sending domain and from-address (e.g. `no-reply@<domain>`)? Do you have a Resend account, or should
   I plan DNS records (SPF/DKIM/DMARC) for you to add?
6. **Hosting region / data residency**: any PDPL/client contract requirement to keep data in KSA or GCC? This
   determines the Supabase region (or self-hosting) — Vercel functions region should match.
7. **Numerals & calendar**: Latin digits (123) + Gregorian by default with Hijri optional — OK? Or Arabic-Indic
   digits (١٢٣) in the Arabic UI?
8. **Roles**: are the default permission grants in `DATA_MODEL.md §2` right? In particular: may Account Managers
   invite client users? Should Team Leads see all clients or only their department's work?
9. **Accounts**: Supabase and Vercel accounts/org — should I prepare everything to run locally and hand over deploy
   steps, or will you provide project access for staging?
10. **Seed personas**: any real department names/people you want in demo data, or keep fictional?
