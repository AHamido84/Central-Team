/**
 * Twelve months of history for the Executive Center (FR7): package periods back to each client's start (two new
 * clients in the window, two former clients that churned), delivered requests with SLA times, completed tasks with
 * logged time, an always-on campaign per larger client, monthly leads with first responses, deals won and lost,
 * month-end KPI snapshots, this year's targets, and a board report schedule, a saved view and a note from the
 * chairman. Deterministic (seeded random), so every `db:reset` shows the same numbers.
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '../src/lib/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

const DAY = 86_400_000;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => isoDay(new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY));
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
function addMonths(iso: string, n: number) {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return isoDay(d);
}
const monthEnd = (iso: string) => addDays(addMonths(monthStart(iso), 1), -1);
/** A Riyadh working-hours instant on `iso` (09:00–17:00 local = 06:00–14:00 UTC). */
const at = (iso: string, rand: () => number) => new Date(Date.parse(`${iso}T06:00:00Z`) + Math.floor(rand() * 8 * 3600_000));
const isWorkday = (iso: string) => {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return dow !== 5 && dow !== 6; // Friday–Saturday weekend
};

/** Months back each client has been with the agency (current-period package excluded). */
const TENURE: Record<string, number> = {
  'najd-heritage': 12,
  'darb-coffee': 12,
  'future-smile': 8,
  'gulf-vision': 11,
  'lujain-fashion': 5,
};

const FORMER = [
  {
    slug: 'riyadh-motors',
    name: { ar: 'معارض الرياض للسيارات', en: 'Riyadh Motors' },
    industry: 'automotive',
    am: 'abdulrahman',
    pkg: 'growth',
    fromMonthsAgo: 12,
    toMonthsAgo: 4,
  },
  {
    slug: 'coastal-clinics',
    name: { ar: 'عيادات الساحل', en: 'Coastal Clinics' },
    industry: 'healthcare',
    am: 'noura',
    pkg: 'starter',
    fromMonthsAgo: 12,
    toMonthsAgo: 9,
  },
] as const;

const REQUEST_TITLES = [
  'تصاميم منشورات الأسبوع',
  'فيديو قصير للعرض الجديد',
  'محتوى حملة نهاية الشهر',
  'تحديث الهوية في القوالب',
  'إعلان ممول للمنتج',
  'تقرير أداء الحملة',
];

const TASK_TITLES = ['تصميم منشور', 'مونتاج فيديو', 'كتابة محتوى', 'إعداد حملة', 'مراجعة نهائية', 'جدولة النشر'];

const LEAD_NAMES = [
  'شركة الأفق',
  'مؤسسة الريادة',
  'متجر النخبة',
  'مطعم السنابل',
  'عيادة الشفاء',
  'معهد المعرفة',
  'فندق الواحة',
  'مكتب العقار',
];
const LEAD_SOURCES = ['website_form', 'instagram', 'referral', 'lead_ad', 'whatsapp', 'event'] as const;
const LOST_REASONS = ['price', 'timing', 'competitor', 'no_response', 'not_fit'] as const;

export async function seedExecutiveData(opts: {
  db: Db;
  ids: Record<string, string>;
  clientIds: Record<string, string>;
  orgId: string;
  /** Riyadh day, YYYY-MM-DD. */
  today: string;
}) {
  const { db, ids, clientIds, orgId, today } = opts;
  const rand = mulberry32(20261012);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));

  // --- Package history -----------------------------------------------------------------------------------------
  const current = await db
    .select({
      clientId: schema.clientPackages.clientId,
      packageId: schema.clientPackages.packageId,
      periodStart: schema.clientPackages.periodStart,
    })
    .from(schema.clientPackages)
    .where(eq(schema.clientPackages.organizationId, orgId));
  const pkgs = await db
    .select({ id: schema.packages.id, priceMinor: schema.packages.priceMinor, name: schema.packages.name })
    .from(schema.packages)
    .where(eq(schema.packages.organizationId, orgId));
  const pkgByKey = (key: string) => pkgs.find((p) => (p.name as { en?: string }).en?.toLowerCase().includes(key)) ?? pkgs[0]!;
  const startOf: Record<string, string> = {};
  let packageRows = 0;
  for (const [slug, months] of Object.entries(TENURE)) {
    const clientId = clientIds[slug];
    const cp = current.find((c) => c.clientId === clientId);
    if (!clientId || !cp) continue;
    const first = addMonths(cp.periodStart, -months);
    startOf[clientId] = first;
    const rows = [];
    for (let m = first; m < cp.periodStart; m = addMonths(m, 1)) {
      rows.push({
        organizationId: orgId,
        clientId,
        packageId: cp.packageId,
        periodStart: m,
        periodEnd: monthEnd(m),
        createdBy: ids.faisal!,
      });
    }
    if (rows.length) await db.insert(schema.clientPackages).values(rows);
    packageRows += rows.length;
    await db.update(schema.clients).set({ startDate: first }).where(eq(schema.clients.id, clientId));
  }
  const thisMonth = monthStart(today);
  for (const f of FORMER) {
    const from = addMonths(thisMonth, -f.fromMonthsAgo);
    const lastMonth = addMonths(thisMonth, -f.toMonthsAgo);
    const [row] = await db
      .insert(schema.clients)
      .values({
        organizationId: orgId,
        name: f.name,
        slug: f.slug,
        industry: f.industry,
        city: 'riyadh',
        status: 'archived',
        accountManagerId: ids[f.am]!,
        startDate: from,
        createdBy: ids.faisal!,
      })
      .returning({ id: schema.clients.id });
    clientIds[f.slug] = row!.id;
    startOf[row!.id] = from;
    const rows = [];
    for (let m = from; m <= lastMonth; m = addMonths(m, 1)) {
      rows.push({
        organizationId: orgId,
        clientId: row!.id,
        packageId: pkgByKey(f.pkg).id,
        periodStart: m,
        periodEnd: monthEnd(m),
        createdBy: ids.faisal!,
      });
    }
    await db.insert(schema.clientPackages).values(rows);
    packageRows += rows.length;
  }
  /** Was the client with us in month `m` (history months only)? */
  const activeIn = (clientId: string, m: string) => {
    const former = FORMER.find((f) => clientIds[f.slug] === clientId);
    if (former) return m >= addMonths(thisMonth, -former.fromMonthsAgo) && m <= addMonths(thisMonth, -former.toMonthsAgo);
    return Boolean(startOf[clientId] && m >= startOf[clientId]!);
  };
  const allClients = Object.values(clientIds);
  // History stops where the regular seed's recent activity begins (about the last month).
  const historyMonths = Array.from({ length: 11 }, (_, i) => addMonths(thisMonth, i - 12)).filter((m) => monthEnd(m) < addDays(today, -30));

  // --- Requests: delivered, with response and resolution times ----------------------------------------------------
  const types = await db
    .select({ id: schema.requestTypes.id })
    .from(schema.requestTypes)
    .where(eq(schema.requestTypes.organizationId, orgId));
  let requestRows = 0;
  for (const m of types.length ? historyMonths : []) {
    for (const clientId of allClients.filter((c) => activeIn(c, m))) {
      const n = between(3, 6);
      for (let i = 0; i < n; i++) {
        const day = addDays(m, between(0, 24));
        if (!isWorkday(day)) continue;
        const submitted = at(day, rand);
        const late = rand() < 0.14;
        const slowReply = rand() < 0.1;
        const dueDate = addDays(day, 5);
        const delivered = new Date(submitted.getTime() + (late ? between(6, 11) : between(2, 5)) * DAY + between(1, 6) * 3600_000);
        const firstResponse = new Date(submitted.getTime() + (slowReply ? between(10, 30) : between(1, 6)) * 3600_000);
        await db.insert(schema.requests).values({
          organizationId: orgId,
          clientId,
          requestTypeId: pick(types).id,
          title: pick(REQUEST_TITLES),
          status: 'closed',
          priority: rand() < 0.2 ? 'high' : 'normal',
          createdBy: ids.noura!,
          submittedBy: ids.noura!,
          isExtra: rand() < 0.12,
          submittedAt: submitted,
          responseDueAt: new Date(submitted.getTime() + 8 * 3600_000),
          firstResponseAt: firstResponse,
          dueDate,
          acceptedAt: firstResponse,
          deliveredAt: delivered,
          closedAt: new Date(delivered.getTime() + DAY),
          lastActivityAt: new Date(delivered.getTime() + DAY),
          createdAt: submitted,
        });
        requestRows++;
      }
    }
  }

  // --- Tasks and logged time ---------------------------------------------------------------------------------------
  const [doneStatus] = await db
    .select({ id: schema.taskStatuses.id })
    .from(schema.taskStatuses)
    .where(and(eq(schema.taskStatuses.organizationId, orgId), eq(schema.taskStatuses.category, 'done')));
  const people = ['reem', 'khalid', 'lama', 'omar', 'hind', 'turki'].filter((k) => ids[k]);
  let taskRows = 0;
  let timeRows = 0;
  for (const m of historyMonths) {
    const clientsNow = allClients.filter((c) => activeIn(c, m));
    if (!clientsNow.length || !doneStatus) continue;
    // A busier agency over time: more work in later months.
    const load = 0.6 + 0.3 * (historyMonths.indexOf(m) / historyMonths.length);
    for (const person of people) {
      const userId = ids[person]!;
      const taskIds: { id: string; clientId: string }[] = [];
      const count = between(7, 11);
      for (let i = 0; i < count; i++) {
        const clientId = pick(clientsNow);
        const due = addDays(m, between(2, 26));
        const late = rand() < 0.12;
        const completed = at(addDays(due, late ? between(1, 4) : -between(0, 2)), rand);
        const id = crypto.randomUUID();
        await db.insert(schema.tasks).values({
          id,
          organizationId: orgId,
          clientId,
          title: pick(TASK_TITLES),
          statusId: doneStatus.id,
          statusCategory: 'done',
          dueDate: due,
          completedAt: completed,
          createdBy: ids.noura!,
          createdAt: new Date(completed.getTime() - between(3, 9) * DAY),
        });
        await db.insert(schema.taskMembers).values({ taskId: id, userId, role: 'assignee', organizationId: orgId, clientId });
        taskIds.push({ id, clientId });
        taskRows++;
      }
      const entries = [];
      for (let d = m; d <= monthEnd(m); d = addDays(d, 1)) {
        if (!isWorkday(d) || rand() < 0.05) continue;
        const minutes = Math.round((8 * 60 * load * (0.8 + rand() * 0.35)) / 15) * 15;
        const t = pick(taskIds);
        const started = new Date(Date.parse(`${d}T06:00:00Z`));
        entries.push({
          organizationId: orgId,
          clientId: t.clientId,
          taskId: t.id,
          userId,
          startedAt: started,
          endedAt: new Date(started.getTime() + minutes * 60_000),
          minutes,
          source: 'manual',
          note: '',
        });
      }
      if (entries.length) await db.insert(schema.timeEntries).values(entries);
      timeRows += entries.length;
    }
  }

  // --- An always-on campaign per larger client (before the regular seed's campaigns) -----------------------------
  const campaignEnd = addDays(today, -100);
  const campaignStart = addMonths(thisMonth, -12);
  let metricRows = 0;
  for (const slug of ['najd-heritage', 'darb-coffee', 'gulf-vision']) {
    const clientId = clientIds[slug];
    if (!clientId) continue;
    const [c] = await db
      .insert(schema.campaigns)
      .values({
        organizationId: orgId,
        clientId,
        name: 'حملة التواجد الدائم · Always-on',
        objective: 'leads',
        status: 'completed',
        startDate: campaignStart,
        endDate: campaignEnd,
        budgetMinor: 240_000_00,
        ownerId: ids.turki!,
        createdBy: ids.turki!,
      })
      .returning({ id: schema.campaigns.id });
    const channels = await db
      .insert(schema.campaignChannels)
      .values(
        (['meta', 'google'] as const).map((platform, i) => ({
          organizationId: orgId,
          clientId,
          campaignId: c!.id,
          platform,
          name: platform === 'meta' ? 'Meta' : 'Google Ads',
          budgetMinor: 120_000_00,
          sortOrder: i,
        })),
      )
      .returning({ id: schema.campaignChannels.id, platform: schema.campaignChannels.platform });
    const rows = [];
    for (let d = campaignStart; d <= campaignEnd; d = addDays(d, 1)) {
      // Ramadan-and-season shaped demand: a smooth yearly wave plus noise.
      const wave = 1 + 0.35 * Math.sin((Date.parse(d) / (365 * DAY)) * 2 * Math.PI);
      for (const ch of channels) {
        const spend = Math.round((ch.platform === 'meta' ? 520_00 : 410_00) * wave * (0.75 + rand() * 0.5));
        const impressions = Math.round(spend * (ch.platform === 'meta' ? 0.9 : 0.45));
        const clicks = Math.round(impressions * (ch.platform === 'meta' ? 0.012 : 0.035) * (0.8 + rand() * 0.4));
        const conversions = Math.round(clicks * 0.06 * (0.7 + rand() * 0.6));
        rows.push({
          organizationId: orgId,
          clientId,
          campaignId: c!.id,
          channelId: ch.id,
          date: d,
          impressions,
          reach: Math.round(impressions * 0.7),
          clicks,
          spendMinor: spend,
          conversions,
          leads: Math.round(conversions * 0.8),
          videoViews: 0,
          engagements: Math.round(clicks * 1.6),
          revenueMinor: Math.round(spend * (2.2 + rand() * 1.8)),
          source: 'manual',
          updatedBy: ids.turki!,
        });
      }
    }
    for (let i = 0; i < rows.length; i += 500) await db.insert(schema.metricsDaily).values(rows.slice(i, i + 500));
    metricRows += rows.length;
  }

  // --- Leads (with first response) and deals won / lost ----------------------------------------------------------
  const [pipeline] = await db
    .select({ id: schema.pipelines.id })
    .from(schema.pipelines)
    .where(and(eq(schema.pipelines.organizationId, orgId), eq(schema.pipelines.isDefault, true)));
  const stages = pipeline
    ? await db
        .select({ id: schema.pipelineStages.id, kind: schema.pipelineStages.kind, sortOrder: schema.pipelineStages.sortOrder })
        .from(schema.pipelineStages)
        .where(eq(schema.pipelineStages.pipelineId, pipeline.id))
    : [];
  const openStages = stages.filter((s) => s.kind === 'open').sort((a, b) => a.sortOrder - b.sortOrder);
  const wonStage = stages.find((s) => s.kind === 'won');
  const lostStage = stages.find((s) => s.kind === 'lost');
  const sellers = ['majed', 'ruba'].filter((k) => ids[k]);
  let leadRows = 0;
  let dealRows = 0;
  for (const [mi, m] of historyMonths.entries()) {
    const nLeads = between(8, 14) + Math.floor(mi / 3);
    for (let i = 0; i < nLeads; i++) {
      const created = at(addDays(m, between(0, 26)), rand);
      const owner = ids[pick(sellers)]!;
      const status = rand() < 0.25 ? 'converted' : rand() < 0.5 ? 'qualified' : rand() < 0.7 ? 'unqualified' : 'contacted';
      const [lead] = await db
        .insert(schema.leads)
        .values({
          organizationId: orgId,
          fullName: `${pick(LEAD_NAMES)} ${between(10, 99)}`,
          phone: `+9665${between(10000000, 99999999)}`,
          source: pick(LEAD_SOURCES),
          services: ['social_media'],
          ownerId: owner,
          status,
          createdAt: created,
          updatedAt: created,
        })
        .returning({ id: schema.leads.id });
      leadRows++;
      const responded = new Date(created.getTime() + (rand() < 0.2 ? between(20, 60) : between(1, 8)) * 3600_000);
      await db.insert(schema.crmActivities).values({
        organizationId: orgId,
        leadId: lead!.id,
        type: 'call',
        subject: 'اتصال تعريفي',
        completedAt: responded,
        ownerId: owner,
        createdBy: owner,
        createdAt: responded,
      });
    }
    if (!pipeline || !wonStage || !lostStage || !openStages.length) continue;
    const nDeals = between(2, 4);
    for (let i = 0; i < nDeals; i++) {
      const won = rand() < 0.42;
      const closed = at(addDays(m, between(3, 26)), rand);
      const created = new Date(closed.getTime() - between(14, 55) * DAY);
      const owner = ids[pick(sellers)]!;
      const stage = won ? wonStage : lostStage;
      const [deal] = await db
        .insert(schema.deals)
        .values({
          organizationId: orgId,
          title: `${pick(LEAD_NAMES)} · ${won ? 'باقة نمو' : 'عرض سنوي'}`,
          pipelineId: pipeline.id,
          stageId: stage.id,
          valueMinor: between(30, 160) * 1000_00,
          ownerId: owner,
          lostReason: won ? null : pick(LOST_REASONS),
          wonAt: won ? closed : null,
          lostAt: won ? null : closed,
          createdAt: created,
          lastActivityAt: closed,
          createdBy: owner,
        })
        .returning({ id: schema.deals.id });
      dealRows++;
      await db.delete(schema.dealStageHistory).where(eq(schema.dealStageHistory.dealId, deal!.id));
      const path = [...openStages.slice(0, won ? openStages.length : between(1, Math.min(3, openStages.length))), stage];
      let prev: string | null = null;
      for (const [si, st] of path.entries()) {
        await db.insert(schema.dealStageHistory).values({
          organizationId: orgId,
          dealId: deal!.id,
          fromStageId: prev,
          toStageId: st.id,
          actorId: owner,
          createdAt: new Date(created.getTime() + ((closed.getTime() - created.getTime()) * si) / Math.max(1, path.length - 1)),
        });
        prev = st.id;
      }
    }
  }

  // --- Month-end snapshots of the state metrics -----------------------------------------------------------------
  const snapshotRows: (typeof schema.kpiSnapshots.$inferInsert)[] = [];
  for (let i = 12; i >= 1; i--) {
    const day = monthEnd(addMonths(thisMonth, -i));
    const active = allClients.filter((c) => activeIn(c, monthStart(day))).length;
    const k = (12 - i) / 11;
    const health = Math.round(58 + 12 * k + (rand() - 0.5) * 6);
    const high = between(0, 2);
    const medium = between(1, 4);
    const low = between(0, 3);
    const push = (metric: string, value: number | null, details: Record<string, number> = {}) =>
      snapshotRows.push({ organizationId: orgId, day, metric, value, details });
    push('active_clients', active);
    push('avg_health', health, { healthy: Math.max(0, active - 2), watch: 1, at_risk: Math.min(1, active) });
    push('backlog_open', between(9, 18));
    push('backlog_aged', between(1, 5));
    push('pipeline_value', between(380, 720) * 1000_00);
    push('weighted_forecast', between(150, 320) * 1000_00);
    push('overloaded_departments', between(0, 2));
    push('campaigns_at_risk', between(0, 3));
    push('top5_share', 0.86 + rand() * 0.12);
    push('clv', between(95, 140) * 1000_00);
    push('open_risks', high + medium + low, { high, medium, low });
  }
  await db.insert(schema.kpiSnapshots).values(snapshotRows);

  // --- This year's targets ----------------------------------------------------------------------------------------
  const year = Number(today.slice(0, 4));
  const monthlyRevenue = current.reduce((n, c) => n + (pkgs.find((p) => p.id === c.packageId)?.priceMinor ?? 0), 0);
  const targets: { metric: string; quarter: number | null; value: number }[] = [
    { metric: 'revenue', quarter: null, value: Math.round(monthlyRevenue * 12 * 1.1) },
    { metric: 'new_clients', quarter: null, value: 4 },
    { metric: 'win_rate', quarter: null, value: 0.4 },
    { metric: 'roas', quarter: null, value: 3 },
    ...[1, 2, 3, 4].flatMap((q) => [
      { metric: 'on_time_rate', quarter: q, value: q < 3 ? 0.85 : 0.9 },
      { metric: 'sla_compliance', quarter: q, value: 0.9 },
      { metric: 'utilization', quarter: q, value: 0.75 },
    ]),
  ];
  await db.insert(schema.kpiTargets).values(targets.map((t) => ({ organizationId: orgId, year, ...t, createdBy: ids.chairman ?? null })));

  // --- The chairman's schedule, a pinned view and a note --------------------------------------------------------
  if (ids.chairman) {
    await db.insert(schema.executiveSchedules).values({
      organizationId: orgId,
      createdBy: ids.chairman,
      cadence: 'monthly',
      locale: 'ar',
      recipients: ['chairman@ofoq.test', 'board@ofoq.test'],
      nextRunOn: addMonths(thisMonth, 1),
    });
    await db.insert(schema.executiveViews).values({
      organizationId: orgId,
      userId: ids.chairman,
      name: 'الربع الحالي مقابل العام الماضي',
      config: { tab: 'overview', preset: 'qtd', compare: 'last_year', filters: {} },
      pinned: true,
    });
    await db.insert(schema.executiveNotes).values({
      organizationId: orgId,
      authorId: ids.chairman,
      kpi: 'on_time_rate',
      context: { tab: 'operations', preset: 'this_month', compare: 'previous', filters: {} },
      body: 'نسبة التسليم في الموعد أقل من المستهدف هذا الشهر. ما خطة التحسين للأسبوعين القادمين؟',
      ownerId: ids.noura ?? null,
      createdAt: new Date(Date.now() - 2 * DAY),
    });
  }

  console.info(
    `✓ Seeded 12 months of executive history: ${packageRows} package periods, ${requestRows} requests, ${taskRows} tasks, ${timeRows} time entries, ${metricRows} metric rows, ${leadRows} leads, ${dealRows} deals, ${snapshotRows.length} snapshots, ${targets.length} targets.`,
  );
}
