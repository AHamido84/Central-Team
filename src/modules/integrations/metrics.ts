import type { DailyMetric } from '@/modules/integrations/providers/types';

/** A `metrics_daily` row's numbers (money in minor units). */
export type ChannelDay = {
  impressions: number;
  reach: number;
  clicks: number;
  spendMinor: number;
  conversions: number;
  leads: number;
  videoViews: number;
  engagements: number;
  revenueMinor: number;
};

export const emptyDay = (): ChannelDay => ({
  impressions: 0,
  reach: 0,
  clicks: 0,
  spendMinor: 0,
  conversions: 0,
  leads: 0,
  videoViews: 0,
  engagements: 0,
  revenueMinor: 0,
});

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Platform rows → one row per (channel, day) (ADR-069). Several platform campaigns may feed one channel and are
 * summed; money is converted to minor units once, after summing, so rounding doesn't drift. Every day of `days` gets
 * a row for every channel (zeros when the platform reported nothing), so a re-sync also corrects days that the
 * platform restated to zero — the same input always produces the same output.
 */
export function aggregateToChannels(
  rows: readonly DailyMetric[],
  channelByCampaign: ReadonlyMap<string, string>,
  channelDays: ReadonlyMap<string, readonly string[]>,
): Map<string, Map<string, ChannelDay>> {
  const money = new Map<string, { spend: number; revenue: number }>();
  const out = new Map<string, Map<string, ChannelDay>>();
  for (const [channelId, days] of channelDays) {
    const perDay = new Map<string, ChannelDay>();
    for (const day of days) perDay.set(day, emptyDay());
    out.set(channelId, perDay);
  }
  for (const r of rows) {
    const channelId = channelByCampaign.get(r.externalCampaignId);
    const day = channelId ? out.get(channelId)?.get(r.date) : undefined;
    if (!channelId || !day) continue;
    day.impressions += Math.round(r.impressions);
    day.reach += Math.round(r.reach);
    day.clicks += Math.round(r.clicks);
    day.conversions += Math.round(r.conversions);
    day.leads += Math.round(r.leads);
    day.videoViews += Math.round(r.videoViews);
    day.engagements += Math.round(r.engagements);
    const key = `${channelId}|${r.date}`;
    const m = money.get(key) ?? { spend: 0, revenue: 0 };
    m.spend += r.spend;
    m.revenue += r.revenue;
    money.set(key, m);
  }
  for (const [key, m] of money) {
    const [channelId, date] = key.split('|') as [string, string];
    const day = out.get(channelId)!.get(date)!;
    day.spendMinor = Math.round(m.spend * 100);
    day.revenueMinor = Math.round(m.revenue * 100);
  }
  return out;
}

/** Days of `from..to` that fall inside a campaign's flight. */
export function flightDays(from: string, to: string, start: string, end: string): string[] {
  const a = from > start ? from : start;
  const b = to < end ? to : end;
  return a <= b ? eachDay(a, b) : [];
}
