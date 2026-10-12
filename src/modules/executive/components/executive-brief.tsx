'use client';

import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { briefLines, type BriefCitation } from '@/modules/executive/brief';
import type { ExecutiveReport } from '@/modules/executive/compute';
import { writeBriefAction } from '@/modules/executive/server/actions';
import type { ExecKit } from '@/modules/executive/text';

/** Text with `[n]` markers turned into small links to the cited KPI's screen. */
function Cited({ text, citations, kit }: { text: string; citations: BriefCitation[]; kit: ExecKit }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\[(\d+)\]$/.exec(p);
        if (!m) return <span key={i}>{p}</span>;
        const c = citations.find((x) => x.n === Number(m[1]));
        if (!c) return null;
        const label = kit.t(`kpi.${c.kpi}.name`);
        return c.href ? (
          <Link
            key={i}
            href={c.href}
            className="mx-0.5 align-super text-[0.65rem] font-semibold text-primary hover:underline"
            title={label}
            aria-label={label}
          >
            {c.n}
          </Link>
        ) : (
          <sup key={i} className="mx-0.5 text-[0.65rem] font-semibold text-primary" title={label}>
            {c.n}
          </sup>
        );
      })}
    </>
  );
}

export function ExecutiveBrief({ kit, report, canUseAi }: { kit: ExecKit; report: ExecutiveReport; canUseAi: boolean }) {
  const { t } = kit;
  const te = useTranslations('errors');
  const lines = useMemo(() => briefLines(kit, report), [kit, report]);
  const [ai, setAi] = useState<{ text: string; citations: BriefCitation[] } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const { run, pending } = useAction(writeBriefAction, { refresh: false });

  const write = async () => {
    setFailure(null);
    const res = await run({ config: report.config });
    if (res.ok) setAi(res.data);
    else setFailure(te(res.error.code as never));
  };

  return (
    <Card className="space-y-3 p-5" data-testid="executive-brief">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" aria-hidden />
          {t('brief.title')}
        </h3>
        {canUseAi ? (
          <Button size="sm" variant="outline" onClick={write} disabled={pending} data-testid="brief-ai" className="print:hidden">
            {pending ? t('brief.writing') : ai ? t('brief.regenerate') : t('brief.generate')}
          </Button>
        ) : null}
      </div>
      {ai ? (
        <p className="text-sm leading-relaxed" data-testid="brief-ai-text">
          <Cited text={ai.text} citations={ai.citations} kit={kit} />
        </p>
      ) : (
        <ul className="space-y-1.5 text-sm leading-relaxed" data-testid="brief-rules">
          {lines.map((l) => (
            <li key={l.n} className="flex gap-2">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-subtle-foreground" aria-hidden />
              <span>
                {l.text}
                {l.href ? (
                  <Link
                    href={l.href}
                    className="mx-1 align-super text-[0.65rem] font-semibold text-primary hover:underline"
                    aria-label={t(`kpi.${l.kpi}.name`)}
                  >
                    {l.n}
                  </Link>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {failure ? (
        <p className="text-xs text-danger" role="alert">
          {t('brief.failed', { reason: failure })}
        </p>
      ) : null}
      <Badge tone="neutral">{ai ? t('brief.ai') : t('brief.rules')}</Badge>
    </Card>
  );
}
