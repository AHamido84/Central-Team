/**
 * Phase 8 pure logic: detectors (anomalies, minimum volume, partial days, pacing, delivery), recommendations and their
 * impact math, redaction, prompts and citation validation, the mock provider's determinism and language, and the
 * mock embedder's similarity.
 */
import { describe, expect, it } from 'vitest';

import { redact } from '@/modules/ai/indexer-core';
import { insightBody, insightTitle, recommendationBody, recommendationTitle } from '@/modules/ai/insight-text';
import {
  channelStats,
  detectInsights,
  isHistoric,
  median,
  recommend,
  robustZ,
  shiftBudget,
  type DetectionInput,
} from '@/modules/ai/insights-core';
import { textKit } from '@/modules/ai/kit';
import { assistantPrompt, insightPrompt, reportFacts, reportPrompt, resolveCitations } from '@/modules/ai/prompts';
import { composeMock, firstSentence, mockCompleter } from '@/modules/ai/providers/mock';
import { cosine, mockEmbed, normalizeToken, tokenize } from '@/modules/ai/providers/mock-embedder';
import { addDays, emptyTotals, type MetricRow } from '@/modules/campaigns/metrics';
import type { ReportSnapshot } from '@/modules/campaigns/report-types';

const TODAY = '2026-09-30';
/** Drops the bidi isolates wrapped around names. */
const plain = (s: string) => s.replace(/[\u2068\u2069]/g, '');

/** 20 steady days per channel before today (spend 1000 SAR, 100 leads-ish), with overrides per (channel, date). */
function rows(channels: string[], overrides: Record<string, Partial<MetricRow>> = {}, days = 20): MetricRow[] {
  const out: MetricRow[] = [];
  for (const ch of channels) {
    for (let i = days; i >= 1; i--) {
      const date = addDays(TODAY, -i);
      const jitter = (i % 3) - 1; // −1, 0, 1: a little noise so MAD > 0
      out.push({
        ...emptyTotals(),
        channelId: ch,
        date,
        impressions: 50_000 + jitter * 500,
        reach: 30_000,
        clicks: 800 + jitter * 10,
        spend: 100_000 + jitter * 1_000,
        leads: 40 + jitter,
        conversions: 20,
        ...overrides[`${ch}:${date}`],
      });
    }
  }
  return out;
}

function input(over: Partial<DetectionInput> = {}): DetectionInput {
  return {
    campaign: {
      id: 'camp',
      status: 'active',
      currency: 'SAR',
      startDate: addDays(TODAY, -30),
      endDate: addDays(TODAY, 30),
      budgetMinor: 0,
      kpis: [],
    },
    channels: [{ id: 'meta', platform: 'meta', name: '' }],
    rows: rows(['meta']),
    today: TODAY,
    sensitivity: 'normal',
    ...over,
  };
}

const yesterday = addDays(TODAY, -1);

describe('robust statistics', () => {
  it('median and robust z', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
    const { z, baseline } = robustZ(20, [10, 11, 9, 10, 10, 11, 9]);
    expect(baseline).toBe(10);
    expect(z).toBeGreaterThan(6);
  });

  it('a flat history still flags a real jump without dividing by zero', () => {
    const { z } = robustZ(15, [10, 10, 10, 10, 10, 10, 10]);
    expect(Number.isFinite(z)).toBe(true);
    expect(z).toBe(5);
  });
});

describe('anomaly detector', () => {
  it('steady numbers produce nothing', () => {
    expect(detectInsights(input())).toEqual([]);
  });

  it('a collapse in leads yesterday → leads drop (warning) and CPL spike (bad direction), keyed by day', () => {
    const found = detectInsights(input({ rows: rows(['meta'], { [`meta:${yesterday}`]: { leads: 6 } }) }));
    const drop = found.find((f) => f.kind === 'drop' && f.metric === 'leads')!;
    const spike = found.find((f) => f.kind === 'spike' && f.metric === 'cpl')!;
    expect(drop.severity).not.toBe('info');
    expect(spike.severity).not.toBe('info');
    expect(drop.dedupeKey).toBe(`camp:meta:drop:leads:${yesterday}`);
    expect(drop.facts).toMatchObject({ value: 6, baseline: 40, windowDays: 14, date: yesterday, format: 'count' });
    expect(drop.facts.change).toBeCloseTo(-0.85, 2);
  });

  it('good-direction moves are info (more leads, cheaper clicks)', () => {
    const found = detectInsights(input({ rows: rows(['meta'], { [`meta:${yesterday}`]: { leads: 120 } }) }));
    const spike = found.find((f) => f.kind === 'spike' && f.metric === 'leads')!;
    expect(spike.severity).toBe('info');
    expect(found.find((f) => f.metric === 'cpl')?.severity).toBe('info');
  });

  it('twice the threshold is critical; sensitivity changes what is flagged', () => {
    const r = rows(['meta'], { [`meta:${yesterday}`]: { leads: 2 } });
    expect(detectInsights(input({ rows: r })).find((f) => f.metric === 'leads')?.severity).toBe('critical');
    const mild = rows(['meta'], { [`meta:${yesterday}`]: { leads: 37 } });
    expect(detectInsights(input({ rows: mild, sensitivity: 'high' })).some((f) => f.metric === 'leads')).toBe(false);
  });

  it("today's partial numbers are ignored", () => {
    const r = [
      ...rows(['meta']),
      { ...emptyTotals(), channelId: 'meta', date: TODAY, spend: 5_000, clicks: 30, leads: 1, impressions: 2_000 },
    ];
    expect(detectInsights(input({ rows: r })).filter((f) => f.kind === 'spike' || f.kind === 'drop')).toEqual([]);
  });

  it('needs a week of history and a minimum volume', () => {
    const short = rows(['meta'], { [`meta:${yesterday}`]: { leads: 2 } }, 5);
    expect(detectInsights(input({ rows: short })).filter((f) => f.kind === 'drop')).toEqual([]);
    const tiny = rows(['meta'], { [`meta:${yesterday}`]: { leads: 0 } }).map((r) => (r.date === yesterday ? r : { ...r, leads: 1 }));
    expect(detectInsights(input({ rows: tiny })).some((f) => f.metric === 'leads')).toBe(false);
  });

  it('stale data (older than the recent window) is not analysed', () => {
    const old = rows(['meta']).map((r) => ({ ...r, date: addDays(r.date, -10) }));
    expect(detectInsights(input({ rows: old })).filter((f) => f.kind === 'drop' || f.kind === 'spike')).toEqual([]);
  });

  it('campaign-level anomalies only with more than one channel', () => {
    const two = input({
      channels: [
        { id: 'meta', platform: 'meta', name: '' },
        { id: 'snap', platform: 'snapchat', name: 'Snap' },
      ],
      rows: rows(['meta', 'snap'], { [`meta:${yesterday}`]: { leads: 2 }, [`snap:${yesterday}`]: { leads: 2 } }),
    });
    const keys = detectInsights(two).map((f) => f.dedupeKey);
    expect(keys.some((k) => k.startsWith('camp:all:drop:leads'))).toBe(true);
    expect(keys.some((k) => k.startsWith('camp:snap:drop:leads'))).toBe(true);
  });

  it('anomalies become history after 14 days; pacing insights never do', () => {
    expect(isHistoric('drop', addDays(TODAY, -15), TODAY)).toBe(true);
    expect(isHistoric('drop', addDays(TODAY, -3), TODAY)).toBe(false);
    expect(isHistoric('kpi_off_track', addDays(TODAY, -40), TODAY)).toBe(false);
  });
});

describe('delivery and pacing detectors', () => {
  it('a channel that stopped spending on the last two days with data', () => {
    const two = [
      { id: 'meta', platform: 'meta', name: '' },
      { id: 'snap', platform: 'snapchat', name: 'Snap' },
    ];
    const r = rows(['meta', 'snap'], { [`snap:${yesterday}`]: { spend: 0 }, [`snap:${addDays(TODAY, -2)}`]: { spend: 0 } });
    const stopped = detectInsights(input({ channels: two, rows: r })).find((f) => f.kind === 'delivery_stopped')!;
    expect(stopped).toMatchObject({ channelId: 'snap', dedupeKey: 'camp:snap:delivery_stopped', severity: 'warning' });
    expect(stopped.facts.lastSpendDate).toBe(addDays(TODAY, -3));
    expect(
      detectInsights(input({ channels: two, rows: r, campaign: { ...input().campaign, status: 'paused' } })).some(
        (f) => f.kind === 'delivery_stopped',
      ),
    ).toBe(false);
  });

  it('KPI off track and budget over-pace from the campaign analysis', () => {
    const campaign = {
      ...input().campaign,
      startDate: addDays(TODAY, -20),
      endDate: addDays(TODAY, 19),
      budgetMinor: 2_000_000,
      kpis: [{ metric: 'leads' as const, target: 10_000, channelId: null }],
    };
    const found = detectInsights(input({ campaign }));
    const kpi = found.find((f) => f.kind === 'kpi_off_track')!;
    expect(kpi).toMatchObject({ metric: 'leads', dedupeKey: 'camp:all:kpi:leads', severity: 'critical' });
    expect(kpi.facts.target).toBe(10_000);
    const budget = found.find((f) => f.dedupeKey === 'camp:all:budget')!;
    // 2,000,000 spent of a 2,000,000 budget at half the flight → overspent pace.
    expect(['budget_overpace', 'budget_overspent']).toContain(budget.kind);
  });

  it('under-pace once 20 % of the flight has data', () => {
    const campaign = { ...input().campaign, startDate: addDays(TODAY, -20), endDate: addDays(TODAY, 19), budgetMinor: 20_000_000 };
    const budget = detectInsights(input({ campaign })).find((f) => f.dedupeKey === 'camp:all:budget')!;
    expect(budget.kind).toBe('budget_underpace');
    expect(budget.facts.remainingDays).toBeGreaterThan(0);
  });
});

describe('recommendations', () => {
  const channels = [
    { id: 'meta', platform: 'meta', name: '' },
    { id: 'snap', platform: 'snapchat', name: 'Snap' },
  ];
  // Meta: 100,000/day for 40 leads (CPL 2,500); Snap: same spend for 80 leads (CPL 1,250).
  const r = rows(['meta', 'snap']).map((x) => (x.channelId === 'snap' ? { ...x, leads: 80 } : x));
  const ctx = { currency: 'SAR', channels: channelStats(channels, r, TODAY) };

  it('shift budget to a channel whose cost per result is ≥ 25 % lower, with the expected gain', () => {
    const shift = shiftBudget('cpl', 'meta', ctx)!;
    expect(shift.facts).toMatchObject({
      fromChannelId: 'meta',
      toChannelId: 'snap',
      toChannel: 'Snap',
      fromPlatform: 'meta',
      amountMinor: 20_000,
    });
    // 20,000 / 1,250 − 20,000 / 2,500 = 16 − 8 = 8 more leads a day.
    expect(shift.facts.expectedDelta).toBeCloseTo(8, 0);
    expect(shiftBudget('cpl', 'snap', ctx)).toBeNull();
  });

  it('maps findings to next steps', () => {
    const base = { channelId: 'meta', facts: { currency: 'SAR', format: 'money' as const } };
    expect(recommend({ ...base, kind: 'spike', metric: 'cpl', severity: 'warning' }, ctx).map((x) => x.kind)).toEqual([
      'shift_budget',
      'review_targeting',
    ]);
    expect(recommend({ ...base, kind: 'drop', metric: 'ctr', severity: 'warning' }, ctx).map((x) => x.kind)).toEqual(['refresh_creative']);
    expect(recommend({ ...base, kind: 'drop', metric: 'leads', severity: 'critical' }, ctx).map((x) => x.kind)).toEqual(['check_tracking']);
    expect(recommend({ ...base, kind: 'delivery_stopped', metric: 'spend', severity: 'warning' }, ctx).map((x) => x.kind)).toEqual([
      'resume_delivery',
    ]);
    expect(recommend({ ...base, kind: 'spike', metric: 'leads', severity: 'info' }, ctx)).toEqual([]);
  });

  it('budget pacing: the daily budget that lands on the total', () => {
    const facts = { currency: 'SAR', format: 'money' as const, budgetMinor: 1_000_000, spentMinor: 400_000, remainingDays: 10 };
    const [under] = recommend({ kind: 'budget_underpace', metric: 'spend', channelId: null, severity: 'warning', facts }, ctx);
    expect(under).toEqual({ kind: 'increase_budget', facts: { currency: 'SAR', dailyBudgetMinor: 60_000 } });
    const [over] = recommend({ kind: 'budget_overpace', metric: 'spend', channelId: null, severity: 'warning', facts }, ctx);
    expect(over!.kind).toBe('reduce_budget');
  });
});

describe('insight text (AR / EN)', () => {
  const insight = {
    kind: 'spike',
    metric: 'cpl',
    facts: {
      currency: 'SAR',
      format: 'money' as const,
      platform: 'meta',
      channelName: null,
      date: '2026-09-29',
      value: 5000,
      baseline: 2500,
      change: 1,
      windowDays: 14,
    },
  };
  it('renders titles and bodies from facts in both languages', () => {
    const en = textKit('en');
    expect(plain(insightTitle(en, insight))).toBe('Cost per lead jumped 100% on Meta');
    expect(insightBody(en, insight)).toMatch(/was SAR\s?50.*typical SAR\s?25.*14 days/);
    const ar = textKit('ar');
    expect(plain(insightTitle(ar, insight))).toBe('ارتفاع في تكلفة العميل المحتمل بنسبة 100٪ في ميتا');
  });
  it('recommendations name the channel by custom name, else the platform', () => {
    const en = textKit('en');
    const rec = {
      kind: 'shift_budget',
      facts: {
        currency: 'SAR',
        toChannel: '',
        toPlatform: 'snapchat',
        fromChannel: 'Meta — Riyadh',
        amountMinor: 20_000,
        fromCost: 2500,
        toCost: 1250,
        expectedDelta: 8,
      },
    };
    expect(plain(recommendationTitle(en, rec))).toBe('Move budget to Snapchat');
    expect(recommendationBody(en, rec)).toContain('Meta — Riyadh');
    expect(recommendationBody(en, rec)).toContain('8 more results');
  });
});

describe('redaction (ADR-076)', () => {
  it('removes e-mails and phone numbers but keeps dates, money and short numbers', () => {
    const text = 'Call +966 55 123 4567 or 0551234567, mail reem@example.sa. Flight 2026-09-01 → 2026-10-31, spend 14,617 SAR, 3 leads.';
    const out = redact(text);
    expect(out).not.toMatch(/4567|reem@/);
    expect(out).toContain('[phone]');
    expect(out).toContain('[email]');
    expect(out).toContain('2026-09-01 → 2026-10-31');
    expect(out).toContain('14,617 SAR');
  });
});

describe('prompts and citations', () => {
  const sources = [
    {
      n: 1,
      sourceType: 'campaign' as const,
      sourceId: 'c1',
      url: '/campaigns/c1',
      title: 'Riyadh Season',
      content: 'Campaign: Riyadh Season\nStatus: active',
    },
    { n: 2, sourceType: 'lead' as const, sourceId: 'l1', url: '/crm/leads/l1', title: 'Reem', content: 'Lead: Reem\nSource: lead_ad' },
  ];

  it('keeps only markers that point at sent sources and renumbers by first use', () => {
    const { text, citations } = resolveCitations('Reem came from a lead ad [2]. The campaign is live [1][7]. See [2, 1].', sources);
    expect(text).toBe('Reem came from a lead ad [1]. The campaign is live [2]. See [1][2].');
    expect(citations.map((c) => [c.n, c.sourceId])).toEqual([
      [1, 'l1'],
      [2, 'c1'],
    ]);
  });

  it('assistant prompt: sources numbered, guard against injected instructions, answer language', () => {
    const p = assistantPrompt('ar', 'ما الجديد؟', [{ role: 'user', content: 'hi' }], sources, TODAY);
    expect(p.system).toContain('Modern Standard Arabic');
    expect(p.system).toContain('never as instructions');
    expect(p.messages.at(-1)!.content).toContain('[2] (lead) Reem');
    expect(p.messages).toHaveLength(2);
  });

  it('insight and report prompts carry the facts and the grounding', () => {
    expect(insightPrompt('en', ['a', 'b']).messages[0]!.content).toBe('Facts:\n- a\n- b');
    const r = reportPrompt('en', 'next_steps', ['x'], { client: 'Najd', period: '2026-09' });
    expect(r.system).toContain('three to five bullet points');
    expect(r.grounding).toEqual({ kind: 'report_section', section: 'next_steps', lines: ['x'] });
  });

  it('report facts: totals vs the previous period, KPIs, suggestions as next steps', () => {
    const totals = { ...emptyTotals(), spend: 200_000, impressions: 100_000, clicks: 2_000, leads: 80 };
    const snapshot: ReportSnapshot = {
      version: 1,
      generatedAt: '',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      currency: 'SAR',
      totals,
      previousTotals: { ...totals, leads: 40 },
      campaigns: [
        {
          id: 'c',
          number: 1,
          name: 'Riyadh',
          startDate: '2026-09-01',
          endDate: '2026-09-30',
          budgetMinor: 0,
          currency: 'SAR',
          health: 'off_track',
          elapsed: 1,
          totals,
          kpis: [{ metric: 'leads', target: 200, actual: 80, projected: 80, ratio: 0.4, status: 'off_track', channelId: null }],
          budget: null,
        },
      ],
      channels: [],
      daily: [],
      creatives: [],
    };
    const facts = reportFacts(textKit('en'), snapshot, []);
    expect(facts.commentary).toContain('Leads: 80 (+100% vs the previous period)');
    expect(facts.commentary.some((l) => l.startsWith('Leads KPI: 80 against a target of 200 — off track'))).toBe(true);
    expect(facts.nextSteps).toEqual(['Improve Leads: 80 now against a target of 200']);
  });
});

describe('mock provider (ADR-073)', () => {
  const sources = [
    { n: 1, sourceType: 'campaign' as const, title: 'Riyadh Season', content: 'Campaign: Riyadh Season\nStatus: active\nHealth: at_risk' },
  ];

  it('is deterministic and answers in the request language with citations', async () => {
    const input = assistantPrompt('en', 'How is Riyadh Season doing?', [], sources, TODAY);
    const a = await mockCompleter.complete(input);
    const b = await mockCompleter.complete(input);
    expect(a.text).toBe(b.text);
    expect(a.text).toContain('Riyadh Season: Status: active · Health: at_risk [1]');
    expect(a.text).toMatch(/^Here is what I found in 1 record/);
    expect(composeMock({ ...input, locale: 'ar' })).toMatch(/^هذا ما وجدته/);
    expect(a.usage.input).toBeGreaterThan(0);
  });

  it('writes report sections from fact lines', () => {
    const base = { purpose: 'report_draft' as const, locale: 'en' as const, system: '', messages: [] };
    expect(composeMock({ ...base, grounding: { kind: 'report_section', section: 'next_steps', lines: ['Do A', 'Do B'] } })).toBe(
      'Suggested next steps:\n- Do A\n- Do B',
    );
  });

  it('firstSentence trims long snippets', () => {
    expect(firstSentence('One. Two.')).toBe('One.');
    expect(firstSentence('x'.repeat(300)).length).toBeLessThanOrEqual(181);
  });
});

describe('mock embedder', () => {
  it('normalizes Arabic spelling variants', () => {
    expect(normalizeToken('الحملة')).toBe(normalizeToken('حمله'));
    expect(normalizeToken('إطلاق')).toBe('اطلاق');
    expect(tokenize('ما هي الحملات؟ the campaign')).toEqual(['حملات', 'campaign']);
  });

  it('unit vectors; related text is closer than unrelated text', () => {
    const q = mockEmbed('حملة عروض تقويم الأسنان');
    const norm = Math.sqrt(q.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
    const related = mockEmbed('حملة: عروض تقويم الأسنان\nالحالة: active');
    const unrelated = mockEmbed('مهمة: تصوير منتجات جديدة');
    expect(cosine(q, related)).toBeGreaterThan(cosine(q, unrelated) + 0.2);
    expect(mockEmbed('')).toHaveLength(1024);
  });
});
