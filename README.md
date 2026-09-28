# Central Team Platform

Operations platform and client portal for a Saudi marketing agency's central team. Arabic-first (RTL) with English (LTR),
light and dark, mobile-first portal.

**Status:** Phase 0 (Foundation) and Phase 1 (Client Portal) are built. Next: Phase 2 (Requests).

## Run it locally

Requirements: Node 22, pnpm 10, Docker, Supabase CLI 2.x.

```bash
pnpm install
pnpm db:start                      # local Supabase (Postgres, Auth, Storage, Realtime, Mailpit)
cp .env.example .env.local         # fill keys from: supabase status -o env
pnpm db:reset                      # migrations + seed
pnpm dev                           # http://localhost:3000
```

Emails (invites, magic links, resets, notifications) land in Mailpit: http://localhost:54324

### Seeded accounts (password `Passw0rd!` for all)

| Who | Email | Side / role |
|---|---|---|
| سارة القحطاني | sara@ofoq.test | Agency · Super Admin |
| فيصل الحربي | faisal@ofoq.test | Agency · Admin / Operations Manager |
| نورة العتيبي | noura@ofoq.test | Agency · Account Manager (Najd, Darb, Lujain) |
| عبدالرحمن الشهري | abdulrahman@ofoq.test | Agency · Account Manager (Future Smile, Gulf Vision) — English UI |
| ريم الدوسري / لمى الزهراني | reem@ / lama@ofoq.test | Agency · Team Lead (Design / Video) |
| خالد المطيري, عمر الغامدي, هند السبيعي, تركي العنزي | khalid@ / omar@ / hind@ / turki@ofoq.test | Agency · Specialist (Turki has a “see all clients” override) |
| محمد الراشد | mohammed@najd.test | Client Owner · مطاعم نجد الأصيلة |
| عبير السالم | abeer@najd.test | Client Member (approver) · Najd |
| سعد الفهد | saad@najd.test | Client Viewer · Najd |
| ياسر باحمدان / Dana Alamoudi | yasser@ / dana@darb.test | Owner / Member · قهوة درب (Dana uses English) |
| د. ناصر العمري | nasser@futuresmile.test | Client Owner · عيادات ابتسامة المستقبل |
| Sultan Al-Mansour | sultan@gulfvision.test | Client Owner · عقارات رؤية الخليج (English) |
| لجين الشريف | lujain@lujain.test | Client Owner · أزياء لُجين |

## Quality gates

```bash
pnpm check        # lint + typecheck + i18n parity + unit tests
pnpm test:db      # RLS tests (after db:reset)
pnpm test:e2e     # Playwright end-to-end
```

## Docs

- [`CLAUDE.md`](CLAUDE.md) — vision, stack, conventions, commands, Definition of Done
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — structure, auth & permission flow, events, flags, portal flows
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — ERD, RLS strategy, Phase 1 entities, forward sketch
- [`docs/UI.md`](docs/UI.md) — design direction, tokens, navigation maps
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phases and checklists
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — decision log and open questions
