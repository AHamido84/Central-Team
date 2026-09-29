/**
 * Development seed (run by `pnpm db:reset` after migrations + supabase/seed.sql).
 * Creates real auth users through the Admin API, the agency team, 5 Saudi clients with portal users,
 * packages, folders, files (uploaded to Storage), message threads, invitations and notifications.
 *
 * Every account uses the password in SEED_PASSWORD. Local development only.
 */
import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../src/lib/db/schema';
import { hashInvitationToken } from '../src/modules/invitations/server/tokens';
import { artworkPng, simplePdf } from './seed-assets';
import { seedRequestsData } from './seed-requests';
import { seedTasksData } from './seed-tasks';

config({ path: '.env.local' });

export const SEED_PASSWORD = 'Passw0rd!';
const ORG_ID = '00000000-0000-4000-8000-000000000001';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
if (!url || !secret) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY (.env.local)');
if (!/127\.0\.0\.1|localhost/.test(url) && process.env.SEED_ALLOW_REMOTE !== '1') {
  throw new Error('Refusing to seed a non-local Supabase project. Set SEED_ALLOW_REMOTE=1 to override.');
}

const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const client = postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 4 });
const db = drizzle(client, { schema });

type Person = {
  key: string;
  email: string;
  name: string;
  phone: string;
  locale: 'ar' | 'en';
};

const staff: (Person & { role: string; department: string; lead?: boolean; title: string })[] = [
  {
    key: 'sara',
    email: 'sara@ofoq.test',
    name: 'سارة القحطاني',
    phone: '+966501110001',
    locale: 'ar',
    role: 'super_admin',
    department: 'account_management',
    lead: true,
    title: 'المديرة التنفيذية',
  },
  {
    key: 'faisal',
    email: 'faisal@ofoq.test',
    name: 'فيصل الحربي',
    phone: '+966501110002',
    locale: 'ar',
    role: 'admin',
    department: 'account_management',
    title: 'مدير العمليات',
  },
  {
    key: 'noura',
    email: 'noura@ofoq.test',
    name: 'نورة العتيبي',
    phone: '+966501110003',
    locale: 'ar',
    role: 'account_manager',
    department: 'account_management',
    title: 'مديرة حسابات أولى',
  },
  {
    key: 'abdulrahman',
    email: 'abdulrahman@ofoq.test',
    name: 'عبدالرحمن الشهري',
    phone: '+966501110004',
    locale: 'en',
    role: 'account_manager',
    department: 'account_management',
    title: 'Account Manager',
  },
  {
    key: 'reem',
    email: 'reem@ofoq.test',
    name: 'ريم الدوسري',
    phone: '+966501110005',
    locale: 'ar',
    role: 'team_lead',
    department: 'design',
    lead: true,
    title: 'قائدة فريق التصميم',
  },
  {
    key: 'khalid',
    email: 'khalid@ofoq.test',
    name: 'خالد المطيري',
    phone: '+966501110006',
    locale: 'ar',
    role: 'specialist',
    department: 'design',
    title: 'مصمم جرافيك',
  },
  {
    key: 'lama',
    email: 'lama@ofoq.test',
    name: 'لمى الزهراني',
    phone: '+966501110007',
    locale: 'ar',
    role: 'team_lead',
    department: 'video',
    lead: true,
    title: 'قائدة فريق الفيديو',
  },
  {
    key: 'omar',
    email: 'omar@ofoq.test',
    name: 'عمر الغامدي',
    phone: '+966501110008',
    locale: 'en',
    role: 'specialist',
    department: 'video',
    title: 'Video Editor',
  },
  {
    key: 'hind',
    email: 'hind@ofoq.test',
    name: 'هند السبيعي',
    phone: '+966501110009',
    locale: 'ar',
    role: 'specialist',
    department: 'content',
    lead: true,
    title: 'كاتبة محتوى',
  },
  {
    key: 'turki',
    email: 'turki@ofoq.test',
    name: 'تركي العنزي',
    phone: '+966501110010',
    locale: 'ar',
    role: 'specialist',
    department: 'media_buying',
    lead: true,
    title: 'أخصائي شراء وسائط',
  },
];

type ClientSeed = {
  slug: string;
  name: { ar: string; en: string };
  industry: string;
  city: string;
  website: string;
  social: Record<string, string>;
  status: 'active' | 'onboarding';
  am: string;
  team: string[];
  colors: [string, string, string];
  pkg: 'starter' | 'growth' | 'premium';
  users: (Person & { role: 'client_owner' | 'client_member' | 'client_viewer'; canApprove: boolean; title: string })[];
};

const clientSeeds: ClientSeed[] = [
  {
    slug: 'najd-heritage',
    name: { ar: 'مطاعم نجد الأصيلة', en: 'Najd Heritage Restaurants' },
    industry: 'food_beverage',
    city: 'riyadh',
    website: 'https://najdheritage.example',
    status: 'active',
    social: { instagram: 'najdheritage', tiktok: 'najdheritage', snapchat: 'najdheritage' },
    am: 'noura',
    team: ['khalid', 'hind', 'omar'],
    colors: ['#7A3E1D', '#E9B872', '#FFF4E0'],
    pkg: 'premium',
    users: [
      {
        key: 'mohammed',
        email: 'mohammed@najd.test',
        name: 'محمد الراشد',
        phone: '+966551230001',
        locale: 'ar',
        role: 'client_owner',
        canApprove: true,
        title: 'المدير العام',
      },
      {
        key: 'abeer',
        email: 'abeer@najd.test',
        name: 'عبير السالم',
        phone: '+966551230002',
        locale: 'ar',
        role: 'client_member',
        canApprove: true,
        title: 'مديرة التسويق',
      },
      {
        key: 'saad',
        email: 'saad@najd.test',
        name: 'سعد الفهد',
        phone: '+966551230003',
        locale: 'ar',
        role: 'client_viewer',
        canApprove: false,
        title: 'محاسب',
      },
    ],
  },
  {
    slug: 'darb-coffee',
    name: { ar: 'قهوة درب', en: 'Darb Coffee' },
    industry: 'food_beverage',
    city: 'jeddah',
    website: 'https://darbcoffee.example',
    status: 'active',
    social: { instagram: 'darb.coffee', x: 'darbcoffee', tiktok: 'darb.coffee' },
    am: 'noura',
    team: ['reem', 'hind'],
    colors: ['#1F3A2E', '#C9A66B', '#F3EBDD'],
    pkg: 'growth',
    users: [
      {
        key: 'yasser',
        email: 'yasser@darb.test',
        name: 'ياسر باحمدان',
        phone: '+966551230011',
        locale: 'ar',
        role: 'client_owner',
        canApprove: true,
        title: 'المؤسس',
      },
      {
        key: 'dana',
        email: 'dana@darb.test',
        name: 'Dana Alamoudi',
        phone: '+966551230012',
        locale: 'en',
        role: 'client_member',
        canApprove: false,
        title: 'Brand Manager',
      },
    ],
  },
  {
    slug: 'future-smile',
    name: { ar: 'عيادات ابتسامة المستقبل', en: 'Future Smile Dental Clinics' },
    industry: 'healthcare',
    city: 'dammam',
    website: 'https://futuresmile.example',
    status: 'active',
    social: { instagram: 'futuresmile.sa', snapchat: 'futuresmile' },
    am: 'abdulrahman',
    team: ['khalid', 'turki'],
    colors: ['#0B5C75', '#6FD0E0', '#EAF8FB'],
    pkg: 'growth',
    users: [
      {
        key: 'nasser',
        email: 'nasser@futuresmile.test',
        name: 'د. ناصر العمري',
        phone: '+966551230021',
        locale: 'ar',
        role: 'client_owner',
        canApprove: true,
        title: 'المدير الطبي',
      },
      {
        key: 'maha',
        email: 'maha@futuresmile.test',
        name: 'مها القرني',
        phone: '+966551230022',
        locale: 'ar',
        role: 'client_member',
        canApprove: true,
        title: 'منسقة التسويق',
      },
      {
        key: 'bader',
        email: 'bader@futuresmile.test',
        name: 'بدر الخالدي',
        phone: '+966551230023',
        locale: 'ar',
        role: 'client_viewer',
        canApprove: false,
        title: 'مدير الفروع',
      },
    ],
  },
  {
    slug: 'gulf-vision',
    name: { ar: 'عقارات رؤية الخليج', en: 'Gulf Vision Real Estate' },
    industry: 'real_estate',
    city: 'riyadh',
    website: 'https://gulfvision.example',
    status: 'onboarding',
    social: { instagram: 'gulfvision.re', x: 'gulfvision_re', linkedin: 'gulf-vision-real-estate', youtube: 'gulfvision' },
    am: 'abdulrahman',
    team: ['lama', 'omar', 'turki'],
    colors: ['#14213D', '#FCA311', '#E5E5E5'],
    pkg: 'premium',
    users: [
      {
        key: 'sultan',
        email: 'sultan@gulfvision.test',
        name: 'Sultan Al-Mansour',
        phone: '+966551230031',
        locale: 'en',
        role: 'client_owner',
        canApprove: true,
        title: 'CEO',
      },
      {
        key: 'ghada',
        email: 'ghada@gulfvision.test',
        name: 'غادة العسيري',
        phone: '+966551230032',
        locale: 'ar',
        role: 'client_member',
        canApprove: false,
        title: 'مديرة المبيعات',
      },
    ],
  },
  {
    slug: 'lujain-fashion',
    name: { ar: 'أزياء لُجين', en: 'Lujain Fashion' },
    industry: 'retail',
    city: 'jeddah',
    website: 'https://lujainfashion.example',
    status: 'active',
    social: { instagram: 'lujain.fashion', tiktok: 'lujainfashion', snapchat: 'lujainfashion' },
    am: 'noura',
    team: ['reem', 'lama', 'hind'],
    colors: ['#6D2E46', '#D5B9B2', '#F7EDF0'],
    pkg: 'starter',
    users: [
      {
        key: 'lujain',
        email: 'lujain@lujain.test',
        name: 'لجين الشريف',
        phone: '+966551230041',
        locale: 'ar',
        role: 'client_owner',
        canApprove: true,
        title: 'المؤسسة والمديرة الإبداعية',
      },
      {
        key: 'rawan',
        email: 'rawan@lujain.test',
        name: 'روان الحازمي',
        phone: '+966551230042',
        locale: 'ar',
        role: 'client_member',
        canApprove: false,
        title: 'مسؤولة المتجر الإلكتروني',
      },
      {
        key: 'asma',
        email: 'asma@lujain.test',
        name: 'Asma Qureshi',
        phone: '+966551230043',
        locale: 'en',
        role: 'client_viewer',
        canApprove: false,
        title: 'Finance',
      },
    ],
  },
];

const packageSeeds = [
  {
    key: 'starter',
    name: { ar: 'باقة الانطلاق', en: 'Starter' },
    description: { ar: 'حضور ثابت على منصتين', en: 'Consistent presence on two platforms' },
    price: 8_500_00,
    items: { post: 8, reel: 2, story: 8, revision_round: 1 },
  },
  {
    key: 'growth',
    name: { ar: 'باقة النمو', en: 'Growth' },
    description: { ar: 'محتوى متنوع وإعلانات ممولة', en: 'Varied content plus paid campaigns' },
    price: 14_500_00,
    items: { post: 12, reel: 4, story: 12, video: 1, ad_campaign: 1, revision_round: 2 },
  },
  {
    key: 'premium',
    name: { ar: 'الباقة المتكاملة', en: 'Premium' },
    description: { ar: 'فريق كامل لعلامتك', en: 'A full team for your brand' },
    price: 24_000_00,
    items: { post: 20, reel: 8, story: 20, video: 2, photo_shoot: 1, ad_campaign: 2, revision_round: 3 },
  },
] as const;

const daysAgo = (d: number, h = 10) => {
  const date = new Date();
  date.setDate(date.getDate() - d);
  date.setHours(h, (d * 7) % 60, 0, 0);
  return date;
};

async function createUser(p: Person): Promise<string> {
  const { data, error } = await supabase.auth.admin.createUser({
    email: p.email,
    password: SEED_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: p.name, locale: p.locale },
  });
  if (error || !data.user) throw new Error(`createUser ${p.email}: ${error?.message}`);
  await db
    .update(schema.profiles)
    .set({ fullName: p.name, phone: p.phone, whatsapp: p.phone, locale: p.locale, onboardedAt: daysAgo(40) })
    .where(eq(schema.profiles.id, data.user.id));
  return data.user.id;
}

async function upload(path: string, body: Buffer, contentType: string) {
  const { error } = await supabase.storage.from('client-files').upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
}

async function main() {
  console.info('Seeding local development data…');
  const [orgRow] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, ORG_ID));
  if (!orgRow) throw new Error('Organization missing — run `supabase db reset` first (pnpm db:reset does both).');

  const roleRows = await db.select().from(schema.roles).where(eq(schema.roles.organizationId, ORG_ID));
  const roleId = (key: string) => roleRows.find((r) => r.key === key)!.id;
  const deptRows = await db.select().from(schema.departments).where(eq(schema.departments.organizationId, ORG_ID));
  const deptId = (key: string) => deptRows.find((d) => d.key === key)!.id;

  const ids: Record<string, string> = {};
  const clientIds: Record<string, string> = {};

  // --- Agency team ---------------------------------------------------------
  for (const [i, s] of staff.entries()) {
    const id = await createUser(s);
    ids[s.key] = id;
    await db.insert(schema.organizationMembers).values({
      organizationId: ORG_ID,
      userId: id,
      userType: 'agency',
      jobTitle: s.title,
      joinedAt: daysAgo(400 - i * 30),
    });
    await db.insert(schema.userRoles).values({ organizationId: ORG_ID, userId: id, roleId: roleId(s.role) });
    await db.insert(schema.departmentMembers).values({
      departmentId: deptId(s.department),
      userId: id,
      organizationId: ORG_ID,
      isLead: Boolean(s.lead),
    });
  }
  // A per-user override example: Turki (specialist) may also see all clients.
  await db.insert(schema.userPermissionOverrides).values({
    organizationId: ORG_ID,
    userId: ids.turki!,
    permissionKey: 'clients:read_all',
    effect: 'grant',
    reason: 'يدير الحملات المدفوعة لجميع العملاء',
    createdBy: ids.sara!,
  });

  // --- Packages --------------------------------------------------------------
  const packageIds: Record<string, string> = {};
  for (const p of packageSeeds) {
    const [row] = await db
      .insert(schema.packages)
      .values({ organizationId: ORG_ID, name: p.name, description: p.description, priceMinor: p.price })
      .returning();
    packageIds[p.key] = row!.id;
    await db.insert(schema.packageItems).values(
      Object.entries(p.items).map(([itemType, quantity], i) => ({
        organizationId: ORG_ID,
        packageId: row!.id,
        itemType,
        quantity,
        sortOrder: i,
      })),
    );
  }

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const monthLabel = (locale: 'ar' | 'en') =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', { month: 'long', year: 'numeric' }).format(now);

  // --- Clients ---------------------------------------------------------------
  for (const [ci, c] of clientSeeds.entries()) {
    const [clientRow] = await db
      .insert(schema.clients)
      .values({
        organizationId: ORG_ID,
        name: c.name,
        slug: c.slug,
        industry: c.industry,
        city: c.city,
        website: c.website,
        social: c.social,
        status: c.status,
        accountManagerId: ids[c.am]!,
        startDate: iso(daysAgo(300 - ci * 50)),
        createdBy: ids.faisal!,
      })
      .returning();
    const clientId = clientRow!.id;
    clientIds[c.slug] = clientId;
    await db.insert(schema.clientNotes).values({
      clientId,
      organizationId: ORG_ID,
      body: 'العميل يفضّل التواصل عبر واتساب صباحًا. الموافقات عادة خلال 24 ساعة.',
      updatedBy: ids[c.am]!,
    });
    for (const member of c.team) {
      await db.insert(schema.clientAssignments).values({ clientId, userId: ids[member]!, organizationId: ORG_ID });
    }

    for (const u of c.users) {
      const id = await createUser(u);
      ids[u.key] = id;
      await db.insert(schema.organizationMembers).values({ organizationId: ORG_ID, userId: id, userType: 'client', invitedBy: ids[c.am]! });
      await db.insert(schema.clientUsers).values({
        organizationId: ORG_ID,
        clientId,
        userId: id,
        roleId: roleId(u.role),
        canApprove: u.canApprove,
        jobTitle: u.title,
        invitedBy: ids[c.am]!,
      });
    }

    // Package for the current period + some usage so progress bars are meaningful.
    const [cp] = await db
      .insert(schema.clientPackages)
      .values({
        organizationId: ORG_ID,
        clientId,
        packageId: packageIds[c.pkg]!,
        periodStart: iso(periodStart),
        periodEnd: iso(periodEnd),
        createdBy: ids[c.am]!,
      })
      .returning();
    const pkg = packageSeeds.find((p) => p.key === c.pkg)!;
    const progress = [0.65, 0.4, 0.8, 0.2, 0.55][ci]!;
    const usage = Object.entries(pkg.items)
      .map(([itemType, qty]) => ({ itemType, quantity: Math.floor(qty * progress) }))
      .filter((u) => u.quantity > 0);
    if (usage.length) {
      await db.insert(schema.packageUsageEntries).values(
        usage.map((u) => ({
          organizationId: ORG_ID,
          clientId,
          clientPackageId: cp!.id,
          itemType: u.itemType,
          quantity: u.quantity,
          sourceType: 'seed',
          createdBy: ids[c.am]!,
        })),
      );
    }

    // Folders & files ---------------------------------------------------------
    const owner = c.users.find((u) => u.role === 'client_owner')!;
    const folderDefs = [
      { key: 'brand', name: 'الهوية البصرية · Brand assets', kind: 'brand', visibility: 'client' },
      { key: 'month', name: `${monthLabel('ar')} · ${monthLabel('en')}`, kind: 'month', visibility: 'client' },
      { key: 'project', name: 'حملة موسم الرياض · Riyadh Season campaign', kind: 'project', visibility: 'client' },
      { key: 'internal', name: 'مسودات داخلية · Internal drafts', kind: 'custom', visibility: 'internal' },
    ] as const;
    const folderIds: Record<string, string> = {};
    for (const f of folderDefs) {
      const [row] = await db
        .insert(schema.fileFolders)
        .values({ organizationId: ORG_ID, clientId, name: f.name, kind: f.kind, visibility: f.visibility, createdBy: ids[c.am]! })
        .returning();
      folderIds[f.key] = row!.id;
    }
    const [from, to, accent] = c.colors;
    const fileDefs = [
      {
        folder: 'brand',
        name: 'logo-primary.png',
        kind: 'image',
        mime: 'image/png',
        by: owner.key,
        side: 'client',
        vis: 'client',
        body: () => artworkPng(640, 640, from, accent, to),
        days: 35,
      },
      {
        folder: 'brand',
        name: 'brand-guidelines.pdf',
        kind: 'pdf',
        mime: 'application/pdf',
        by: owner.key,
        side: 'client',
        vis: 'client',
        body: () => simplePdf(`${c.name.en} - Brand Guidelines`, ['Primary colours', 'Typography', 'Logo usage', 'Tone of voice']),
        days: 34,
      },
      {
        folder: 'month',
        name: 'content-calendar.pdf',
        kind: 'pdf',
        mime: 'application/pdf',
        by: c.am,
        side: 'agency',
        vis: 'client',
        body: () =>
          simplePdf(`${c.name.en} - Content Calendar`, [
            'Week 1: Brand story reel',
            'Week 2: Product highlight posts',
            'Week 3: Customer testimonials',
            'Week 4: Monthly offer campaign',
          ]),
        days: 6,
      },
      {
        folder: 'month',
        name: 'post-01-hero.png',
        kind: 'image',
        mime: 'image/png',
        by: 'khalid',
        side: 'agency',
        vis: 'client',
        body: () => artworkPng(1080, 1080, from, to, accent),
        days: 4,
      },
      {
        folder: 'month',
        name: 'post-02-offer.png',
        kind: 'image',
        mime: 'image/png',
        by: 'reem',
        side: 'agency',
        vis: 'client',
        body: () => artworkPng(1080, 1350, to, from, accent),
        days: 2,
      },
      {
        folder: 'project',
        name: 'campaign-brief.pdf',
        kind: 'pdf',
        mime: 'application/pdf',
        by: c.am,
        side: 'agency',
        vis: 'client',
        body: () =>
          simplePdf(`${c.name.en} - Campaign Brief`, [
            'Objective: awareness and store visits',
            'Audience: Riyadh, 18-44',
            'Channels: Snapchat, TikTok, Instagram',
            'Budget split: 50 / 30 / 20',
          ]),
        days: 12,
      },
      {
        folder: 'project',
        name: 'key-visual.png',
        kind: 'image',
        mime: 'image/png',
        by: 'reem',
        side: 'agency',
        vis: 'client',
        body: () => artworkPng(1600, 900, accent, from, to),
        days: 10,
      },
      {
        folder: 'internal',
        name: 'draft-concepts-v1.png',
        kind: 'image',
        mime: 'image/png',
        by: 'khalid',
        side: 'agency',
        vis: 'internal',
        body: () => artworkPng(1080, 1080, '#333844', from, accent),
        days: 3,
      },
      {
        folder: 'internal',
        name: 'pricing-notes.pdf',
        kind: 'pdf',
        mime: 'application/pdf',
        by: c.am,
        side: 'agency',
        vis: 'internal',
        body: () => simplePdf('Internal - Pricing notes', ['Do not share with client', 'Renewal discount ceiling: 10%']),
        days: 8,
      },
    ] as const;
    for (const f of fileDefs) {
      const fileId = crypto.randomUUID();
      const path = `org/${ORG_ID}/clients/${clientId}/${folderIds[f.folder]}/${fileId}-${f.name}`;
      const body = f.body();
      await upload(path, body, f.mime);
      await db.insert(schema.files).values({
        id: fileId,
        organizationId: ORG_ID,
        clientId,
        folderId: folderIds[f.folder]!,
        name: f.name,
        storagePath: path,
        mimeType: f.mime,
        sizeBytes: body.length,
        kind: f.kind,
        visibility: f.vis,
        uploadedBy: ids[f.by]!,
        uploaderSide: f.side,
        createdAt: daysAgo(f.days, 11),
      });
    }

    // Threads ---------------------------------------------------------------
    const member = c.users.find((u) => u.role === 'client_member')!;
    const threadDefs = [
      {
        title: 'عام · General',
        visibility: 'client',
        comments: [
          {
            by: c.am,
            side: 'agency',
            d: 9,
            body: `أهلًا ${owner.name}! هذه مساحة التواصل المباشر مع فريقنا. أي ملاحظة أو طلب اكتبه هنا وسنرد خلال ساعات العمل.`,
          },
          { by: owner.key, side: 'client', d: 9, body: 'ممتاز، شكرًا لكم. نحتاج نركز هذا الشهر على العروض الأسبوعية.' },
          { by: c.am, side: 'agency', d: 8, body: 'تم. أضفنا تقويم المحتوى لهذا الشهر في مجلد الملفات، راجعه وأخبرنا برأيك.' },
          {
            by: c.am,
            side: 'agency',
            d: 8,
            internal: true,
            body: 'ملاحظة داخلية: العميل حساس للأسعار، لا نقترح زيادة الميزانية هذا الشهر.',
          },
          { by: member.key, side: 'client', d: 5, body: 'اطلعت على التقويم. هل يمكن تقديم منشور العرض إلى يوم الخميس؟' },
          { by: 'hind', side: 'agency', d: 4, body: 'أكيد، عدّلنا الجدول وسيُنشر الخميس الساعة 8 مساءً.' },
          { by: c.am, side: 'agency', d: 1, body: 'شاركنا تصميمين جديدين في مجلد هذا الشهر، بانتظار ملاحظاتكم 🙏' },
        ],
      },
      {
        title: 'حملة موسم الرياض · Riyadh Season campaign',
        visibility: 'client',
        comments: [
          { by: c.am, side: 'agency', d: 13, body: 'أرفقنا ملخص الحملة المقترح. الهدف زيادة الزيارات خلال موسم الرياض.' },
          { by: owner.key, side: 'client', d: 12, body: 'الفكرة ممتازة. نفضّل التركيز على سناب شات وتيك توك.' },
          { by: 'turki', side: 'agency', d: 11, body: 'سنوزع الميزانية 50٪ سناب، 30٪ تيك توك، 20٪ إنستغرام ونراجع الأداء أسبوعيًا.' },
        ],
      },
      {
        title: 'ملاحظات الفريق الداخلية · Team notes',
        visibility: 'internal',
        comments: [
          { by: c.am, side: 'agency', d: 7, body: 'تذكير: موعد تجديد العقد بعد شهرين. لنجهّز تقرير أداء مختصر.' },
          { by: 'reem', side: 'agency', d: 6, body: 'سأجهّز نسخة محدثة من الهوية للاجتماع القادم.' },
        ],
      },
    ] as const;
    for (const th of threadDefs) {
      const [threadRow] = await db
        .insert(schema.threads)
        .values({
          organizationId: ORG_ID,
          clientId,
          title: th.title,
          visibility: th.visibility,
          createdBy: ids[c.am]!,
          createdAt: daysAgo(th.comments[0]!.d, 9),
        })
        .returning();
      for (const [i, cm] of th.comments.entries()) {
        await db.insert(schema.comments).values({
          organizationId: ORG_ID,
          clientId,
          threadId: threadRow!.id,
          authorId: ids[cm.by]!,
          authorSide: cm.side,
          body: cm.body,
          visibility: th.visibility === 'internal' || ('internal' in cm && cm.internal) ? 'internal' : 'client',
          createdAt: daysAgo(cm.d, 9 + i),
        });
      }
      // Agency has read everything; the client owner has read all but the latest message.
      await db
        .insert(schema.threadReads)
        .values({ threadId: threadRow!.id, userId: ids[c.am]!, organizationId: ORG_ID, clientId, lastReadAt: new Date() });
      if (th.visibility === 'client') {
        await db
          .insert(schema.threadReads)
          .values({ threadId: threadRow!.id, userId: ids[owner.key]!, organizationId: ORG_ID, clientId, lastReadAt: daysAgo(2) });
      }
    }

    // Notifications for the client owner.
    await db.insert(schema.notifications).values([
      {
        organizationId: ORG_ID,
        userId: ids[owner.key]!,
        type: 'file_shared',
        category: 'files',
        params: { file: 'post-02-offer.png', actor: 'ريم الدوسري' },
        link: '/portal/files',
        actorId: ids.reem!,
        createdAt: daysAgo(2),
      },
      {
        organizationId: ORG_ID,
        userId: ids[owner.key]!,
        type: 'message_new',
        category: 'messages',
        params: { actor: staff.find((s) => s.key === c.am)!.name, thread: 'عام · General', preview: 'شاركنا تصميمين جديدين…' },
        link: '/portal/messages',
        actorId: ids[c.am]!,
        createdAt: daysAgo(1),
      },
    ]);
  }

  await seedRequests(ids, clientIds);
  await seedTasksData({ db, ids, clientIds, orgId: ORG_ID, upload, clients: clientSeeds });

  // --- Invitations (pending + expired) --------------------------------------
  await db.insert(schema.invitations).values([
    {
      organizationId: ORG_ID,
      email: 'yousef@ofoq.test',
      fullName: 'يوسف البقمي',
      userType: 'agency',
      roleIds: [roleId('specialist')],
      departmentId: deptId('design'),
      locale: 'ar',
      tokenHash: hashInvitationToken('seed-pending-team-invitation-token-000000000001'),
      expiresAt: new Date(Date.now() + 5 * 86400000),
      invitedBy: ids.sara!,
    },
    {
      organizationId: ORG_ID,
      email: 'mariam@ofoq.test',
      fullName: 'مريم الشمري',
      userType: 'agency',
      roleIds: [roleId('account_manager')],
      departmentId: deptId('account_management'),
      locale: 'en',
      tokenHash: hashInvitationToken('seed-expired-team-invitation-token-00000000002'),
      expiresAt: daysAgo(3),
      lastSentAt: daysAgo(10),
      invitedBy: ids.faisal!,
    },
  ]);

  // --- Notifications for agency users ---------------------------------------
  await db.insert(schema.notifications).values([
    {
      organizationId: ORG_ID,
      userId: ids.sara!,
      type: 'invitation_accepted',
      category: 'account',
      params: { name: 'هند السبيعي' },
      link: '/admin/users',
      actorId: ids.hind!,
      createdAt: daysAgo(3),
    },
    {
      organizationId: ORG_ID,
      userId: ids.noura!,
      type: 'message_new',
      category: 'messages',
      params: { actor: 'عبير السالم', thread: 'عام · General', preview: 'هل يمكن تقديم منشور العرض…' },
      link: '/messages',
      actorId: ids.abeer!,
      createdAt: daysAgo(5),
    },
  ]);

  const [usersCount] = await db.execute<{ count: number }>(sql`select count(*)::int as count from auth.users`);
  const [clientsCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.clients)
    .where(and(eq(schema.clients.organizationId, ORG_ID)));
  console.info(`✓ Seeded ${usersCount?.count} users, ${clientsCount?.n} clients. Password for every account: ${SEED_PASSWORD}`);
}

async function seedRequests(ids: Record<string, string>, clientIds: Record<string, string>) {
  await seedRequestsData({
    db,
    ids,
    clientIds,
    orgId: ORG_ID,
    upload,
    clients: clientSeeds,
    staffNames: Object.fromEntries(staff.map((s) => [s.key, s.name])),
  });
}

main()
  .then(() => client.end())
  .catch(async (error) => {
    console.error(error);
    await client.end();
    process.exit(1);
  });
