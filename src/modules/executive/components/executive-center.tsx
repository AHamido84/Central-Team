'use client';

import { ChevronLeft, ChevronRight, Presentation, ShieldCheck, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { DirIcon, EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/primitives';
import { cn } from '@/lib/utils/cn';
import { tabKpis, type KpiKey } from '@/modules/executive/catalog';
import type { ExecutiveReport } from '@/modules/executive/compute';
import { viewSearch } from '@/modules/executive/config';
import { ExecutiveBrief } from '@/modules/executive/components/executive-brief';
import { ExecutiveControls } from '@/modules/executive/components/executive-controls';
import { KpiTile } from '@/modules/executive/components/kpi-tile';
import { ClientsTab, MarketingTab, OperationsTab, RiskRow, RisksTab, SalesTab, TeamTab } from '@/modules/executive/components/tab-views';
import { useExecKit } from '@/modules/executive/components/use-kit';
import type { ExecKit } from '@/modules/executive/text';
import { executiveTabs, type ExecutiveTab } from '@/modules/executive/types';

const REFRESH_MS = 5 * 60_000;
const ATTENTION_SHOWN = 8;

function Tiles({
  kit,
  report,
  tab,
  onNote,
  large,
}: {
  kit: ExecKit;
  report: ExecutiveReport;
  tab: ExecutiveTab;
  onNote?: (k: KpiKey) => void;
  large?: boolean;
}) {
  return (
    <div
      className={cn('grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4', large ? 'xl:grid-cols-5' : '2xl:grid-cols-5')}
      data-testid={`tiles-${tab}`}
    >
      {tabKpis[tab].map((k) => (
        <KpiTile
          key={k}
          kit={kit}
          value={report.kpis[k]}
          filters={report.config.filters}
          incomplete={report.period.incomplete}
          onNote={onNote}
        />
      ))}
    </div>
  );
}

function Attention({ kit, report }: { kit: ExecKit; report: ExecutiveReport }) {
  const { t } = kit;
  const items = report.attention;
  return (
    <Card className="space-y-2 p-5" data-testid="attention-panel">
      <div>
        <h3 className="text-sm font-semibold">{t('attention.title')}</h3>
        <p className="text-xs text-subtle-foreground">{t('attention.description')}</p>
      </div>
      {items.length ? (
        <>
          <ul className="divide-y divide-border">
            {items.slice(0, ATTENTION_SHOWN).map((item) => (
              <RiskRow
                key={item.id}
                kit={kit}
                item={{ ...item, category: item.kind === 'risk' ? item.category : item.kind }}
                names={report.names}
              />
            ))}
          </ul>
          {items.length > ATTENTION_SHOWN ? (
            <p className="text-xs text-subtle-foreground">{t('attention.more', { count: items.length - ATTENTION_SHOWN })}</p>
          ) : null}
        </>
      ) : (
        <EmptyState compact icon={ShieldCheck} title={t('attention.empty')} description={t('attention.emptyBody')} />
      )}
    </Card>
  );
}

function TabBody({
  kit,
  report,
  tab,
  canUseAi,
  onNote,
}: {
  kit: ExecKit;
  report: ExecutiveReport;
  tab: ExecutiveTab;
  canUseAi: boolean;
  onNote?: (k: KpiKey) => void;
}) {
  const views: Record<Exclude<ExecutiveTab, 'overview'>, ReactNode> = {
    clients: <ClientsTab kit={kit} report={report} />,
    operations: <OperationsTab kit={kit} report={report} />,
    team: <TeamTab kit={kit} report={report} />,
    marketing: <MarketingTab kit={kit} report={report} />,
    sales: <SalesTab kit={kit} report={report} />,
    risks: <RisksTab kit={kit} report={report} />,
  };
  return (
    <div className="space-y-4" data-testid={`tab-${tab}`}>
      <Tiles kit={kit} report={report} tab={tab} onNote={onNote} large={!onNote} />
      {tab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Attention kit={kit} report={report} />
          <ExecutiveBrief kit={kit} report={report} canUseAi={canUseAi} />
        </div>
      ) : (
        views[tab]
      )}
    </div>
  );
}

export function ExecutiveCenter({
  report,
  canUseAi,
  actions,
  onNote,
  updatedAt,
}: {
  report: ExecutiveReport;
  canUseAi: boolean;
  /** Header actions (export, saved views, refresh) rendered by the page. */
  actions?: ReactNode;
  onNote?: (k: KpiKey) => void;
  updatedAt: string;
}) {
  const kit = useExecKit();
  const { t, f } = kit;
  const router = useRouter();
  const [tab, setTab] = useState<ExecutiveTab>(report.config.tab);
  const [presenting, setPresenting] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  // Tabs switch on the client (every tab is already computed) and keep the URL in sync for links and saved views.
  const selectTab = useCallback(
    (next: ExecutiveTab) => {
      setTab(next);
      window.history.replaceState(null, '', `/executive${viewSearch(report.config, { tab: next })}`);
    },
    [report.config],
  );

  const step = useCallback(
    (by: number) => {
      const i = executiveTabs.indexOf(tab);
      selectTab(executiveTabs[(i + by + executiveTabs.length) % executiveTabs.length]!);
    },
    [tab, selectTab],
  );

  const exit = useCallback(() => {
    setPresenting(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      const rtl = document.documentElement.dir === 'rtl';
      if (e.key === 'Escape') exit();
      else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') step(e.key === 'ArrowRight' && rtl ? -1 : 1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') step(e.key === 'ArrowLeft' && rtl ? 1 : -1);
    };
    const onFs = () => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    const timer = window.setInterval(() => router.refresh(), REFRESH_MS);
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [presenting, step, exit, router]);

  const present = () => {
    setPresenting(true);
    void stage.current?.requestFullscreen?.().catch(() => undefined);
  };

  const p = report.period;
  const day = (iso: string) => f.date(`${iso}T12:00:00Z`);
  const periodLine = (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span className="font-medium text-foreground" data-testid="executive-period-range">
        {t('periodRange', { from: day(p.from), to: day(p.to) })}
      </span>
      {p.incomplete ? (
        <Badge tone="info">{t('incomplete', { elapsed: f.number(p.elapsedDays), total: f.number(p.totalDays) })}</Badge>
      ) : null}
      {report.comparison ? <span>{t('versus', { from: day(report.comparison.from), to: day(report.comparison.to) })}</span> : null}
      <span className="text-xs text-subtle-foreground">{t('updated', { time: f.dateTime(updatedAt) })}</span>
    </div>
  );

  return (
    <div
      ref={stage}
      className={cn('space-y-5', presenting && 'fixed inset-0 z-[95] overflow-y-auto bg-background p-6 md:p-10')}
      data-testid="executive-center"
      data-presenting={presenting || undefined}
    >
      {presenting ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-h2 font-semibold">{t(`tabs.${tab}`)}</h2>
            {periodLine}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground" data-testid="present-slide">
              {t('present.slide', { n: f.number(executiveTabs.indexOf(tab) + 1), total: f.number(executiveTabs.length) })}
            </span>
            <Button variant="outline" size="icon" onClick={() => step(-1)} aria-label={t('present.previous')}>
              <DirIcon icon={ChevronLeft} />
            </Button>
            <Button variant="outline" size="icon" onClick={() => step(1)} aria-label={t('present.next')}>
              <DirIcon icon={ChevronRight} />
            </Button>
            <Button variant="ghost" size="icon" onClick={exit} aria-label={t('present.exit')} data-testid="present-exit">
              <X />
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <ExecutiveControls kit={kit} config={report.config} options={report.options} />
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              {actions}
              <Button variant="outline" onClick={present} data-testid="executive-present">
                <Presentation />
                {t('controls.present')}
              </Button>
            </div>
          </div>
          {periodLine}
          <nav className="-mx-1 overflow-x-auto print:hidden" aria-label={t('title')}>
            <div className="flex min-w-max gap-1 border-b border-border px-1" role="tablist">
              {executiveTabs.map((x) => (
                <button
                  key={x}
                  type="button"
                  role="tab"
                  aria-selected={tab === x}
                  onClick={() => selectTab(x)}
                  className={cn(
                    '-mb-px inline-flex h-10 items-center border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    tab === x && 'border-primary text-foreground',
                  )}
                  data-testid={`executive-tab-${x}`}
                >
                  {t(`tabs.${x}`)}
                  {x === 'risks' && report.risks.items.length ? (
                    <Badge tone="danger" className="ms-1.5">
                      {f.number(report.risks.items.length)}
                    </Badge>
                  ) : null}
                </button>
              ))}
            </div>
          </nav>
        </>
      )}
      <TabBody kit={kit} report={report} tab={tab} canUseAi={canUseAi} onNote={presenting ? undefined : onNote} />
      {presenting ? <p className="text-center text-xs text-subtle-foreground">{t('present.autoRefresh')}</p> : null}
    </div>
  );
}
