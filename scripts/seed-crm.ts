/**
 * Phase 6 seed: the agency's own sales and capacity data — an onboarding request type + workflow (used when a won
 * deal becomes a client), CRM settings, a public website form, assignment rules, a webhook token, monthly targets,
 * leads from every source (duplicates and a merged pair included), deals in every stage with contacts, stage
 * history, activities (done, overdue, due today, upcoming), quotes, plus team hours, time off and service effort.
 * Runs as the table owner, so the CRM triggers treat every write as a trusted system change and keep the
 * historical timestamps given here while still numbering leads, deals and quotes.
 */
import { createHash } from 'node:crypto';

import { and, asc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '../src/lib/db/schema';
import { leadScore } from '../src/modules/crm/leads';

type Db = PostgresJsDatabase<typeof schema>;

const L = (ar: string, en: string) => ({ ar, en });

/** Fixed so local testing, docs and the e2e suite can use them. */
export const SEED_FORM_TOKEN = 'ofoq-website-contact';
export const SEED_WEBHOOK_TOKEN = 'ctw_seed_local_only_webhook_token_0001';

type LeadSeed = {
  key: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  source: string;
  detail?: string;
  services: string[];
  budget: string;
  city?: string;
  owner?: 'majed' | 'ruba';
  status: string;
  days: number;
  tags?: string[];
  notes?: string;
  ref?: string;
};

const leadSeeds: LeadSeed[] = [
  {
    key: 'rawabi',
    name: 'عبدالله الدوسري',
    company: 'مطاعم روابي',
    phone: '+966551230001',
    email: 'abdullah@rawabi.test',
    source: 'website_form',
    services: ['social_media', 'photography'],
    budget: '15k_50k',
    city: 'riyadh',
    owner: 'majed',
    status: 'converted',
    days: 48,
  },
  {
    key: 'noor',
    name: 'Noor Al-Shehri',
    company: 'Noor Skincare',
    phone: '+966551230002',
    email: 'noor@noorskin.test',
    source: 'instagram',
    detail: '@noor.skin',
    services: ['social_media', 'influencers', 'ads'],
    budget: '50k_plus',
    city: 'jeddah',
    owner: 'ruba',
    status: 'converted',
    days: 40,
  },
  {
    key: 'tamkeen',
    name: 'فهد العنزي',
    company: 'تمكين للتقنية',
    phone: '+966551230003',
    email: 'fahad@tamkeen.test',
    source: 'referral',
    detail: 'من محمد الراشد (مطاعم نجد)',
    services: ['branding', 'web'],
    budget: '50k_plus',
    city: 'riyadh',
    owner: 'majed',
    status: 'converted',
    days: 70,
  },
  {
    key: 'bayt',
    name: 'Huda Khalil',
    company: 'Bayt Interiors',
    phone: '+966551230004',
    email: 'huda@bayt.test',
    source: 'event',
    detail: 'Riyadh Design Week',
    services: ['content', 'video'],
    budget: '15k_50k',
    city: 'riyadh',
    owner: 'ruba',
    status: 'converted',
    days: 35,
  },
  {
    key: 'sahm',
    name: 'سلطان الغامدي',
    company: 'سهم للاستثمار',
    phone: '+966551230005',
    source: 'whatsapp',
    services: ['ads'],
    budget: '15k_50k',
    city: 'dammam',
    owner: 'majed',
    status: 'converted',
    days: 26,
  },
  {
    key: 'qahwa',
    name: 'Maha Al-Otaibi',
    company: 'Qahwa Lab',
    phone: '+966551230006',
    email: 'maha@qahwalab.test',
    source: 'lead_ad',
    detail: 'Meta · Ramadan campaign',
    services: ['social_media', 'design'],
    budget: '5k_15k',
    city: 'riyadh',
    owner: 'ruba',
    status: 'converted',
    days: 22,
    ref: 'meta-lead-9001',
  },
  {
    key: 'wadi',
    name: 'تركي الشمري',
    company: 'وادي الرياضة',
    phone: '+966551230007',
    email: 'turki@wadi.test',
    source: 'website_form',
    services: ['video', 'ads'],
    budget: '15k_50k',
    city: 'riyadh',
    owner: 'majed',
    status: 'converted',
    days: 18,
  },
  {
    key: 'lamar',
    name: 'لمار الحسن',
    company: 'لمار للعطور',
    phone: '+966551230008',
    email: 'lamar@lamar.test',
    source: 'instagram',
    services: ['influencers', 'photography'],
    budget: '15k_50k',
    city: 'jeddah',
    owner: 'ruba',
    status: 'converted',
    days: 95,
  },
  {
    key: 'masar',
    name: 'Ahmed Farouk',
    company: 'Masar Logistics',
    phone: '+966551230009',
    email: 'ahmed@masar.test',
    source: 'referral',
    services: ['branding'],
    budget: '15k_50k',
    city: 'dammam',
    owner: 'majed',
    status: 'converted',
    days: 110,
  },
  {
    key: 'zahra',
    name: 'زهرة القرني',
    company: 'زهرة للحلويات',
    phone: '+966551230010',
    source: 'whatsapp',
    services: ['social_media'],
    budget: '5k_15k',
    city: 'abha',
    owner: 'ruba',
    status: 'converted',
    days: 60,
  },
  {
    key: 'jood',
    name: 'جود العمري',
    company: 'جود للأزياء',
    phone: '+966551230011',
    email: 'jood@jood.test',
    source: 'website_form',
    services: ['social_media', 'photography', 'ads'],
    budget: '15k_50k',
    city: 'riyadh',
    owner: 'majed',
    status: 'converted',
    days: 12,
  },
  {
    key: 'rafal',
    name: 'Khalid Bin Saeed',
    company: 'Rafal Real Estate',
    phone: '+966551230012',
    email: 'khalid@rafal.test',
    source: 'event',
    services: ['video', 'web'],
    budget: '50k_plus',
    city: 'riyadh',
    owner: 'ruba',
    status: 'converted',
    days: 9,
  },
  // Open leads (not yet deals)
  {
    key: 'mishkat',
    name: 'ريم السبيعي',
    company: 'مشكاة للتعليم',
    phone: '+966551230013',
    email: 'reem@mishkat.test',
    source: 'website_form',
    services: ['content', 'social_media'],
    budget: '5k_15k',
    city: 'riyadh',
    owner: 'majed',
    status: 'new',
    days: 0,
    notes: 'تريد عرضًا قبل بداية الفصل الدراسي.',
  },
  {
    key: 'dune',
    name: 'Omar Haddad',
    company: 'Dune Adventures',
    phone: '+966551230014',
    source: 'instagram',
    services: ['video', 'photography'],
    budget: '15k_50k',
    city: 'other',
    status: 'new',
    days: 0,
  },
  {
    key: 'sabah',
    name: 'صباح الزهراني',
    phone: '+966551230015',
    source: 'whatsapp',
    services: ['design'],
    budget: 'under_5k',
    city: 'makkah',
    owner: 'ruba',
    status: 'contacted',
    days: 3,
  },
  {
    key: 'atlas',
    name: 'Sara Mitchell',
    company: 'Atlas Clinics',
    email: 'sara@atlasclinics.test',
    source: 'lead_ad',
    detail: 'Meta · Clinics lookalike',
    services: ['ads', 'content'],
    budget: '15k_50k',
    city: 'jeddah',
    owner: 'ruba',
    status: 'qualified',
    days: 5,
    ref: 'meta-lead-9002',
  },
  {
    key: 'nakheel',
    name: 'نايف العتيبي',
    company: 'نخيل التمور',
    phone: '+966551230017',
    email: 'naif@nakheel.test',
    source: 'event',
    detail: 'معرض التمور',
    services: ['branding', 'photography'],
    budget: '15k_50k',
    city: 'qassim',
    owner: 'majed',
    status: 'contacted',
    days: 6,
  },
  {
    key: 'spark',
    name: 'Faris Al-Qahtani',
    company: 'Spark Gym',
    phone: '+966551230018',
    source: 'website_form',
    services: ['social_media', 'video'],
    budget: '5k_15k',
    city: 'riyadh',
    owner: 'majed',
    status: 'qualified',
    days: 8,
  },
  {
    key: 'wafra',
    name: 'وفرة ماركت',
    company: 'وفرة ماركت',
    phone: '+966551230019',
    source: 'referral',
    services: ['ads'],
    budget: 'unknown',
    city: 'dammam',
    status: 'new',
    days: 1,
  },
  {
    key: 'petals',
    name: 'Lina Petals',
    company: 'Petals Florist',
    email: 'lina@petals.test',
    source: 'manual',
    services: ['social_media'],
    budget: 'under_5k',
    city: 'jeddah',
    owner: 'ruba',
    status: 'unqualified',
    days: 20,
    notes: 'Budget too small for a monthly retainer for now; revisit in Q1.',
  },
  // Duplicates: same phone as "spark" with different spelling; same email as "atlas" arriving from the website.
  {
    key: 'spark-dup',
    name: 'فارس القحطاني',
    company: 'سبارك جيم',
    phone: '+966551230018',
    source: 'whatsapp',
    services: ['video'],
    budget: '5k_15k',
    city: 'riyadh',
    status: 'new',
    days: 1,
  },
  {
    key: 'atlas-dup',
    name: 'Sara M.',
    email: 'SARA@atlasclinics.test',
    source: 'website_form',
    services: ['ads'],
    budget: 'unknown',
    status: 'new',
    days: 2,
  },
  // An already merged pair.
  {
    key: 'nakheel-old',
    name: 'نايف',
    phone: '+966551230017',
    source: 'whatsapp',
    services: [],
    budget: 'unknown',
    status: 'merged',
    days: 7,
  },
];

type DealSeed = {
  lead: string;
  title: string;
  stage: number; // pipeline sort order: 1 New … 5 Negotiation, 6 Won, 7 Lost
  value: number; // SAR
  owner: 'majed' | 'ruba';
  pkg: 'starter' | 'growth' | 'premium' | null;
  close: number; // days from today (negative = past)
  created: number; // days ago
  closedDaysAgo?: number;
  lostReason?: string;
  lostNote?: string;
  contactTitle?: string;
};

const dealSeeds: DealSeed[] = [
  {
    lead: 'rawabi',
    title: 'مطاعم روابي — إدارة الحسابات',
    stage: 4,
    value: 42000,
    owner: 'majed',
    pkg: 'growth',
    close: 12,
    created: 45,
    contactTitle: 'مدير التسويق',
  },
  {
    lead: 'noor',
    title: 'Noor Skincare — launch campaign',
    stage: 5,
    value: 96000,
    owner: 'ruba',
    pkg: 'premium',
    close: 5,
    created: 38,
    contactTitle: 'Founder',
  },
  {
    lead: 'tamkeen',
    title: 'تمكين — هوية بصرية وموقع',
    stage: 3,
    value: 120000,
    owner: 'majed',
    pkg: null,
    close: 30,
    created: 30,
    contactTitle: 'الرئيس التنفيذي',
  },
  {
    lead: 'bayt',
    title: 'Bayt Interiors — content retainer',
    stage: 2,
    value: 36000,
    owner: 'ruba',
    pkg: 'growth',
    close: 40,
    created: 20,
  },
  { lead: 'sahm', title: 'سهم — حملات إعلانية', stage: 1, value: 24000, owner: 'majed', pkg: 'starter', close: 45, created: 10 },
  { lead: 'qahwa', title: 'Qahwa Lab — social starter', stage: 3, value: 18000, owner: 'ruba', pkg: 'starter', close: 18, created: 20 },
  { lead: 'wadi', title: 'وادي الرياضة — فيديو وإعلانات', stage: 2, value: 54000, owner: 'majed', pkg: 'growth', close: 25, created: 15 },
  {
    lead: 'jood',
    title: 'جود للأزياء — باقة النمو',
    stage: 4,
    value: 45000,
    owner: 'majed',
    pkg: 'growth',
    close: 8,
    created: 11,
    contactTitle: 'المالكة',
  },
  { lead: 'rafal', title: 'Rafal — project films', stage: 1, value: 150000, owner: 'ruba', pkg: 'premium', close: 60, created: 7 },
  // Won (one already converted to a client below) and lost, spread over past months for the dashboard.
  {
    lead: 'lamar',
    title: 'لمار للعطور — المؤثرون',
    stage: 6,
    value: 60000,
    owner: 'ruba',
    pkg: 'growth',
    close: -60,
    created: 95,
    closedDaysAgo: 62,
  },
  {
    lead: 'masar',
    title: 'Masar — rebrand',
    stage: 6,
    value: 85000,
    owner: 'majed',
    pkg: null,
    close: -80,
    created: 110,
    closedDaysAgo: 78,
  },
  {
    lead: 'zahra',
    title: 'زهرة للحلويات — سوشيال',
    stage: 6,
    value: 21000,
    owner: 'ruba',
    pkg: 'starter',
    close: -3,
    created: 58,
    closedDaysAgo: 4,
    contactTitle: 'المالكة',
  },
  {
    lead: 'rawabi',
    title: 'مطاعم روابي — تصوير المنيو',
    stage: 7,
    value: 12000,
    owner: 'majed',
    pkg: null,
    close: -20,
    created: 48,
    closedDaysAgo: 21,
    lostReason: 'price',
    lostNote: 'اختاروا مصورًا مستقلًا.',
  },
  {
    lead: 'sahm',
    title: 'سهم — موقع تعريفي',
    stage: 7,
    value: 30000,
    owner: 'majed',
    pkg: null,
    close: -10,
    created: 26,
    closedDaysAgo: 12,
    lostReason: 'timing',
  },
  {
    lead: 'noor',
    title: 'Noor Skincare — influencer pilot',
    stage: 7,
    value: 25000,
    owner: 'ruba',
    pkg: null,
    close: -30,
    created: 40,
    closedDaysAgo: 33,
    lostReason: 'competitor',
    lostNote: 'Went with an influencer agency.',
  },
];

export async function seedCrmData({
  db,
  ids,
  clientIds,
  orgId,
  today,
}: {
  db: Db;
  ids: Record<string, string>;
  clientIds: Record<string, string>;
  orgId: string;
  today: string;
}): Promise<void> {
  const now = Date.now();
  const ago = (days: number, hour = 10) => {
    const d = new Date(now - days * 86_400_000);
    d.setUTCHours(hour - 3, (days * 13) % 60, 0, 0); // hour in Riyadh (UTC+3)
    return d;
  };
  const dayOffset = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const monthStart = (offset: number) => {
    const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
  };
  const majed = ids.majed!;
  const ruba = ids.ruba!;

  const depts = await db.select().from(schema.departments).where(eq(schema.departments.organizationId, orgId));
  const deptId = (key: string) => depts.find((d) => d.key === key)!.id;
  const roles = await db.select().from(schema.roles).where(eq(schema.roles.organizationId, orgId));
  const pkgRows = await db
    .select()
    .from(schema.packages)
    .where(eq(schema.packages.organizationId, orgId))
    .orderBy(asc(schema.packages.priceMinor));
  const pkg = (k: DealSeed['pkg']) =>
    k === null ? null : (pkgRows[{ starter: 0, growth: 1, premium: 2 }[k]]?.id ?? pkgRows.at(-1)?.id ?? null);
  const [pipeline] = await db
    .select()
    .from(schema.pipelines)
    .where(and(eq(schema.pipelines.organizationId, orgId), eq(schema.pipelines.isDefault, true)));
  const stages = await db
    .select()
    .from(schema.pipelineStages)
    .where(eq(schema.pipelineStages.pipelineId, pipeline!.id))
    .orderBy(asc(schema.pipelineStages.sortOrder));
  const stage = (order: number) => stages[order - 1]!;

  // --- Onboarding request type + workflow (used by "Won → client") -----------------------------
  const [maxOrder] = await db.execute<{ n: number }>(
    sql`select coalesce(max(sort_order), 0)::int as n from public.request_types where organization_id = ${orgId}`,
  );
  const [onboardingType] = await db
    .insert(schema.requestTypes)
    .values({
      organizationId: orgId,
      key: 'onboarding',
      name: L('تهيئة عميل جديد', 'New client onboarding'),
      description: L(
        'الخطوات الأولى مع عميل جديد: الاجتماع التعريفي، الوصول للحسابات، الاستراتيجية وأول خطة محتوى.',
        'First steps with a new client: kickoff, account access, strategy and the first content plan.',
      ),
      icon: 'rocket',
      category: 'other',
      defaultPriority: 'high',
      slaDays: 10,
      packageItemType: null,
      isActive: true,
      formSchema: {
        fields: [
          { id: 'goals', type: 'long_text', label: L('أهداف العميل', 'Client goals'), required: false },
          { id: 'accounts', type: 'short_text', label: L('الحسابات المطلوب الوصول إليها', 'Accounts to get access to'), required: false },
        ],
      },
      sortOrder: (maxOrder?.n ?? 0) + 1,
      createdBy: ids.faisal!,
    })
    .returning({ id: schema.requestTypes.id });
  const [template] = await db
    .insert(schema.workflowTemplates)
    .values({
      organizationId: orgId,
      requestTypeId: onboardingType!.id,
      name: L('تهيئة عميل جديد', 'Client onboarding'),
      description: L('من التوقيع إلى أول خطة محتوى خلال أسبوعين.', 'From signature to the first content plan in two weeks.'),
      isActive: true,
      isDefault: true,
      createdBy: ids.faisal!,
    })
    .returning({ id: schema.workflowTemplates.id });
  const specialist = roles.find((r) => r.key === 'specialist')!.id;
  const steps = [
    {
      key: 'kickoff',
      name: L('الاجتماع التعريفي مع العميل', 'Kickoff meeting with the client'),
      dept: 'account_management',
      mode: 'account_manager',
      sla: 2,
      after: [] as string[],
    },
    {
      key: 'access',
      name: L('استلام الوصول للحسابات والأصول', 'Collect account access and brand assets'),
      dept: 'account_management',
      mode: 'account_manager',
      sla: 3,
      after: ['kickoff'],
    },
    {
      key: 'audit',
      name: L('مراجعة الحسابات الحالية', 'Audit current channels'),
      dept: 'content',
      mode: 'role',
      sla: 5,
      after: ['access'],
    },
    {
      key: 'guide',
      name: L('دليل الهوية المختصر للسوشيال', 'Social brand guide'),
      dept: 'design',
      mode: 'role',
      sla: 7,
      after: ['access'],
    },
    {
      key: 'plan',
      name: L('خطة المحتوى للشهر الأول', 'First-month content plan'),
      dept: 'content',
      mode: 'role',
      sla: 10,
      after: ['audit', 'guide'],
    },
  ] as const;
  const stepIds = Object.fromEntries(steps.map((s) => [s.key, crypto.randomUUID()]));
  await db.insert(schema.workflowTemplateSteps).values(
    steps.map((s, i) => ({
      id: stepIds[s.key]!,
      organizationId: orgId,
      templateId: template!.id,
      name: s.name,
      departmentId: deptId(s.dept),
      assigneeMode: s.mode,
      assigneeRoleId: s.mode === 'role' ? specialist : null,
      slaDays: s.sla,
      dependsOn: s.after.map((a) => stepIds[a]!),
      // Plain internal tasks: the Sales Manager can start this workflow without deliverable rights (ADR-061).
      requiresInternalReview: false,
      requiresClientApproval: false,
      deliverableType: null,
      sortOrder: i,
    })),
  );
  await db
    .insert(schema.crmSettings)
    .values({ organizationId: orgId, staleDays: 7, onboardingRequestTypeId: onboardingType!.id, onboardingTemplateId: template!.id })
    .onConflictDoUpdate({
      target: schema.crmSettings.organizationId,
      set: { staleDays: 7, onboardingRequestTypeId: onboardingType!.id, onboardingTemplateId: template!.id },
    });

  // --- Website form, rules, webhook token, targets ----------------------------------------------
  const [form] = await db
    .insert(schema.leadForms)
    .values({
      organizationId: orgId,
      name: 'نموذج التواصل في الموقع · Website contact form',
      token: SEED_FORM_TOKEN,
      isActive: true,
      services: [],
      thankYou: L(
        'شكرًا لتواصلك مع أفق! سيتصل بك فريق المبيعات خلال يوم عمل.',
        'Thanks for reaching out to Ofoq! Our sales team will call you within one business day.',
      ),
      submissions: 5,
      createdBy: majed,
    })
    .returning({ id: schema.leadForms.id });
  await db.insert(schema.leadAssignmentRules).values([
    {
      organizationId: orgId,
      name: 'Jeddah & lead ads → Ruba',
      matchServices: [],
      matchCities: ['jeddah'],
      matchSources: [],
      memberIds: [ruba],
      isActive: true,
      sortOrder: 1,
    },
    {
      organizationId: orgId,
      name: 'Round robin · everyone',
      matchServices: [],
      matchCities: [],
      matchSources: [],
      memberIds: [majed, ruba],
      isActive: true,
      sortOrder: 2,
    },
  ]);
  await db.insert(schema.crmWebhookTokens).values({
    organizationId: orgId,
    name: 'Meta Lead Ads (local test)',
    tokenHash: createHash('sha256').update(SEED_WEBHOOK_TOKEN).digest('hex'),
    lastUsedAt: ago(5),
    createdBy: ids.sara!,
  });
  await db.insert(schema.salesTargets).values([
    { organizationId: orgId, ownerId: null, month: monthStart(-2), amountMinor: 12_000_000 },
    { organizationId: orgId, ownerId: null, month: monthStart(-1), amountMinor: 12_000_000 },
    { organizationId: orgId, ownerId: null, month: monthStart(0), amountMinor: 15_000_000 },
    { organizationId: orgId, ownerId: null, month: monthStart(1), amountMinor: 15_000_000 },
    { organizationId: orgId, ownerId: null, month: monthStart(2), amountMinor: 18_000_000 },
    { organizationId: orgId, ownerId: majed, month: monthStart(0), amountMinor: 8_000_000 },
    { organizationId: orgId, ownerId: ruba, month: monthStart(0), amountMinor: 7_000_000 },
  ]);

  // --- Leads ------------------------------------------------------------------------------------
  const leadIds: Record<string, string> = {};
  for (const l of [...leadSeeds].sort((a, b) => b.days - a.days)) {
    const [row] = await db
      .insert(schema.leads)
      .values({
        organizationId: orgId,
        fullName: l.name,
        company: l.company ?? null,
        phone: l.phone ?? null,
        email: l.email ?? null,
        source: l.source,
        sourceDetail: l.detail ?? null,
        externalRef: l.ref ?? null,
        services: l.services,
        budgetRange: l.budget,
        city: l.city ?? null,
        ownerId: l.owner ? ids[l.owner]! : null,
        status: l.status === 'merged' ? 'new' : l.status,
        score: leadScore({
          budgetRange: l.budget as never,
          source: l.source as never,
          phone: l.phone ?? null,
          email: l.email ?? null,
          company: l.company ?? null,
          services: l.services,
          city: l.city ?? null,
        }),
        tags: l.tags ?? [],
        notes: l.notes ?? '',
        formId: l.source === 'website_form' ? form!.id : null,
        lastActivityAt: ago(l.days, 9),
        createdAt: ago(l.days, 9),
        createdBy: l.source === 'manual' ? ruba : null,
      })
      .returning({ id: schema.leads.id });
    leadIds[l.key] = row!.id;
  }
  await db
    .update(schema.leads)
    .set({ status: 'merged', mergedIntoId: leadIds.nakheel! })
    .where(eq(schema.leads.id, leadIds['nakheel-old']!));

  // --- Deals, contacts, stage history -----------------------------------------------------------
  const dealIds: string[] = [];
  const openStages = stages.filter((s) => s.kind === 'open');
  for (const d of dealSeeds) {
    const lead = leadSeeds.find((l) => l.key === d.lead)!;
    const s = stage(d.stage);
    const closedAt = d.closedDaysAgo !== undefined ? ago(d.closedDaysAgo, 14) : null;
    const [row] = await db
      .insert(schema.deals)
      .values({
        organizationId: orgId,
        title: d.title,
        leadId: leadIds[d.lead]!,
        company: lead.company ?? null,
        pipelineId: pipeline!.id,
        stageId: s.id,
        valueMinor: d.value * 100,
        expectedCloseDate: dayOffset(d.close),
        ownerId: ids[d.owner]!,
        packageId: pkg(d.pkg),
        source: lead.source,
        lostReason: d.lostReason ?? null,
        lostNote: d.lostNote ?? null,
        wonAt: s.kind === 'won' ? closedAt : null,
        lostAt: s.kind === 'lost' ? closedAt : null,
        createdAt: ago(d.created, 11),
        lastActivityAt: closedAt ?? ago(Math.min(d.created, d.stage === 1 ? 9 : 2), 12),
        createdBy: ids[d.owner]!,
      })
      .returning({ id: schema.deals.id });
    const dealId = row!.id;
    dealIds.push(dealId);

    // Rebuild the stage history as it would have happened: through each open stage up to where it is now.
    await db.delete(schema.dealStageHistory).where(eq(schema.dealStageHistory.dealId, dealId));
    const reachedOpen =
      s.kind === 'open'
        ? openStages.filter((x) => x.sortOrder <= s.sortOrder)
        : openStages.slice(0, s.kind === 'won' ? openStages.length : Math.min(3, openStages.length));
    const path = s.kind === 'open' ? reachedOpen : [...reachedOpen, s];
    const span = d.created - (d.closedDaysAgo ?? 0);
    let prev: string | null = null;
    for (const [i, st] of path.entries()) {
      const daysAgo = d.created - Math.round((span * i) / Math.max(1, path.length - 1));
      await db.insert(schema.dealStageHistory).values({
        organizationId: orgId,
        dealId,
        fromStageId: prev,
        toStageId: st.id,
        actorId: ids[d.owner]!,
        createdAt: ago(Math.max(0, daysAgo), 11 + i),
      });
      prev = st.id;
    }

    const contactName = lead.name;
    await db.insert(schema.dealContacts).values({
      organizationId: orgId,
      dealId,
      fullName: contactName,
      jobTitle: d.contactTitle ?? null,
      phone: lead.phone ?? null,
      email: lead.email ?? null,
      isPrimary: true,
    });
  }
  await db.insert(schema.dealContacts).values([
    {
      organizationId: orgId,
      dealId: dealIds[1]!,
      fullName: 'Rana Al-Harbi',
      jobTitle: 'Marketing lead',
      email: 'rana@noorskin.test',
      isPrimary: false,
    },
    {
      organizationId: orgId,
      dealId: dealIds[2]!,
      fullName: 'منيرة العنزي',
      jobTitle: 'مديرة المشتريات',
      phone: '+966551239903',
      isPrimary: false,
    },
  ]);
  // The older won deal became an existing client (Lujain Fashion) — shows the "now a client" link.
  if (clientIds['lujain-fashion'])
    await db
      .update(schema.deals)
      .set({ clientId: clientIds['lujain-fashion'], convertedAt: ago(61, 15) })
      .where(eq(schema.deals.id, dealIds[9]!));

  // --- Activities -------------------------------------------------------------------------------
  const at = (days: number, hour: number) => {
    const d = new Date(Date.parse(`${today}T00:00:00+03:00`) + days * 86_400_000 + hour * 3_600_000);
    return d;
  };
  type Act = {
    lead?: string;
    deal?: number;
    type: string;
    subject: string;
    body?: string;
    owner: 'majed' | 'ruba';
    done?: number;
    due?: [number, number];
  };
  const acts: Act[] = [
    {
      deal: 0,
      type: 'call',
      subject: 'مكالمة تعريفية مع عبدالله',
      body: 'مهتمون بإدارة إنستغرام وتيك توك، ثلاثة فروع في الرياض.',
      owner: 'majed',
      done: 44,
    },
    { deal: 0, type: 'meeting', subject: 'اجتماع في مقر روابي', owner: 'majed', done: 30 },
    { deal: 0, type: 'email', subject: 'إرسال عرض السعر', owner: 'majed', done: 6 },
    { deal: 0, type: 'call', subject: 'متابعة قرار العرض', owner: 'majed', due: [0, 11] },
    { deal: 1, type: 'meeting', subject: 'Launch strategy workshop', owner: 'ruba', done: 20 },
    {
      deal: 1,
      type: 'whatsapp',
      subject: 'Sent revised scope',
      body: 'Added two influencer packages and removed the website.',
      owner: 'ruba',
      done: 3,
    },
    { deal: 1, type: 'task', subject: 'Prepare final contract', owner: 'ruba', due: [0, 15] },
    { deal: 2, type: 'meeting', subject: 'عرض أعمال الهوية السابقة', owner: 'majed', done: 14 },
    { deal: 2, type: 'task', subject: 'تجهيز عرض الهوية والموقع', owner: 'majed', due: [-2, 12] },
    { deal: 3, type: 'call', subject: 'Discovery call', owner: 'ruba', done: 16 },
    { deal: 3, type: 'meeting', subject: 'Visit the showroom', owner: 'ruba', due: [2, 10] },
    { deal: 4, type: 'whatsapp', subject: 'رسالة ترحيب وطلب موعد', owner: 'majed', done: 9 },
    { deal: 5, type: 'meeting', subject: 'Tasting & shoot planning', owner: 'ruba', done: 10 },
    { deal: 5, type: 'call', subject: 'Follow up on the proposal', owner: 'ruba', due: [-1, 14] },
    { deal: 6, type: 'call', subject: 'مكالمة مع تركي عن الإعلانات', owner: 'majed', done: 13 },
    { deal: 7, type: 'email', subject: 'إرسال عرض باقة النمو', owner: 'majed', done: 4 },
    { deal: 7, type: 'call', subject: 'مراجعة العرض مع جود', owner: 'majed', due: [1, 13] },
    { deal: 8, type: 'meeting', subject: 'Site visit — Rafal towers', owner: 'ruba', due: [5, 10] },
    { deal: 11, type: 'meeting', subject: 'توقيع العقد', owner: 'ruba', done: 4 },
    { lead: 'mishkat', type: 'call', subject: 'الاتصال بريم للتعريف', owner: 'majed', due: [0, 16] },
    { lead: 'sabah', type: 'whatsapp', subject: 'أرسلنا نماذج أعمال التصميم', owner: 'ruba', done: 2 },
    { lead: 'atlas', type: 'email', subject: 'Sent clinic case studies', owner: 'ruba', done: 4 },
    { lead: 'atlas', type: 'call', subject: 'Qualify budget with Sara', owner: 'ruba', due: [3, 11] },
    { lead: 'nakheel', type: 'note', subject: 'التقينا في معرض التمور', body: 'يريدون تغليفًا جديدًا قبل رمضان.', owner: 'majed', done: 6 },
    { lead: 'spark', type: 'call', subject: 'Intro call with Faris', owner: 'majed', done: 7 },
    {
      lead: 'petals',
      type: 'note',
      subject: 'Not a fit yet',
      body: 'Budget under 5k; offered a one-off design pack instead.',
      owner: 'ruba',
      done: 19,
    },
  ];
  for (const a of acts) {
    const dealId = a.deal !== undefined ? dealIds[a.deal]! : null;
    const leadId = a.lead ? leadIds[a.lead]! : a.deal !== undefined ? leadIds[dealSeeds[a.deal]!.lead]! : null;
    const completedAt = a.done !== undefined ? ago(a.done, 13) : null;
    const dueAt = a.due ? at(a.due[0], a.due[1]) : null;
    await db.insert(schema.crmActivities).values({
      organizationId: orgId,
      leadId,
      dealId,
      type: a.type,
      subject: a.subject,
      body: a.body ?? '',
      dueAt,
      completedAt,
      ownerId: ids[a.owner]!,
      createdBy: ids[a.owner]!,
      // Past-due follow-ups were already announced by the daily sweep.
      remindedAt: dueAt && dueAt.getTime() < now ? dueAt : null,
      createdAt: completedAt ?? ago(Math.max(0, (a.due?.[0] ?? 0) < 0 ? 3 : 1), 9),
    });
  }
  // Inserting a deal stamps "last activity" with now; recompute it from the seeded history instead, so a couple of
  // open deals (Tamkeen, Sahm) have been quiet for longer than the 7-day threshold.
  await db.execute(sql`
    update public.deals d set last_activity_at = coalesce(
      (select max(a.completed_at) from public.crm_activities a where a.deal_id = d.id and a.completed_at is not null),
      d.won_at, d.lost_at, d.created_at)
    where d.organization_id = ${orgId}`);

  // --- Quotes -----------------------------------------------------------------------------------
  const growth = pkgRows[1] ?? pkgRows[0];
  const [q1] = await db
    .insert(schema.quotes)
    .values({
      organizationId: orgId,
      dealId: dealIds[0]!,
      title: 'عرض إدارة حسابات التواصل الاجتماعي — ٣ أشهر',
      locale: 'ar',
      status: 'sent',
      validUntil: dayOffset(14),
      discountMinor: 300_000,
      notes: 'الدفع شهريًا مقدمًا. يشمل العرض جلسة تصوير واحدة شهريًا. الأسعار لا تشمل ضريبة القيمة المضافة.',
      sentAt: ago(6, 12),
      createdBy: majed,
      createdAt: ago(7, 12),
    })
    .returning({ id: schema.quotes.id });
  await db.insert(schema.quoteItems).values([
    {
      organizationId: orgId,
      quoteId: q1!.id,
      packageId: growth?.id ?? null,
      description: growth ? (growth.name.ar ?? 'باقة النمو') : 'باقة النمو',
      quantity: 3,
      unitPriceMinor: 1_200_000,
      sortOrder: 0,
    },
    {
      organizationId: orgId,
      quoteId: q1!.id,
      packageId: null,
      description: 'إعداد الحسابات ودليل المحتوى (مرة واحدة)',
      quantity: 1,
      unitPriceMinor: 900_000,
      sortOrder: 1,
    },
  ]);
  const [q2] = await db
    .insert(schema.quotes)
    .values({
      organizationId: orgId,
      dealId: dealIds[1]!,
      title: 'Noor Skincare — launch campaign proposal',
      locale: 'en',
      status: 'draft',
      validUntil: dayOffset(21),
      notes: 'Includes two influencer packages. Media budget is billed separately at cost.',
      createdBy: ruba,
      createdAt: ago(3, 16),
    })
    .returning({ id: schema.quotes.id });
  await db.insert(schema.quoteItems).values([
    {
      organizationId: orgId,
      quoteId: q2!.id,
      packageId: pkgRows.at(-1)?.id ?? null,
      description: 'Premium retainer (monthly)',
      quantity: 3,
      unitPriceMinor: 2_400_000,
      sortOrder: 0,
    },
    {
      organizationId: orgId,
      quoteId: q2!.id,
      packageId: null,
      description: 'Influencer package — micro creators (x5)',
      quantity: 2,
      unitPriceMinor: 1_200_000,
      sortOrder: 1,
    },
  ]);

  // --- Capacity: hours, time off, service effort ------------------------------------------------
  await db.insert(schema.memberCapacity).values([
    { organizationId: orgId, userId: ids.khalid!, hoursPerWeek: 40 },
    { organizationId: orgId, userId: ids.reem!, hoursPerWeek: 30 },
    { organizationId: orgId, userId: ids.hind!, hoursPerWeek: 32 },
    { organizationId: orgId, userId: ids.sara!, hoursPerWeek: 10 },
    { organizationId: orgId, userId: ids.faisal!, hoursPerWeek: 20 },
  ]);
  await db.insert(schema.timeOff).values([
    {
      organizationId: orgId,
      userId: ids.omar!,
      startDate: dayOffset(7),
      endDate: dayOffset(11),
      kind: 'annual',
      note: 'إجازة عائلية',
      createdBy: ids.lama!,
    },
    {
      organizationId: orgId,
      userId: ids.khalid!,
      startDate: dayOffset(21),
      endDate: dayOffset(23),
      kind: 'annual',
      note: '',
      createdBy: ids.reem!,
    },
    {
      organizationId: orgId,
      userId: ids.hind!,
      startDate: dayOffset(-1),
      endDate: dayOffset(0),
      kind: 'sick',
      note: '',
      createdBy: ids.faisal!,
    },
  ]);
  const efforts: [string, string, number][] = [
    ['post', 'design', 1.5],
    ['post', 'content', 1],
    ['reel', 'video', 4],
    ['reel', 'content', 1],
    ['story', 'design', 0.5],
    ['video', 'video', 8],
    ['video', 'content', 1.5],
    ['design', 'design', 2],
    ['photo_shoot', 'video', 6],
    ['ad_campaign', 'media_buying', 6],
    ['ad_campaign', 'design', 2],
    ['blog_article', 'content', 3],
    ['revision_round', 'design', 1],
  ];
  await db
    .insert(schema.serviceEfforts)
    .values(efforts.map(([itemType, dept, hours]) => ({ organizationId: orgId, itemType, departmentId: deptId(dept), hours })));

  console.info(
    `✓ Seeded ${leadSeeds.length} leads, ${dealSeeds.length} deals, ${acts.length} activities, 2 quotes, a website form and capacity settings.`,
  );
}
