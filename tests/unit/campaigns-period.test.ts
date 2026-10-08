import { describe, expect, it } from 'vitest';

import { parseMetricsCsv } from '@/modules/campaigns/csv';

/** Feedback Round 6 (ADR-095): period-total exports are recognised instead of being stored on their first day. */
describe('period-total exports', () => {
  // Ads Manager → Campaigns → Export without "Breakdown → By time → Day" (one total per campaign for the range).
  const metaTotals = [
    '﻿Campaign name,Campaign delivery,Reporting starts,Reporting ends,Results,Result indicator,Reach,Impressions,Amount spent (SAR),Link clicks,Ends',
    'تقدر للقدرات - Awareness,active,2026-09-05,2026-10-04,1200,reach,90000,250000,"4,500.75",3100,Ongoing',
    'تقدر للقدرات - Leads,inactive,2026-09-05,2026-10-04,85,leads,30000,70000,"1,250.25",900,2026-10-01',
  ].join('\n');

  it('flags the file and imports nothing from it', () => {
    const r = parseMetricsCsv(metaTotals);
    expect(r.preset).toBe('meta');
    expect(r.rows).toEqual([]);
    expect(r.period).toMatchObject({ from: '2026-09-05', to: '2026-10-04', rows: 2 });
    expect(r.period!.totals.spend).toBe(575100);
    expect(r.period!.totals.impressions).toBe(320000);
  });

  it('keeps importing daily exports, where every row starts and ends on the same day', () => {
    const daily = [
      'Reporting starts,Reporting ends,Campaign name,Amount spent (SAR),Impressions,Link clicks',
      '2026-10-04,2026-10-04,A,100,1000,10',
      '2026-10-05,2026-10-05,A,200,2000,20',
    ].join('\n');
    const r = parseMetricsCsv(daily);
    expect(r.period).toBeNull();
    expect(r.rows.map((x) => x.date)).toEqual(['2026-10-04', '2026-10-05']);
    expect(r.rows[1]!.spend).toBe(20000);
  });

  it('does not take a campaign "Ends" column for the period end', () => {
    const r = parseMetricsCsv('Day,Impressions,Clicks,Ends\n2026-10-04,1000,10,2026-12-31\n');
    expect(r.period).toBeNull();
    expect(r.rows).toHaveLength(1);
  });

  it('recognises Snapchat start / end times spanning several days', () => {
    const r = parseMetricsCsv(
      'Start Time,End Time,Paid Impressions,Swipe Ups,Spend\n2026-09-01 00:00:00,2026-09-30 23:59:59,5000,40,300\n',
    );
    expect(r.rows).toEqual([]);
    expect(r.period).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
  });
});
