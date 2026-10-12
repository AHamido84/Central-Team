/** Shared types of the Executive Intelligence Center (FR7, ADR-096). No runtime code: safe for client and server. */

export const executiveTabs = ['overview', 'clients', 'operations', 'team', 'marketing', 'sales', 'risks'] as const;
export type ExecutiveTab = (typeof executiveTabs)[number];

export const periodPresets = ['this_month', 'last_month', 'qtd', 'ytd', 'last_12m', 'custom'] as const;
export type PeriodPreset = (typeof periodPresets)[number];

export const comparisons = ['previous', 'last_year', 'none'] as const;
export type Comparison = (typeof comparisons)[number];

export type ExecutiveFilters = {
  clientId?: string | null;
  departmentId?: string | null;
  accountManagerId?: string | null;
  platform?: string | null;
};

/** What a saved view, a note's context and the URL carry. */
export type ExecutiveViewConfig = {
  tab: ExecutiveTab;
  preset: PeriodPreset;
  /** ISO dates, for `custom`. */
  from?: string | null;
  to?: string | null;
  compare: Comparison;
  filters: ExecutiveFilters;
};

/** Metrics a yearly / quarterly target can be set for (Targets screen). */
export const targetMetrics = ['revenue', 'new_clients', 'on_time_rate', 'sla_compliance', 'utilization', 'win_rate', 'roas'] as const;
export type TargetMetric = (typeof targetMetrics)[number];

export type EmailAttachment = { filename: string; contentType: string; storagePath: string };
