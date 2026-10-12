/**
 * The Executive Center's KPIs (FR7). Names, definitions, formulas and sources are in `messages/*\/executive.json`
 * (`kpi.<key>.*`) and in `docs/KPIS.md`; this file holds what code needs: unit, which direction is good, the target
 * it is measured against and where a click drills down to.
 */
import type { ExecutiveTab, TargetMetric } from '@/modules/executive/types';

export type KpiUnit = 'count' | 'decimal' | 'currency' | 'percent' | 'days' | 'hours' | 'ratio';

export type KpiDef = {
  unit: KpiUnit;
  /** Which change is good news. */
  direction: 'up' | 'down' | 'neutral';
  /** Flow metrics add up over a period (and get a pro-rated projection); state metrics are a value on a day. */
  kind: 'flow' | 'state' | 'rate';
  target?: { metric: TargetMetric; kind: 'rate' | 'amount' };
  /** Drill-down: an existing list, filtered (query string added by the Center). */
  href?: string;
};

export const kpis = {
  // Clients & revenue
  active_clients: { unit: 'count', direction: 'up', kind: 'state', href: '/clients' },
  new_clients: { unit: 'count', direction: 'up', kind: 'flow', target: { metric: 'new_clients', kind: 'amount' }, href: '/clients' },
  churned_clients: { unit: 'count', direction: 'down', kind: 'flow', href: '/clients' },
  revenue: { unit: 'currency', direction: 'up', kind: 'flow', target: { metric: 'revenue', kind: 'amount' }, href: '/clients' },
  retention_rate: { unit: 'percent', direction: 'up', kind: 'rate', href: '/clients' },
  top5_share: { unit: 'percent', direction: 'down', kind: 'rate', href: '/clients' },
  revenue_per_hour: { unit: 'currency', direction: 'up', kind: 'rate', href: '/clients' },
  clv: { unit: 'currency', direction: 'up', kind: 'state', href: '/clients' },
  extra_requests: { unit: 'count', direction: 'neutral', kind: 'flow', href: '/requests' },
  avg_health: { unit: 'count', direction: 'up', kind: 'state', href: '/dashboard' },
  // Operations & delivery
  requests_submitted: { unit: 'count', direction: 'neutral', kind: 'flow', href: '/requests' },
  requests_delivered: { unit: 'count', direction: 'up', kind: 'flow', href: '/requests' },
  turnaround_median: { unit: 'days', direction: 'down', kind: 'rate', href: '/requests' },
  turnaround_p90: { unit: 'days', direction: 'down', kind: 'rate', href: '/requests' },
  on_time_rate: { unit: 'percent', direction: 'up', kind: 'rate', target: { metric: 'on_time_rate', kind: 'rate' }, href: '/sla' },
  sla_compliance: { unit: 'percent', direction: 'up', kind: 'rate', target: { metric: 'sla_compliance', kind: 'rate' }, href: '/sla' },
  revision_rounds: { unit: 'decimal', direction: 'down', kind: 'rate', href: '/deliverables' },
  first_time_approval: { unit: 'percent', direction: 'up', kind: 'rate', href: '/deliverables' },
  approval_wait: { unit: 'days', direction: 'down', kind: 'rate', href: '/deliverables' },
  backlog_open: { unit: 'count', direction: 'down', kind: 'state', href: '/requests' },
  backlog_aged: { unit: 'count', direction: 'down', kind: 'state', href: '/requests' },
  // Team & capacity
  utilization: { unit: 'percent', direction: 'neutral', kind: 'rate', target: { metric: 'utilization', kind: 'rate' }, href: '/team' },
  tasks_done: { unit: 'count', direction: 'up', kind: 'flow', href: '/tasks' },
  task_on_time_rate: { unit: 'percent', direction: 'up', kind: 'rate', href: '/tasks' },
  overloaded_departments: { unit: 'count', direction: 'down', kind: 'state', href: '/capacity' },
  // Marketing
  ad_spend: { unit: 'currency', direction: 'neutral', kind: 'flow', href: '/campaigns' },
  conversions: { unit: 'count', direction: 'up', kind: 'flow', href: '/campaigns' },
  cpa: { unit: 'currency', direction: 'down', kind: 'rate', href: '/campaigns' },
  cpl: { unit: 'currency', direction: 'down', kind: 'rate', href: '/campaigns' },
  roas: { unit: 'ratio', direction: 'up', kind: 'rate', target: { metric: 'roas', kind: 'rate' }, href: '/campaigns' },
  ctr: { unit: 'percent', direction: 'up', kind: 'rate', href: '/campaigns' },
  campaigns_at_risk: { unit: 'count', direction: 'down', kind: 'state', href: '/campaigns' },
  // Sales
  leads_new: { unit: 'count', direction: 'up', kind: 'flow', href: '/crm/leads' },
  win_rate: { unit: 'percent', direction: 'up', kind: 'rate', target: { metric: 'win_rate', kind: 'rate' }, href: '/crm/dashboard' },
  sales_cycle: { unit: 'days', direction: 'down', kind: 'rate', href: '/crm/dashboard' },
  avg_deal_size: { unit: 'currency', direction: 'up', kind: 'rate', href: '/crm/dashboard' },
  bookings: { unit: 'currency', direction: 'up', kind: 'flow', href: '/crm/pipeline' },
  pipeline_value: { unit: 'currency', direction: 'up', kind: 'state', href: '/crm/pipeline' },
  weighted_forecast: { unit: 'currency', direction: 'up', kind: 'state', href: '/crm/dashboard' },
  lead_response: { unit: 'hours', direction: 'down', kind: 'rate', href: '/crm/leads' },
  // Risks
  open_risks: { unit: 'count', direction: 'down', kind: 'state' },
} as const satisfies Record<string, KpiDef>;

export type KpiKey = keyof typeof kpis;
export const kpiKeys = Object.keys(kpis) as KpiKey[];

/** Tiles per tab, in reading order (the Overview's top line first). */
export const tabKpis: Record<ExecutiveTab, KpiKey[]> = {
  overview: [
    'active_clients',
    'new_clients',
    'churned_clients',
    'revenue',
    'pipeline_value',
    'weighted_forecast',
    'requests_delivered',
    'on_time_rate',
    'sla_compliance',
    'avg_health',
    'utilization',
    'ad_spend',
    'roas',
    'cpa',
  ],
  clients: [
    'revenue',
    'active_clients',
    'new_clients',
    'churned_clients',
    'retention_rate',
    'top5_share',
    'revenue_per_hour',
    'clv',
    'extra_requests',
  ],
  operations: [
    'requests_submitted',
    'requests_delivered',
    'turnaround_median',
    'turnaround_p90',
    'on_time_rate',
    'sla_compliance',
    'revision_rounds',
    'first_time_approval',
    'approval_wait',
    'backlog_open',
    'backlog_aged',
  ],
  team: ['utilization', 'tasks_done', 'task_on_time_rate', 'overloaded_departments'],
  marketing: ['ad_spend', 'conversions', 'cpa', 'cpl', 'roas', 'ctr', 'campaigns_at_risk'],
  sales: ['leads_new', 'win_rate', 'sales_cycle', 'avg_deal_size', 'bookings', 'pipeline_value', 'weighted_forecast', 'lead_response'],
  risks: ['open_risks'],
};

/** A single client can't carry more than this share of revenue without being a concentration risk. */
export const CONCENTRATION_LIMIT = 0.3;
/** Open requests older than this many days count as aged backlog. */
export const BACKLOG_AGED_DAYS = 14;
/** AI token use at or above this share of the monthly budget is a risk. */
export const AI_BUDGET_WARN = 0.8;
/** Integration tokens expiring within this many days are a risk. */
export const TOKEN_EXPIRY_DAYS = 14;
