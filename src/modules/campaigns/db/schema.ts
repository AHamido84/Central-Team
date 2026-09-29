import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, updatedAt } from '@/lib/db/columns';
import { clients } from '@/modules/clients/db/schema';
import { organizations, profiles } from '@/modules/organizations/db/schema';
import type { ReportSectionConfig, ReportSnapshot, ScheduleSection } from '@/modules/campaigns/report-types';

/** A client's advertising campaign: flight, budget, channels and KPI targets. */
export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** Per-organization sequence, shown as `C-12` (trigger). */
    number: integer('number').notNull().default(0),
    name: text('name').notNull(),
    objective: text('objective').notNull().default('awareness'),
    status: text('status').notNull().default('draft'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    budgetMinor: bigint('budget_minor', { mode: 'number' }).notNull().default(0),
    currency: char('currency', { length: 3 }).notNull().default('SAR'),
    ownerId: uuid('owner_id').references(() => profiles.id, { onDelete: 'set null' }),
    description: text('description').notNull().default(''),
    /** `internal` campaigns (and every draft) never reach the portal. */
    visibility: text('visibility').notNull().default('client'),
    /** Cached by `refreshCampaignHealth()` (after metric writes and in the daily sweep) so lists stay cheap. */
    health: text('health').notNull().default('no_data'),
    /** Last health the owner was notified about (so an at-risk alert fires once per change). */
    healthNotified: text('health_notified'),
    /** Last day that has metrics. */
    metricsThrough: date('metrics_through'),
    /** Last "no metrics for a while" reminder. */
    staleNotifiedAt: timestamp('stale_notified_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('campaigns_org_number_idx').on(t.organizationId, t.number),
    index('campaigns_client_idx').on(t.clientId, t.status),
    index('campaigns_owner_idx').on(t.ownerId),
    check(
      'campaigns_objective_check',
      sql`${t.objective} in ('awareness','traffic','engagement','leads','sales','app_installs','video_views')`,
    ),
    check('campaigns_status_check', sql`${t.status} in ('draft','planned','active','paused','completed','archived')`),
    check('campaigns_visibility_check', sql`${t.visibility} in ('internal','client')`),
    check('campaigns_health_check', sql`${t.health} in ('on_track','at_risk','off_track','no_data')`),
    check('campaigns_dates_check', sql`${t.endDate} >= ${t.startDate}`),
    check('campaigns_budget_check', sql`${t.budgetMinor} >= 0`),
    check('campaigns_name_check', sql`char_length(${t.name}) between 1 and 160`),
    check('campaigns_description_check', sql`char_length(${t.description}) <= 5000`),
  ],
);

/** One platform the campaign runs on, with its share of the budget. */
export const campaignChannels = pgTable(
  'campaign_channels',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    name: text('name').notNull().default(''),
    budgetMinor: bigint('budget_minor', { mode: 'number' }).notNull().default(0),
    /** The platform's own campaign id — used by the Phase 7 sync. */
    externalRef: text('external_ref'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('campaign_channels_campaign_idx').on(t.campaignId, t.sortOrder),
    check(
      'campaign_channels_platform_check',
      sql`${t.platform} in ('meta','instagram','facebook','tiktok','snapchat','google','youtube','x','linkedin','other')`,
    ),
    check('campaign_channels_budget_check', sql`${t.budgetMinor} >= 0`),
    check('campaign_channels_name_check', sql`char_length(${t.name}) <= 120`),
  ],
);

/** A target for one metric, for the whole campaign or a single channel. */
export const campaignKpis = pgTable(
  'campaign_kpis',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id').references(() => campaignChannels.id, { onDelete: 'cascade' }),
    metric: text('metric').notNull(),
    target: numeric('target', { mode: 'number' }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('campaign_kpis_metric_idx').on(
      t.campaignId,
      sql`coalesce(${t.channelId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.metric,
    ),
    check(
      'campaign_kpis_metric_check',
      sql`${t.metric} in ('impressions','reach','clicks','spend','conversions','leads','video_views','engagements','revenue','ctr','cpc','cpm','cpa','cpl','roas','frequency','engagement_rate')`,
    ),
    check('campaign_kpis_target_check', sql`${t.target} > 0`),
  ],
);

/** CSV import log. */
export const metricImports = pgTable(
  'metric_imports',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => campaignChannels.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    preset: text('preset').notNull(),
    rowCount: integer('row_count').notNull(),
    dateFrom: date('date_from').notNull(),
    dateTo: date('date_to').notNull(),
    importedBy: uuid('imported_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('metric_imports_campaign_idx').on(t.campaignId, t.createdAt),
    check('metric_imports_preset_check', sql`${t.preset} in ('meta','tiktok','snapchat','google','custom')`),
    check('metric_imports_file_name_check', sql`char_length(${t.fileName}) between 1 and 255`),
  ],
);

/** One channel's numbers for one day. Derived metrics (CTR, CPC…) are computed, never stored. */
export const metricsDaily = pgTable(
  'metrics_daily',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => campaignChannels.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    impressions: bigint('impressions', { mode: 'number' }).notNull().default(0),
    reach: bigint('reach', { mode: 'number' }).notNull().default(0),
    clicks: bigint('clicks', { mode: 'number' }).notNull().default(0),
    spendMinor: bigint('spend_minor', { mode: 'number' }).notNull().default(0),
    conversions: bigint('conversions', { mode: 'number' }).notNull().default(0),
    leads: bigint('leads', { mode: 'number' }).notNull().default(0),
    videoViews: bigint('video_views', { mode: 'number' }).notNull().default(0),
    engagements: bigint('engagements', { mode: 'number' }).notNull().default(0),
    revenueMinor: bigint('revenue_minor', { mode: 'number' }).notNull().default(0),
    source: text('source').notNull().default('manual'),
    importId: uuid('import_id').references(() => metricImports.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('metrics_daily_channel_date_idx').on(t.channelId, t.date),
    index('metrics_daily_campaign_date_idx').on(t.campaignId, t.date),
    index('metrics_daily_client_date_idx').on(t.clientId, t.date),
    check('metrics_daily_source_check', sql`${t.source} in ('manual','import','api')`),
    check(
      'metrics_daily_non_negative_check',
      sql`least(${t.impressions}, ${t.reach}, ${t.clicks}, ${t.spendMinor}, ${t.conversions}, ${t.leads}, ${t.videoViews}, ${t.engagements}, ${t.revenueMinor}) >= 0`,
    ),
  ],
);

/** Recurring report: the daily sweep creates one for each period that ends. */
export const reportSchedules = pgTable(
  'report_schedules',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
    cadence: text('cadence').notNull().default('monthly'),
    locale: text('locale').notNull().default('ar'),
    sections: jsonb('sections').$type<ScheduleSection[]>().notNull().default([]),
    autoPublish: boolean('auto_publish').notNull().default(false),
    nextRunOn: date('next_run_on').notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('report_schedules_due_idx').on(t.isActive, t.nextRunOn),
    index('report_schedules_client_idx').on(t.clientId),
    check('report_schedules_cadence_check', sql`${t.cadence} in ('weekly','monthly')`),
    check('report_schedules_locale_check', sql`${t.locale} in ('ar','en')`),
  ],
);

/** A client report for a period. Publishing freezes the numbers into `snapshot` (ADR-049). */
export const reports = pgTable(
  'reports',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    scheduleId: uuid('schedule_id').references(() => reportSchedules.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    locale: text('locale').notNull().default('ar'),
    status: text('status').notNull().default('draft'),
    snapshot: jsonb('snapshot').$type<ReportSnapshot>(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('reports_client_idx').on(t.clientId, t.status, t.periodEnd),
    index('reports_campaign_idx').on(t.campaignId),
    check('reports_status_check', sql`${t.status} in ('draft','published')`),
    check('reports_locale_check', sql`${t.locale} in ('ar','en')`),
    check('reports_period_check', sql`${t.periodEnd} >= ${t.periodStart}`),
    check('reports_title_check', sql`char_length(${t.title}) between 1 and 200`),
    check('reports_published_check', sql`(${t.status} = 'published') = (${t.snapshot} is not null and ${t.publishedAt} is not null)`),
  ],
);

export const reportSections = pgTable(
  'report_sections',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    config: jsonb('config').$type<ReportSectionConfig>().notNull().default({}),
    body: text('body').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('report_sections_report_idx').on(t.reportId, t.sortOrder),
    check(
      'report_sections_kind_check',
      sql`${t.kind} in ('kpi_summary','trend','channel_breakdown','top_creatives','commentary','next_steps')`,
    ),
    check('report_sections_body_check', sql`char_length(${t.body}) <= 10000`),
  ],
);
