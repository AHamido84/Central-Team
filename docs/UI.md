# UI & Design System

Status: **Phase 0 design — brand choice pending approval** (see §3).

## 1. Design direction

**"Calm operations."** A workspace people live in all day, and that clients see as a reflection of the agency.
References: Linear (density, keyboard-first, crisp type), Notion (calm, spacious content), ClickUp (information-rich
views done tidily).

Principles:

1. **Content first, chrome quiet.** Neutral surfaces, one brand color used for intent (primary actions, focus,
   selection) — never decoration. Status colors carry meaning only.
2. **Arabic is the primary design language**, not a translation. Layouts are designed RTL first and mirrored
   to LTR. Arabic type gets more line-height and slightly larger sizes than Latin.
3. **Spacious but efficient.** 4px grid; generous page gutters; compact density option for tables.
4. **Every state designed**: loading (skeletons shaped like content), empty (illustration-free icon + one-line
   explanation + primary action), error (what happened + retry), no-permission (why + who to ask).
5. **Keyboard-first**: `Ctrl/⌘ K` command palette, focus rings always visible, shortcuts shown in tooltips.
6. **Motion is feedback, not show**: 120–200ms, ease-out, opacity/transform only; respects `prefers-reduced-motion`.
7. **Two faces, one system**: the agency app is dense and tool-like; the client portal uses the same components
   with more whitespace, larger type steps and fewer actions per screen.

## 2. Typography

| Use | Font | Notes |
|---|---|---|
| Arabic UI & content | **IBM Plex Sans Arabic** (400, 500, 600, 700) | Excellent screen legibility, neutral-professional, pairs with Plex/Inter metrics, OFL license |
| Latin UI & content | **Inter** (variable, 400–700) | Latin fallback inside Arabic text and primary for English |
| Numbers & code | Inter with `tabular-nums`; **JetBrains Mono** for IDs/code | Tables use tabular figures in both languages |

Loaded with `next/font/google`, `display: swap`, subset `arabic` + `latin`. CSS stack:
`--font-sans: var(--font-plex-arabic), var(--font-inter), system-ui, sans-serif` in Arabic, and the reverse
order in English, so each script always renders in its native face.

Type scale (rem, Arabic line-height in brackets):

| Token | Size | LH (EN / AR) | Weight | Use |
|---|---|---|---|---|
| `text-display` | 2.25 | 1.2 / 1.35 | 700 | Portal hero, empty-page titles |
| `text-h1` | 1.75 | 1.25 / 1.4 | 600 | Page titles |
| `text-h2` | 1.375 | 1.3 / 1.45 | 600 | Section titles |
| `text-h3` | 1.125 | 1.4 / 1.55 | 600 | Card titles |
| `text-body` | 0.9375 | 1.55 / 1.75 | 400 | Default |
| `text-sm` | 0.8125 | 1.5 / 1.7 | 400/500 | Tables, secondary |
| `text-xs` | 0.75 | 1.45 / 1.6 | 500 | Badges, meta |

Alternative considered: **Noto Kufi Arabic** for headings only (more geometric, "Saudi signage" character). Can be
added later as `--font-display` without touching components.

## 3. Brand color proposals (choose one)

Both proposals share the same neutral, semantic and chart palettes; only the brand hue and accent differ.
All primary-on-surface combinations below meet **WCAG AA** (4.5:1 for text) in both modes.

### Proposal A — "Najd Indigo" (نيلي نجد)

Confident, modern, tech-forward. Reads as "agency with a product". Indigo is rare among Saudi competitors (mostly
green/teal/navy), so it's distinctive. Warm **sand** accent adds local warmth for highlights and the portal.

| Step | 50 | 100 | 200 | 300 | 400 | 500 | **600** | 700 | 800 | 900 | 950 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Indigo | `#EEF0FF` | `#E0E3FF` | `#C6CBFE` | `#A3A9FB` | `#7E80F6` | `#625DEE` | **`#5140E0`** | `#4433C5` | `#382C9F` | `#312A7E` | `#1E1A4A` |
| Sand (accent) | `#FBF7EF` | `#F5EBD7` | `#EBD6AE` | `#DFBC7F` | `#D4A55B` | `#C98E42` | `#B07236` | `#91572F` | `#77472C` | `#623B27` | `#361E13` |

- Light: `--primary` Indigo 600, `--primary-foreground` white, `--ring` Indigo 500.
- Dark: `--primary` Indigo 400, `--primary-foreground` Indigo 950.

### Proposal B — "Palm Teal" (نخلة)

Calm, trustworthy, subtly Saudi (palm/oasis), close to finance/enterprise feel. **Saffron** accent evokes Arabic
coffee/hospitality and gives warm energy to highlights.

| Step | 50 | 100 | 200 | 300 | 400 | 500 | **600** | 700 | 800 | 900 | 950 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Teal | `#EDFCF9` | `#D2F7F0` | `#A8EDE2` | `#71DDCF` | `#3CC3B5` | `#1FA89C` | **`#148780`** | `#146C68` | `#155654` | `#164846` | `#062A2A` |
| Saffron (accent) | `#FEF8EC` | `#FCEBC9` | `#F8D58F` | `#F4BA55` | `#F0A12E` | `#E8811A` | `#CD5F13` | `#AA4214` | `#8A3417` | `#722C16` | `#411408` |

- Light: `--primary` Teal 600, `--primary-foreground` white, `--ring` Teal 500.
- Dark: `--primary` Teal 400, `--primary-foreground` Teal 950.

**Recommendation: A (Najd Indigo)** — more distinctive in the Saudi agency market, and indigo keeps clear contrast
with the green "success" semantic color (teal primary sits close to success green, which weakens status clarity).
If the agency already has brand colors, we derive the scale from them instead.

### Shared neutrals (cool gray, slight blue tint)

`#F8F9FB` 50 · `#F1F3F6` 100 · `#E4E7EC` 200 · `#CDD2DA` 300 · `#9AA3B2` 400 · `#6B7485` 500 · `#4D5566` 600 ·
`#373E4D` 700 · `#232833` 800 · `#161A22` 900 · `#0D1016` 950

### Semantic

| Role | Light (bg / fg) | Dark (bg / fg) |
|---|---|---|
| Success | `#E8F7EE` / `#157F3D` | `#0F2A1B` / `#4ADE80` |
| Warning | `#FEF6E6` / `#A15C07` | `#2E2008` / `#FBBF24` |
| Danger | `#FDECEC` / `#C52A2A` | `#301314` / `#F87171` |
| Info | `#EAF2FE` / `#1D5FD1` | `#0F1D35` / `#60A5FA` |

Chart palette (Phase 4) derives from the chosen brand + 7 hues validated for color-blind separation.

## 4. Tokens

CSS variables in `src/styles/globals.css`, exposed to Tailwind v4 via `@theme inline`. Components never use raw hex.

| Group | Tokens |
|---|---|
| Surfaces | `--background`, `--foreground`, `--surface` (cards), `--surface-muted`, `--surface-raised` (popovers), `--overlay` |
| Text | `--foreground`, `--muted-foreground`, `--subtle-foreground`, `--link` |
| Brand | `--primary`, `--primary-foreground`, `--primary-soft` (tinted bg), `--accent`, `--accent-foreground` |
| Semantic | `--success`, `--success-soft`, `--warning`, `--warning-soft`, `--danger`, `--danger-soft`, `--info`, `--info-soft` |
| Lines | `--border`, `--border-strong`, `--input`, `--ring` |
| Sidebar | `--sidebar`, `--sidebar-foreground`, `--sidebar-active`, `--sidebar-border` |
| Radius | `--radius-sm` 6px, `--radius-md` 8px, `--radius-lg` 12px, `--radius-xl` 16px, `--radius-full` |
| Spacing | 4px base (Tailwind default scale); page gutter `--gutter` 16px mobile / 24px tablet / 32px desktop; content max-width 1280px (agency), 1080px (portal) |
| Shadow | `--shadow-xs` (inputs), `--shadow-sm` (cards), `--shadow-md` (popovers), `--shadow-lg` (dialogs) — softer & more diffuse in light, replaced by borders + subtle glow in dark |
| Motion | `--duration-fast` 120ms, `--duration-base` 180ms, `--duration-slow` 260ms, `--ease-out` cubic-bezier(.2,.8,.2,1) |
| Z-index | `dropdown` 40, `sticky` 50, `drawer` 60, `dialog` 70, `toast` 80, `command` 90 |
| Density | `--row-h` 44px comfortable / 36px compact (tables, lists) |

Dark mode: not an inversion — surfaces step up in lightness with elevation (`background` #0D1016 → `surface` #161A22
→ `raised` #1C212B), borders at ~8% white, primary shifted to the 400 step.

## 5. Component inventory (Phase 0)

Primitives (shadcn/ui, themed & RTL-verified): Button (primary/secondary/ghost/outline/destructive/link; sizes;
loading state; icon-only with tooltip), Input, Textarea, Select, Combobox, Checkbox, Radio, Switch, Label, Form
field (label, hint, error, required marker), Phone input (+966 default), Date picker (Gregorian/Hijri aware),
Dropdown menu, Popover, Tooltip, Dialog, Alert dialog, Sheet/Drawer (opens from inline-end; bottom on mobile),
Tabs, Badge, Avatar, Avatar group (+N), Skeleton, Toast (Sonner, positioned bottom-inline-end), Separator,
Scroll area, Progress, Kbd, Breadcrumb, Pagination.

Composites (`src/components/patterns`, `src/components/shell`):

| Component | Notes |
|---|---|
| AppShell | Collapsible sidebar (expanded 264px / rail 64px / off-canvas on mobile), top bar, content area; state persisted per user |
| Sidebar | Org switcher slot, nav from module registry, section headers, active indicator on inline-start edge, user menu at bottom |
| TopBar | Breadcrumbs, command palette trigger (search field look), notifications bell, language switcher, theme toggle, avatar menu |
| Breadcrumbs | Generated from route metadata, translated, truncates middle items on mobile |
| PageHeader | Title, description, actions slot, tabs slot, back link (mirrored icon) |
| DataTable | TanStack Table: sorting, filtering, column visibility, row selection + bulk actions bar, pagination (server-side), density toggle, sticky header, empty/loading/error states, mobile → stacked card list |
| EmptyState | Icon, title, description, primary + secondary action |
| StatCard | Label, value (formatted), delta (up/down colored, direction-aware arrows), sparkline slot |
| FileCard | Type icon/thumbnail, name (bidi-safe), size, uploader avatar, actions menu |
| CommandPalette | `cmdk`; `Ctrl/⌘ K`; groups: Navigation, Actions, Recent; permission & flag aware; Phase 0 = navigation + theme/language actions |
| NotificationBell / Inbox | Unread badge, popover list, inbox page |
| Permission Matrix | Rows = permissions grouped by module/resource, columns = roles; sticky first column & header; bulk toggle per resource; locked cells for Super Admin; diff summary before save |
| LanguageSwitcher / ThemeToggle | Menu items with checkmarks; switcher shows "العربية" / "English" in their own script |
| DirIcon | Wrapper that mirrors directional lucide icons in RTL |
| ForbiddenState / ErrorState | Standard 403 / error screens |

`/dev/design-system`: every component with variants and states, a locale toggle (AR/EN) and theme toggle (light/dark)
on the page itself, plus a "grid" view that renders key components in all four combinations side by side.

## 6. Layout & responsiveness

Breakpoints: `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280 · `2xl` 1536. Minimum supported width **360px**.

- < `lg`: sidebar becomes an off-canvas sheet from the inline-start edge; top bar shows menu button.
- Tables collapse to card lists below `md`; primary actions move to a sticky bottom bar on mobile forms.
- Dialogs become full-height sheets below `sm`.
- Touch targets ≥ 44px on mobile.

## 7. Navigation maps

### Agency app (sidebar) — phase in brackets; only Phase 0 items are built now

```
[Org / agency name]
─ Home
  • Dashboard                       /dashboard          [0 → 5: real ops dashboard]
  • Inbox (notifications)           /notifications      [0]
─ Work
  • Requests (triage)               /requests           [2]
  • Tasks                           /tasks              [3]
  • Approvals                       /approvals          [3]
─ Clients
  • Clients / Client 360            /clients            [1 → 5]
  • Campaigns                       /campaigns          [4]
  • Reports                         /reports            [4]
─ Growth
  • Leads & Pipeline                /crm                [6]
─ Team
  • Team & capacity                 /team               [5 → 6]
─ Intelligence
  • AI Assistant                    /ai                 [8]
─ Admin (permission-gated)
  • Users & invitations             /admin/users        [0]
  • Roles & permissions             /admin/roles        [0]
  • Departments                     /admin/departments  [0]
  • Feature flags                   /admin/features     [0]
  • Audit log                       /admin/audit        [0]
  • Organization                    /admin/organization [0]
  • Integrations                    /admin/integrations [7]
  • Automations                     /admin/automations  [7]
─ (bottom) User menu: Profile · Preferences · Notification settings · Design system (staff) · Sign out
```

Phase 0 Dashboard is a real, useful page (not a placeholder): welcome, your roles & departments, team at a glance
(member counts per department), pending invitations (if permitted), recent activity you can see.

### Client portal (top navigation on desktop, bottom tab bar on mobile)

```
[Agency logo]   [Client name ▾ (if user belongs to several clients)]
• Home                      /portal                   [0: welcome + your account; 1: activity & shortcuts]
• Requests                  /portal/requests          [2]
• Approvals                 /portal/approvals         [3]
• Files                     /portal/files             [1]
• Messages                  /portal/messages          [1]
• Campaigns & reports       /portal/campaigns         [4]
• Team (Client Owner)       /portal/team              [0]
(avatar menu) Profile · Notification settings · Language · Theme · Sign out
```

Items for later phases are **not rendered** until their feature flag is enabled — no "coming soon" screens.

### Auth screens

Split layout on desktop (form on inline-start, brand panel on inline-end with agency logo/pattern), single column
on mobile: Login (password / magic-link tabs), Forgot password, Reset password, Check your email, Invitation accept
(org + inviter shown, set password), Invitation invalid/expired, Onboarding (3 steps: profile → avatar & phone →
language & theme, with progress).

## 8. Accessibility

WCAG 2.2 AA: contrast, focus visible (2px ring + offset using `--ring`), all interactive elements reachable by
keyboard, Radix primitives for ARIA, `aria-live` for toasts, reduced-motion support, form errors linked via
`aria-describedby`, language of page set (`lang`), icons with labels when standalone.
