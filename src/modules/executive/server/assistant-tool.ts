import 'server-only';

import type { AgencyContext } from '@/lib/auth/context';
import type { Locale } from '@/lib/i18n/localized';
import { toolInputs } from '@/modules/ai/assistant-tools';
import type { AiToolCall, AiToolResult } from '@/modules/ai/providers/types';
import type { SourceRegistry } from '@/modules/ai/server/assistant-tools';
import { tabKpis } from '@/modules/executive/catalog';
import { viewSearch } from '@/modules/executive/config';
import { executiveKit } from '@/modules/executive/kit';
import { getExecutiveReport } from '@/modules/executive/server/data';
import { formatDelta, formatKpi, riskText } from '@/modules/executive/text';
import type { ExecutiveViewConfig } from '@/modules/executive/types';

/**
 * The assistant's `executive_kpis` tool (FR7): the Executive Center's numbers for a period, read as the asking
 * executive (the same loader and RLS as the screen). Each KPI is a numbered source linking back to the Center, so
 * the answer's `[n]` opens the exact view. Runs outside the tools' transaction: the report opens its own.
 */
export async function runExecutiveTool(
  ctx: AgencyContext,
  locale: Locale,
  call: AiToolCall,
  sources: SourceRegistry,
): Promise<AiToolResult> {
  const parsed = toolInputs.executive_kpis.safeParse(call.input ?? {});
  if (!parsed.success) return { toolUseId: call.id, content: 'Invalid input.', isError: true };
  const input = parsed.data;
  const config: ExecutiveViewConfig = { tab: input.area, preset: input.period, compare: input.compare, filters: {} };
  const report = await getExecutiveReport(ctx, config);
  const kit = executiveKit(locale, ctx.organization.defaultTimezone);
  const { t, f } = kit;
  const url = `/executive${viewSearch(config)}`;
  const lines: string[] = [
    `Period: ${report.period.from} – ${report.period.to}${report.period.incomplete ? ` (in progress, day ${report.period.elapsedDays} of ${report.period.totalDays})` : ''}`,
    report.comparison ? `Compared with: ${report.comparison.from} – ${report.comparison.to}` : 'No comparison',
  ];
  const keys = [...new Set([...tabKpis.overview, ...tabKpis[input.area]])];
  for (const key of keys) {
    const v = report.kpis[key];
    const name = t(`kpi.${key}.name`);
    const parts = [
      `${name}: ${formatKpi(kit, key, v.value)}`,
      formatDelta(kit, key, v.delta),
      v.previous !== null ? `${t('tile.previous', { value: formatKpi(kit, key, v.previous) })}` : null,
      v.target !== null
        ? `${t('tile.target', { value: formatKpi(kit, key, v.target) })}${v.progress !== null ? ` (${f.percent(v.progress)})` : ''}`
        : null,
      v.small && v.sample !== null ? t('tile.small', { count: v.sample }) : null,
    ].filter(Boolean);
    const s = sources.add({
      sourceType: 'kpi',
      sourceId: `${key}:${input.period}:${input.compare}`,
      title: name,
      url,
      content: parts.join(' · '),
    });
    if (s) lines.push(`[${s.n}] ${parts.join(' · ')}`);
  }
  const risks = report.risks.items.slice(0, 8);
  if (risks.length) {
    const s = sources.add({
      sourceType: 'kpi',
      sourceId: `risks:${input.period}`,
      title: t('charts.riskRegister'),
      url: `/executive${viewSearch(config, { tab: 'risks' })}`,
      content: risks.map((r) => `${t(`severity.${r.severity}`)}: ${riskText(kit, r)}`).join('\n'),
    });
    if (s)
      lines.push(
        `[${s.n}] ${t('charts.riskRegister')}:\n${risks.map((r) => `- ${t(`severity.${r.severity}`)}: ${riskText(kit, r)}`).join('\n')}`,
      );
  }
  return { toolUseId: call.id, content: lines.join('\n') };
}
