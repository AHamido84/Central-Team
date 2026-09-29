/**
 * Phase 4 seed: campaigns for every client in every state (active on track / at risk / off track, stale numbers,
 * planned, completed, draft, internal), daily metrics per channel with platform-realistic unit economics for the
 * Saudi market, KPI targets set so each campaign lands in its intended health, linked creatives and requests,
 * published + draft reports (snapshots built by the same code the app uses) and a monthly schedule.
 * Runs as the table owner, so triggers treat every write as a trusted system change.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { Tx } from '../src/lib/db/client';
import * as schema from '../src/lib/db/schema';
import type { CampaignObjective, MetricKey, Platform } from '../src/modules/campaigns/constants';
import { metricCatalog } from '../src/modules/campaigns/constants';
import { addDays, analyzeCampaign, eachDay, emptyTotals, metricValue, type MetricRow } from '../src/modules/campaigns/metrics';
import { defaultReportSections, firstRunOn, lastFullMonth } from '../src/modules/campaigns/periods';
import { buildReportSnapshot } from '../src/modules/campaigns/snapshot';

type Db = PostgresJsDatabase<typeof schema>;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Rough Saudi-market unit economics per platform (SAR). */
const economics: Record<Platform, { cpm: number; ctr: number; freq: number; vv: number; er: number }> = {
  meta: { cpm: 18, ctr: 0.012, freq: 2.2, vv: 0.3, er: 0.022 },
  instagram: { cpm: 20, ctr: 0.01, freq: 2.1, vv: 0.35, er: 0.03 },
  facebook: { cpm: 14, ctr: 0.011, freq: 2.4, vv: 0.25, er: 0.015 },
  tiktok: { cpm: 12, ctr: 0.009, freq: 1.9, vv: 0.45, er: 0.035 },
  snapchat: { cpm: 8, ctr: 0.007, freq: 2.6, vv: 0.38, er: 0.012 },
  google: { cpm: 45, ctr: 0.04, freq: 1.6, vv: 0, er: 0.01 },
  youtube: { cpm: 25, ctr: 0.004, freq: 1.8, vv: 0.55, er: 0.008 },
  x: { cpm: 15, ctr: 0.008, freq: 2, vv: 0.2, er: 0.02 },
  linkedin: { cpm: 90, ctr: 0.006, freq: 1.7, vv: 0.1, er: 0.012 },
  other: { cpm: 20, ctr: 0.01, freq: 2, vv: 0.2, er: 0.015 },
};

type Scenario = 'on_track' | 'at_risk' | 'off_track';

type CampaignSpec = {
  key: string;
  client: string;
  name: string;
  objective: CampaignObjective;
  status: 'draft' | 'planned' | 'active' | 'paused' | 'completed';
  visibility?: 'internal' | 'client';
  /** Relative to today. */
  start: number;
  end: number;
  /** Metrics stop this many days before today (0 = through yesterday). */
  metricsLag?: number;
  channels: { platform: Platform; name: string; budget: number }[];
  kpis: MetricKey[];
  scenario: Scenario;
  /** Conversion economics. */
  cvr?: number;
  leadRate?: number;
  aov?: number;
  description: string;
};

const specs: CampaignSpec[] = [
  {
    key: 'najd_season',
    client: 'najd-heritage',
    name: 'حملة موسم الرياض',
    objective: 'traffic',
    status: 'active',
    start: -45,
    end: 15,
    channels: [
      { platform: 'snapchat', name: 'سناب — الرياض', budget: 25_000 },
      { platform: 'tiktok', name: 'تيك توك — فيديو', budget: 20_000 },
      { platform: 'instagram', name: 'إنستغرام — ريلز', budget: 15_000 },
    ],
    kpis: ['impressions', 'clicks', 'ctr', 'cpc'],
    scenario: 'on_track',
    cvr: 0.02,
    description: 'زيادة زيارات الفروع خلال موسم الرياض عبر عروض الأطباق الموسمية.',
  },
  {
    key: 'najd_ramadan',
    client: 'najd-heritage',
    name: 'سحور نجد — رمضان',
    objective: 'awareness',
    status: 'completed',
    start: -140,
    end: -110,
    channels: [
      { platform: 'snapchat', name: 'سناب', budget: 18_000 },
      { platform: 'instagram', name: 'إنستغرام', budget: 12_000 },
    ],
    kpis: ['impressions', 'reach', 'cpm'],
    scenario: 'on_track',
    description: 'التعريف بقائمة السحور في فروع الرياض.',
  },
  {
    key: 'najd_jeddah',
    client: 'najd-heritage',
    name: 'افتتاح فرع جدة',
    objective: 'awareness',
    status: 'draft',
    start: 30,
    end: 60,
    channels: [{ platform: 'snapchat', name: 'سناب — جدة', budget: 30_000 }],
    kpis: ['impressions', 'reach'],
    scenario: 'on_track',
    description: 'مسودة: خطة إطلاق الفرع الجديد في جدة.',
  },
  {
    key: 'darb_winter',
    client: 'darb-coffee',
    name: 'إطلاق قهوة الشتاء',
    objective: 'engagement',
    status: 'active',
    start: -24,
    end: 20,
    metricsLag: 5,
    channels: [
      { platform: 'tiktok', name: 'تيك توك', budget: 14_000 },
      { platform: 'snapchat', name: 'سناب', budget: 9_000 },
    ],
    kpis: ['engagements', 'video_views', 'engagement_rate'],
    scenario: 'at_risk',
    description: 'إطلاق مشروبات الشتاء بمحتوى قصير مع صنّاع محتوى.',
  },
  {
    key: 'smile_leads',
    client: 'future-smile',
    name: 'عروض تقويم الأسنان',
    objective: 'leads',
    status: 'active',
    start: -30,
    end: 30,
    channels: [
      { platform: 'meta', name: 'ميتا — نماذج العملاء', budget: 22_000 },
      { platform: 'google', name: 'جوجل — بحث', budget: 18_000 },
    ],
    kpis: ['leads', 'cpl', 'ctr'],
    scenario: 'off_track',
    leadRate: 0.07,
    description: 'استقطاب عملاء محتملين لعروض التقويم الشفاف.',
  },
  {
    key: 'gulf_launch',
    client: 'gulf-vision',
    name: 'إطلاق مشروع واجهة الخليج',
    objective: 'leads',
    status: 'planned',
    start: 6,
    end: 66,
    channels: [
      { platform: 'google', name: 'جوجل — بحث', budget: 40_000 },
      { platform: 'meta', name: 'ميتا', budget: 35_000 },
      { platform: 'linkedin', name: 'لينكدإن — مستثمرون', budget: 15_000 },
    ],
    kpis: ['leads', 'cpl'],
    scenario: 'on_track',
    leadRate: 0.05,
    description: 'حجز الوحدات في المرحلة الأولى من المشروع.',
  },
  {
    key: 'gulf_brand',
    client: 'gulf-vision',
    name: 'الوعي بالعلامة — الربع الثالث',
    objective: 'awareness',
    status: 'completed',
    start: -100,
    end: -10,
    channels: [
      { platform: 'youtube', name: 'يوتيوب', budget: 25_000 },
      { platform: 'x', name: 'إكس', budget: 10_000 },
    ],
    kpis: ['impressions', 'video_views', 'cpm'],
    scenario: 'on_track',
    description: 'فيلم العلامة وإعلانات البحث عن المشاريع.',
  },
  {
    key: 'lujain_sale',
    client: 'lujain-fashion',
    name: 'تخفيضات نهاية الموسم',
    objective: 'sales',
    status: 'active',
    start: -20,
    end: 10,
    channels: [
      { platform: 'meta', name: 'ميتا — كتالوج', budget: 30_000 },
      { platform: 'tiktok', name: 'تيك توك — تسوّق', budget: 15_000 },
      { platform: 'snapchat', name: 'سناب', budget: 10_000 },
    ],
    kpis: ['conversions', 'roas', 'cpa'],
    scenario: 'on_track',
    cvr: 0.028,
    aov: 340,
    description: 'بيع تشكيلة الصيف قبل وصول تشكيلة الشتاء.',
  },
  {
    key: 'lujain_test',
    client: 'lujain-fashion',
    name: 'اختبار جمهور جديد (داخلي)',
    objective: 'traffic',
    status: 'active',
    visibility: 'internal',
    start: -12,
    end: 18,
    channels: [{ platform: 'instagram', name: 'إنستغرام — جمهور مشابه', budget: 6_000 }],
    kpis: ['clicks', 'cpc'],
    scenario: 'at_risk',
    description: 'اختبار داخلي قبل عرضه على العميل.',
  },
];

const scenarioRatio: Record<Scenario, number> = { on_track: 1.08, at_risk: 0.92, off_track: 0.72 };

/** Target that puts a KPI at `ratio` of its goal (see metrics.ts: volume projected, cost inverse, rate as is). */
function targetFor(metric: MetricKey, actual: number | null, elapsed: number, ratio: number): number {
  const kind = metricCatalog[metric].kind;
  const a = actual ?? 0;
  const raw = kind === 'volume' ? a / Math.max(elapsed, 0.01) / ratio : kind === 'cost' ? a * ratio : a / ratio;
  if (raw <= 0) return 1;
  const format = metricCatalog[metric].format;
  if (format === 'percent' || format === 'ratio' || format === 'decimal') return Math.round(raw * 10_000) / 10_000;
  // Round volumes/money to something a person would type.
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(raw)) - 1);
  return Math.max(1, Math.round(raw / magnitude) * magnitude);
}

export async function seedCampaignsData(opts: {
  db: Db;
  ids: Record<string, string>;
  clientIds: Record<string, string>;
  orgId: string;
  today: string;
}) {
  const { db, ids, clientIds, orgId, today } = opts;
  const rand = rng(20261001);
  const noise = (spread: number) => 1 - spread + rand() * spread * 2;
  const owners: Record<string, string> = {};
  const clientRows = await db
    .select({ id: schema.clients.id, am: schema.clients.accountManagerId })
    .from(schema.clients)
    .where(eq(schema.clients.organizationId, orgId));
  for (const c of clientRows) owners[c.id] = c.am ?? ids.noura!;

  const campaignIds: Record<string, string> = {};
  let rowCount = 0;
  for (const spec of specs) {
    const clientId = clientIds[spec.client]!;
    const startDate = addDays(today, spec.start);
    const endDate = addDays(today, spec.end);
    const budget = spec.channels.reduce((sum, c) => sum + c.budget, 0);
    const [campaign] = await db
      .insert(schema.campaigns)
      .values({
        organizationId: orgId,
        clientId,
        name: spec.name,
        objective: spec.objective,
        status: spec.status,
        visibility: spec.visibility ?? 'client',
        startDate,
        endDate,
        budgetMinor: budget * 100,
        // The media buyer owns the paid campaigns of the bigger accounts; the account manager the rest.
        ownerId: spec.channels.length >= 3 ? ids.turki! : owners[clientId]!,
        description: spec.description,
        createdBy: owners[clientId]!,
      })
      .returning({ id: schema.campaigns.id });
    campaignIds[spec.key] = campaign!.id;

    const channelRows = await db
      .insert(schema.campaignChannels)
      .values(
        spec.channels.map((ch, i) => ({
          organizationId: orgId,
          clientId,
          campaignId: campaign!.id,
          platform: ch.platform,
          name: ch.name,
          budgetMinor: ch.budget * 100,
          sortOrder: i,
        })),
      )
      .returning({
        id: schema.campaignChannels.id,
        platform: schema.campaignChannels.platform,
        budget: schema.campaignChannels.budgetMinor,
      });

    // Daily metrics from the start up to yesterday (or the lag), never past the end.
    const lastDay = [addDays(today, -1 - (spec.metricsLag ?? 0)), endDate].sort()[0]!;
    const flight = eachDay(startDate, endDate).length;
    const rows: MetricRow[] = [];
    if (startDate <= lastDay) {
      for (const ch of channelRows) {
        const e = economics[ch.platform as Platform];
        const daily = ch.budget / 100 / flight;
        for (const [i, date] of eachDay(startDate, lastDay).entries()) {
          const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
          // Thursday–Friday evenings are the busiest days for food & retail in KSA.
          const weekly = dow === 4 ? 1.15 : dow === 5 ? 1.2 : dow === 6 ? 1.05 : 0.95;
          const ramp = i < 3 ? 0.7 + i * 0.1 : 1;
          // ~97 % of an even pace, so finished flights end just under budget (overspend reads as off track).
          const spend = daily * weekly * ramp * noise(0.12) * 0.97 * (spec.scenario === 'at_risk' ? 0.93 : 1);
          const impressions = (spend / (e.cpm * noise(0.1))) * 1000;
          const clicks = impressions * e.ctr * noise(0.15) * (spec.scenario === 'off_track' ? 0.8 : 1);
          const conversions = clicks * (spec.cvr ?? 0.015) * noise(0.2);
          rows.push({
            date,
            channelId: ch.id,
            ...emptyTotals(),
            impressions: Math.round(impressions),
            reach: Math.round(impressions / (e.freq * noise(0.1))),
            clicks: Math.round(clicks),
            spend: Math.round(spend * 100),
            conversions: Math.round(conversions),
            leads: spec.leadRate ? Math.round(clicks * spec.leadRate * noise(0.25)) : 0,
            video_views: Math.round(impressions * e.vv * noise(0.1)),
            engagements: Math.round(impressions * e.er * noise(0.15)),
            revenue: spec.aov ? Math.round(conversions * spec.aov * noise(0.15) * 100) : 0,
          });
        }
      }
      for (let i = 0; i < rows.length; i += 500) {
        await db.insert(schema.metricsDaily).values(
          rows.slice(i, i + 500).map((r) => ({
            organizationId: orgId,
            clientId,
            campaignId: campaign!.id,
            channelId: r.channelId,
            date: r.date,
            impressions: r.impressions,
            reach: r.reach,
            clicks: r.clicks,
            spendMinor: r.spend,
            conversions: r.conversions,
            leads: r.leads,
            videoViews: r.video_views,
            engagements: r.engagements,
            revenueMinor: r.revenue,
            source: i === 0 && spec.key === 'najd_season' ? 'import' : 'manual',
            updatedBy: ids.turki!,
          })),
        );
      }
      rowCount += rows.length;
    }

    // KPI targets: each one lands where the scenario wants it (the first KPI carries the scenario, the rest on track).
    const shape = { startDate, endDate, budgetMinor: budget * 100, kpis: [] };
    const baseline = analyzeCampaign(shape, rows);
    const kpis = spec.kpis.map((metric, i) => {
      const ratio = i === 0 || spec.scenario === 'off_track' ? scenarioRatio[spec.scenario] : scenarioRatio.on_track;
      const actual = baseline.elapsed > 0 ? metricValue(baseline.totals, metric) : null;
      // Planned/draft campaigns have no numbers yet: targets from the plan (budget × typical rates).
      const planned = targetFor(metric, actual ?? plannedValue(metric, spec), baseline.elapsed || 1, ratio);
      return { metric, target: planned };
    });
    await db
      .insert(schema.campaignKpis)
      .values(
        kpis.map((k, i) => ({
          organizationId: orgId,
          clientId,
          campaignId: campaign!.id,
          metric: k.metric,
          target: k.target,
          channelId: null,
          sortOrder: i,
        })),
      );
    const analysis = analyzeCampaign({ ...shape, kpis: kpis.map((k) => ({ ...k, channelId: null })) }, rows);
    await db
      .update(schema.campaigns)
      .set({
        health: analysis.health,
        metricsThrough: analysis.through,
        healthNotified: analysis.health === 'at_risk' || analysis.health === 'off_track' ? analysis.health : null,
      })
      .where(eq(schema.campaigns.id, campaign!.id));
  }

  // One CSV import on record (the first batch of Riyadh Season numbers).
  const najdSeason = campaignIds.najd_season!;
  const [firstChannel] = await db.select().from(schema.campaignChannels).where(eq(schema.campaignChannels.campaignId, najdSeason)).limit(1);
  const [range] = await db
    .select({ from: sql<string>`min(date)::text`, to: sql<string>`max(date)::text`, n: sql<number>`count(*)::int` })
    .from(schema.metricsDaily)
    .where(and(eq(schema.metricsDaily.channelId, firstChannel!.id), eq(schema.metricsDaily.source, 'import')));
  if (range?.n) {
    const [imp] = await db
      .insert(schema.metricImports)
      .values({
        organizationId: orgId,
        clientId: clientIds['najd-heritage']!,
        campaignId: najdSeason,
        channelId: firstChannel!.id,
        fileName: 'snapchat-ads-export.csv',
        preset: 'snapchat',
        rowCount: range.n,
        dateFrom: range.from,
        dateTo: range.to,
        importedBy: ids.turki!,
      })
      .returning({ id: schema.metricImports.id });
    await db
      .update(schema.metricsDaily)
      .set({ importId: imp!.id })
      .where(and(eq(schema.metricsDaily.channelId, firstChannel!.id), eq(schema.metricsDaily.source, 'import')));
  }

  // Creatives: approved deliverables of each client join its active campaign; requests follow.
  const activeByClient = new Map<string, string>();
  for (const spec of specs)
    if (spec.status === 'active' && spec.visibility !== 'internal') activeByClient.set(clientIds[spec.client]!, campaignIds[spec.key]!);
  for (const [clientId, campaignId] of activeByClient) {
    const approved = await db
      .select({ id: schema.deliverables.id, requestId: schema.deliverables.requestId })
      .from(schema.deliverables)
      .where(and(eq(schema.deliverables.clientId, clientId), eq(schema.deliverables.status, 'approved')))
      .limit(4);
    if (!approved.length) continue;
    await db
      .update(schema.deliverables)
      .set({ campaignId })
      .where(
        inArray(
          schema.deliverables.id,
          approved.map((d) => d.id),
        ),
      );
    const requestIds = approved.map((d) => d.requestId).filter((r): r is string => Boolean(r));
    if (requestIds.length) await db.update(schema.requests).set({ campaignId }).where(inArray(schema.requests.id, requestIds));
  }

  // Reports: last month (published) for Najd and Lujain, a campaign report for the completed Gulf campaign,
  // a draft month-to-date report for Najd, and Najd's monthly schedule.
  const month = lastFullMonth(today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const reportSpecs = [
    {
      client: 'najd-heritage',
      campaign: null,
      title: 'التقرير الشهري — الشهر الماضي',
      start: month.start,
      end: month.end,
      publish: true,
      locale: 'ar' as const,
    },
    {
      client: 'najd-heritage',
      campaign: null,
      title: 'تقرير الشهر الحالي (مسودة)',
      start: monthStart,
      end: addDays(today, -1),
      publish: false,
      locale: 'ar' as const,
    },
    {
      client: 'lujain-fashion',
      campaign: null,
      title: 'Monthly performance report',
      start: month.start,
      end: month.end,
      publish: true,
      locale: 'en' as const,
    },
    {
      client: 'gulf-vision',
      campaign: campaignIds.gulf_brand!,
      title: 'تقرير ختام حملة الوعي بالعلامة',
      start: addDays(today, -100),
      end: addDays(today, -10),
      publish: true,
      locale: 'ar' as const,
    },
  ];
  const published: string[] = [];
  for (const r of reportSpecs) {
    const clientId = clientIds[r.client]!;
    await db.transaction(async (tx) => {
      const [report] = await tx
        .insert(schema.reports)
        .values({
          organizationId: orgId,
          clientId,
          campaignId: r.campaign,
          title: r.title,
          periodStart: r.start,
          periodEnd: r.end < r.start ? r.start : r.end,
          locale: r.locale,
          createdBy: owners[clientId]!,
        })
        .returning({ id: schema.reports.id });
      await tx.insert(schema.reportSections).values(
        defaultReportSections.map((s, i) => ({
          reportId: report!.id,
          organizationId: orgId,
          clientId,
          kind: s.kind,
          config: s.config ?? {},
          body:
            s.kind === 'commentary'
              ? r.locale === 'ar'
                ? 'حققت الحملة نموًا ملحوظًا في الوصول مع تحسّن تدريجي في تكلفة النقرة بعد تحسين الاستهداف في الأسبوع الثاني. أفضل أداء كان لمحتوى الفيديو القصير.'
                : 'Reach grew steadily and cost per click improved after the targeting changes in week two. Short-form video performed best.'
              : s.kind === 'next_steps'
                ? r.locale === 'ar'
                  ? '- زيادة ميزانية تيك توك ١٠٪\n- اختبار نسختين جديدتين من الإعلان\n- إطلاق حملة إعادة استهداف لزوار الموقع'
                  : '- Shift 10% of budget to TikTok\n- Test two new ad variations\n- Launch retargeting for site visitors'
                : '',
          sortOrder: i,
        })),
      );
      if (r.publish) {
        const snapshot = await buildReportSnapshot(tx as unknown as Tx, {
          clientId,
          campaignId: r.campaign,
          periodStart: r.start,
          periodEnd: r.end,
        });
        await tx
          .update(schema.reports)
          .set({ status: 'published', snapshot, publishedAt: new Date(`${r.end}T09:00:00Z`), publishedBy: owners[clientId]! })
          .where(eq(schema.reports.id, report!.id));
        published.push(report!.id);
      }
    });
  }
  await db.insert(schema.reportSchedules).values({
    organizationId: orgId,
    clientId: clientIds['najd-heritage']!,
    cadence: 'monthly',
    locale: 'ar',
    sections: defaultReportSections,
    autoPublish: false,
    nextRunOn: firstRunOn('monthly', today),
    createdBy: owners[clientIds['najd-heritage']!]!,
  });

  console.info(
    `✓ Seeded ${specs.length} campaigns, ${rowCount} daily metric rows and ${reportSpecs.length} reports (${published.length} published).`,
  );
  return { campaignIds };
}

/** Planned value over the whole flight from the budget and typical rates (for campaigns without numbers yet). */
function plannedValue(metric: MetricKey, spec: CampaignSpec): number {
  const t = emptyTotals();
  for (const ch of spec.channels) {
    const e = economics[ch.platform];
    const impressions = (ch.budget / e.cpm) * 1000;
    const clicks = impressions * e.ctr;
    t.spend += ch.budget * 100;
    t.impressions += impressions;
    t.reach += impressions / e.freq;
    t.clicks += clicks;
    t.leads += clicks * (spec.leadRate ?? 0);
    t.conversions += clicks * (spec.cvr ?? 0.015);
    t.video_views += impressions * e.vv;
    t.engagements += impressions * e.er;
  }
  return metricValue(t, metric) ?? 1;
}
