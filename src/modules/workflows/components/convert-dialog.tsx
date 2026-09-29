'use client';

import { CheckCheck, ListTodo, ScanEye } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { scheduleSteps } from '@/modules/workflows/constants';
import { convertRequestToTasksAction } from '@/modules/workflows/server/actions';
import type { TemplateDetail } from '@/modules/workflows/server/queries';

/** "Convert to tasks": pick the workflow and start date, preview the generated chain with due dates, then create it. */
export function ConvertToTasksButton({
  requestId,
  templates,
  today,
  canManageWorkflows,
}: {
  requestId: string;
  templates: TemplateDetail[];
  today: string;
  canManageWorkflows: boolean;
}) {
  const t = useTranslations('workflows');
  const locale = useLocale() as Locale;
  const f = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [start, setStart] = useState(today);
  const convert = useAction(convertRequestToTasksAction, { successMessage: t('convert.done') });
  const template = templates.find((x) => x.id === templateId);
  const schedule = template ? scheduleSteps(template.steps, start) : null;

  return (
    <>
      <Button variant="soft" onClick={() => setOpen(true)} data-testid="convert-to-tasks">
        <ListTodo />
        {t('convert.button')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t('convert.close')} size="lg">
          <DialogHeader>
            <DialogTitle>{t('convert.title')}</DialogTitle>
            <DialogDescription>{t('convert.description')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4" data-testid="convert-dialog">
            {templates.length === 0 ? (
              <div className="grid gap-2 text-sm text-muted-foreground">
                <p>{t('convert.noTemplates')}</p>
                {canManageWorkflows ? (
                  <Link href="/admin/workflows" className="text-link hover:underline">
                    {t('convert.manage')}
                  </Link>
                ) : null}
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('convert.template')}>
                    {(p) => (
                      <NativeSelect
                        {...p}
                        value={templateId}
                        onChange={(e) => setTemplateId(e.target.value)}
                        data-testid="convert-template"
                      >
                        {templates.map((x) => (
                          <option key={x.id} value={x.id}>
                            {localized(x.name, locale)}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                  <Field label={t('convert.startDate')}>
                    {(p) => (
                      <Input {...p} type="date" dir="ltr" value={start} min={today} onChange={(e) => setStart(e.target.value || today)} />
                    )}
                  </Field>
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-medium">{t('convert.preview')}</p>
                  <ol className="grid gap-2" data-testid="convert-preview">
                    {template?.steps.map((s, i) => {
                      const sched = schedule?.get(s.id);
                      return (
                        <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                          <span className="flex size-6 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-foreground">
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1 font-medium">{localized(s.name, locale)}</span>
                          {s.requiresInternalReview ? (
                            <Badge tone="info">
                              <ScanEye />
                              {t('builder.internalReviewShort')}
                            </Badge>
                          ) : null}
                          {s.requiresClientApproval ? (
                            <Badge tone="brand">
                              <CheckCheck />
                              {t('builder.clientApprovalShort')}
                            </Badge>
                          ) : null}
                          {sched ? (
                            <span className="tabular text-xs text-muted-foreground">{f.date(`${sched.dueDate}T12:00:00`, 'medium')}</span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('convert.cancel')}
            </Button>
            <Button
              disabled={!template}
              loading={convert.pending}
              onClick={async () => {
                const res = await convert.run({ requestId, templateId, startDate: start });
                if (res.ok) {
                  setOpen(false);
                  router.refresh();
                }
              }}
              data-testid="convert-confirm"
            >
              {t('convert.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
