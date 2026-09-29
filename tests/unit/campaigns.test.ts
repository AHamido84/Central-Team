import { describe, expect, it } from 'vitest';

import { detectDateOrder, detectPreset, parseDate, parseMetricsCsv, parseNumber } from '@/modules/campaigns/csv';
import {
  analyzeCampaign,
  budgetPacing,
  buildSeries,
  campaignHealth,
  elapsedShare,
  emptyTotals,
  kpiProgress,
  metricValue,
  weekStart,
  type MetricRow,
} from '@/modules/campaigns/metrics';

const totals = (over: Partial<ReturnType<typeof emptyTotals>>) => ({ ...emptyTotals(), ...over });

describe('derived metrics', () => {
  const t = totals({
    impressions: 200_000,
    reach: 80_000,
    clicks: 3_000,
    spend: 600_000,
    conversions: 60,
    leads: 120,
    engagements: 9_000,
    revenue: 2_400_000,
  });

  it('computes rates and costs from base metrics (money in halalas)', () => {
    expect(metricValue(t, 'ctr')).toBeCloseTo(0.015);
    expect(metricValue(t, 'cpc')).toBe(200); // 2.00 SAR per click
    expect(metricValue(t, 'cpm')).toBe(3_000); // 30 SAR per 1,000 impressions
    expect(metricValue(t, 'cpa')).toBe(10_000);
    expect(metricValue(t, 'cpl')).toBe(5_000);
    expect(metricValue(t, 'roas')).toBe(4);
    expect(metricValue(t, 'frequency')).toBe(2.5);
    expect(metricValue(t, 'engagement_rate')).toBeCloseTo(0.045);
  });

  it('returns null instead of dividing by zero', () => {
    expect(metricValue(emptyTotals(), 'ctr')).toBeNull();
    expect(metricValue(emptyTotals(), 'cpa')).toBeNull();
    expect(metricValue(emptyTotals(), 'impressions')).toBe(0);
  });
});

describe('pacing', () => {
  it('measures the share of the flight covered by data', () => {
    expect(elapsedShare('2026-09-01', '2026-09-30', null)).toBe(0);
    expect(elapsedShare('2026-09-01', '2026-09-30', '2026-08-31')).toBe(0);
    expect(elapsedShare('2026-09-01', '2026-09-30', '2026-09-15')).toBe(0.5);
    expect(elapsedShare('2026-09-01', '2026-09-30', '2026-10-10')).toBe(1);
  });

  it('projects volume KPIs to the end of the flight', () => {
    // Half-way through with 45 of 100 leads → projected 90 → 0.9 → at risk.
    const p = kpiProgress('leads', 100, totals({ leads: 45 }), 0.5);
    expect(p.projected).toBe(90);
    expect(p.ratio).toBeCloseTo(0.9);
    expect(p.status).toBe('at_risk');
    expect(kpiProgress('leads', 100, totals({ leads: 60 }), 0.5).status).toBe('on_track');
    expect(kpiProgress('leads', 100, totals({ leads: 30 }), 0.5).status).toBe('off_track');
  });

  it('treats cost KPIs as lower-is-better and rates as-is', () => {
    // CPL target 50 SAR; actual 40 SAR → on track; actual 70 SAR → off track.
    expect(kpiProgress('cpl', 5_000, totals({ spend: 400_000, leads: 100 }), 0.5).status).toBe('on_track');
    expect(kpiProgress('cpl', 5_000, totals({ spend: 700_000, leads: 100 }), 0.5).status).toBe('off_track');
    // CTR target 1.5 %; actual 1.4 % → 0.93 → at risk (not projected).
    expect(kpiProgress('ctr', 0.015, totals({ clicks: 140, impressions: 10_000 }), 0.2).status).toBe('at_risk');
  });

  it('has no status before any data', () => {
    expect(kpiProgress('leads', 100, emptyTotals(), 0).status).toBe('no_data');
    expect(kpiProgress('cpl', 5_000, emptyTotals(), 0.5).status).toBe('no_data');
  });

  it('flags budget over- and under-delivery', () => {
    expect(budgetPacing(0, 0, 0.5)).toBeNull();
    expect(budgetPacing(1_000_000, 500_000, 0.5)!.status).toBe('on_track');
    expect(budgetPacing(1_000_000, 700_000, 0.5)!.status).toBe('at_risk');
    expect(budgetPacing(1_000_000, 300_000, 0.5)!.status).toBe('at_risk');
    expect(budgetPacing(1_000_000, 1_100_000, 1)!.status).toBe('off_track');
  });

  it('rolls the worst status up to campaign health', () => {
    expect(campaignHealth([])).toBe('no_data');
    expect(campaignHealth(['no_data', 'on_track'])).toBe('on_track');
    expect(campaignHealth(['on_track', 'at_risk'])).toBe('at_risk');
    expect(campaignHealth(['at_risk', 'off_track', 'on_track'])).toBe('off_track');
  });
});

describe('analyzeCampaign', () => {
  const row = (date: string, channelId: string, over: Partial<ReturnType<typeof emptyTotals>>): MetricRow => ({
    date,
    channelId,
    ...totals(over),
  });
  const campaign = {
    startDate: '2026-09-01',
    endDate: '2026-09-10',
    budgetMinor: 1_000_000,
    kpis: [
      { metric: 'leads' as const, target: 100, channelId: null },
      { metric: 'clicks' as const, target: 1_000, channelId: 'tiktok' },
    ],
  };

  it('ignores days outside the flight and scopes channel KPIs', () => {
    const rows = [
      row('2026-08-31', 'meta', { leads: 999, spend: 999_999 }),
      ...['01', '02', '03', '04', '05'].flatMap((d) => [
        row(`2026-09-${d}`, 'meta', { leads: 10, spend: 60_000, clicks: 50 }),
        row(`2026-09-${d}`, 'tiktok', { leads: 2, spend: 40_000, clicks: 120 }),
      ]),
    ];
    const a = analyzeCampaign(campaign, rows);
    expect(a.through).toBe('2026-09-05');
    expect(a.elapsed).toBe(0.5);
    expect(a.totals.leads).toBe(60);
    expect(a.kpis[0]!.status).toBe('on_track'); // 60 → projected 120 vs 100
    expect(a.kpis[1]!.actual).toBe(600); // TikTok only → projected 1,200
    expect(a.budget!.status).toBe('on_track'); // 500k of an expected 500k
    expect(a.health).toBe('on_track');
  });

  it('is no_data before the first metrics', () => {
    expect(analyzeCampaign(campaign, []).health).toBe('no_data');
  });
});

describe('series', () => {
  it('starts weeks on Sunday and zero-fills', () => {
    expect(weekStart('2026-09-29')).toBe('2026-09-27'); // Tuesday → Sunday
    expect(weekStart('2026-09-27')).toBe('2026-09-27');
    const rows: MetricRow[] = [{ date: '2026-09-02', channelId: 'a', ...totals({ clicks: 5 }) }];
    const daily = buildSeries(rows, '2026-09-01', '2026-09-03', 'day');
    expect(daily.map((p) => [p.key, p.clicks])).toEqual([
      ['2026-09-01', 0],
      ['2026-09-02', 5],
      ['2026-09-03', 0],
    ]);
    expect(buildSeries(rows, '2026-09-01', '2026-09-14', 'week').map((p) => p.key)).toEqual(['2026-08-30', '2026-09-06', '2026-09-13']);
  });
});

describe('CSV values', () => {
  it('parses exported numbers in any common format', () => {
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('SAR 2,500')).toBe(2500);
    expect(parseNumber('١٬٢٣٤')).toBe(1234);
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('')).toBe(0);
    expect(parseNumber('--')).toBe(0);
    expect(parseNumber('n/a')).toBeNaN();
  });

  it('parses dates and detects day/month order', () => {
    expect(parseDate('2026-09-01', 'dmy')).toBe('2026-09-01');
    expect(parseDate('2026-09-01 00:00:00', 'dmy')).toBe('2026-09-01');
    expect(parseDate('01/09/2026', 'dmy')).toBe('2026-09-01');
    expect(parseDate('09/01/2026', 'mdy')).toBe('2026-09-01');
    expect(parseDate('Sep 1, 2026', 'dmy')).toBe('2026-09-01');
    expect(parseDate('Tue, Sep 1, 2026', 'dmy')).toBe('2026-09-01');
    expect(parseDate('٠١/٠٩/٢٠٢٦', 'dmy')).toBe('2026-09-01');
    expect(parseDate('31/02/2026', 'dmy')).toBeNull();
    expect(parseDate('Total', 'dmy')).toBeNull();
    expect(detectDateOrder(['13/09/2026', '01/09/2026'], 'meta')).toBe('dmy');
    expect(detectDateOrder(['09/13/2026'], 'meta')).toBe('mdy');
    expect(detectDateOrder(['09/01/2026'], 'google')).toBe('mdy');
    expect(detectDateOrder(['09/01/2026'], 'meta')).toBe('dmy');
  });
});

describe('CSV import', () => {
  it('detects a Meta Ads Manager export and sums ad sets per day', () => {
    const csv = [
      '﻿Reporting starts,Reporting ends,Ad set name,Amount spent (SAR),Impressions,Reach,Link clicks,Results,Leads',
      '2026-09-01,2026-09-01,Riyadh 25-34,"1,250.50",40000,21000,610,12,12',
      '2026-09-01,2026-09-01,Jeddah 25-34,749.50,20000,11000,290,6,6',
      '2026-09-02,2026-09-02,Riyadh 25-34,1100,38000,20000,570,10,10',
    ].join('\n');
    const r = parseMetricsCsv(csv);
    expect(r.preset).toBe('meta');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ date: '2026-09-01', spend: 200_000, impressions: 60_000, clicks: 900, conversions: 18, leads: 18 });
    expect(r.errors).toEqual([]);
  });

  it('handles Google Ads title rows, totals and US dates', () => {
    const csv = [
      'Campaign report',
      '"September 1, 2026 - September 30, 2026"',
      'Day,Campaign,Clicks,Impr.,Cost,Conversions,Conv. value',
      '09/01/2026,Brand,120,4000,300.00,3,1200.00',
      '09/02/2026,Brand,130,4200,310.00,4,1500.00',
      'Total: Account,,250,8200,610.00,7,2700.00',
    ].join('\n');
    const r = parseMetricsCsv(csv);
    expect(r.preset).toBe('google');
    expect(r.dateOrder).toBe('mdy');
    expect(r.rows.map((x) => x.date)).toEqual(['2026-09-01', '2026-09-02']);
    expect(r.rows[1]).toMatchObject({ clicks: 130, impressions: 4200, spend: 31_000, conversions: 4, revenue: 150_000 });
    expect(r.skipped).toBe(1);
  });

  it('detects TikTok and Snapchat exports, and semicolon files', () => {
    expect(detectPreset(['By Day', 'Cost', 'Impressions', 'Clicks (destination)', 'Conversions'])).toBe('tiktok');
    expect(detectPreset(['Start time', 'Spend', 'Paid Impressions', 'Swipe Ups'])).toBe('snapchat');
    const r = parseMetricsCsv('Date;Spend;Impressions;Clicks\n01/09/2026;"1.200,50";5000;80\n');
    expect(r.preset).toBe('custom');
    expect(r.rows[0]).toMatchObject({ date: '2026-09-01', spend: 120_050, impressions: 5000, clicks: 80 });
  });

  it('reports lines with values that are not numbers', () => {
    const r = parseMetricsCsv('Date,Impressions,Clicks\n2026-09-01,1000,abc\n');
    expect(r.errors).toEqual([{ line: 2, code: 'invalid_number' }]);
  });
});
