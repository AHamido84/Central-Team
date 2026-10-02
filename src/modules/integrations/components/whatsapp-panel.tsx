'use client';

import { MessageCircle, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { DirIcon, EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Card, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { MessageStatusBadge } from '@/modules/integrations/components/badges';
import { renderTemplateBody } from '@/modules/integrations/constants';
import { sendWhatsAppAction } from '@/modules/integrations/server/actions';
import type { WhatsAppPanelData } from '@/modules/integrations/server/queries';

/** WhatsApp on the lead / deal page: send an approved template to the contact and follow its delivery. */
export function WhatsAppPanel({
  subject,
  data,
  canSend,
}: {
  subject: { leadId: string } | { dealId: string };
  data: WhatsAppPanelData;
  canSend: boolean;
}) {
  const t = useTranslations('integrations.panel');
  const tc = useTranslations('common');
  const ti = useTranslations('integrations');
  const locale = useLocale();
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const preferred = data.templates.find((x) => x.language === locale) ?? data.templates[0];
  const [templateId, setTemplateId] = useState(preferred?.id ?? '');
  const template = data.templates.find((x) => x.id === templateId);
  const [params, setParams] = useState<string[]>([]);
  const values = useMemo(
    () => Array.from({ length: template?.paramCount ?? 0 }, (_, i) => params[i] ?? (i === 0 ? data.name : '')),
    [template, params, data.name],
  );
  const send = useAction(sendWhatsAppAction, {
    successMessage: t('sent'),
    onSuccess: () => {
      setOpen(false);
      setParams([]);
    },
  });
  const ready = !!template && values.every((v) => v.trim());

  return (
    <Card data-testid="whatsapp-panel">
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <MessageCircle className="size-4 text-success" aria-hidden />
          {t('title')}
        </h2>
        {canSend ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
            disabled={!data.phone || !data.templates.length}
            data-testid="whatsapp-send-open"
          >
            <DirIcon icon={Send} />
            {t('send')}
          </Button>
        ) : null}
      </div>
      {!data.phone ? (
        <p className="px-5 py-3 text-xs text-subtle-foreground">{t('noPhone')}</p>
      ) : !data.templates.length ? (
        <p className="px-5 py-3 text-xs text-subtle-foreground">{t('noTemplates')}</p>
      ) : null}
      {data.messages.length ? (
        <ul className="divide-y divide-border" data-testid="whatsapp-history">
          {data.messages.map((m) => (
            <li key={m.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-subtle-foreground">
                <MessageStatusBadge status={m.status} />
                <span>{format.dateTime(m.createdAt)}</span>
                {m.sentBy && data.people[m.sentBy] ? <bdi>{data.people[m.sentBy]}</bdi> : null}
                {m.readAt ? (
                  <span>{t('readAt', { when: format.relative(m.readAt) })}</span>
                ) : m.deliveredAt ? (
                  <span>{t('deliveredAt', { when: format.relative(m.deliveredAt) })}</span>
                ) : null}
              </div>
              <p className="mt-1 text-sm whitespace-pre-line" dir={m.language === 'ar' ? 'rtl' : 'ltr'}>
                {m.body}
              </p>
              {m.status === 'failed' && m.errorCode ? (
                <p className="text-xs text-danger">{ti(`errors.${m.errorCode as 'platform_error'}`)}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={MessageCircle} title={t('empty')} compact />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={tc('close')}>
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
            <DialogDescription>{t.rich('dialogBody', { phone: () => <bdi dir="ltr">{data.phone}</bdi> })}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!template) return;
              void send.run({
                ...('leadId' in subject ? { leadId: subject.leadId } : { dealId: subject.dealId }),
                templateId: template.id,
                params: values,
              });
            }}
          >
            <DialogBody className="grid gap-4">
              <Field label={t('template')}>
                {(p) => (
                  <NativeSelect
                    {...p}
                    value={templateId}
                    onChange={(e) => {
                      setTemplateId(e.target.value);
                      setParams([]);
                    }}
                    data-testid="whatsapp-template"
                  >
                    {data.templates.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} · {x.language.toUpperCase()}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              {values.map((v, i) => (
                <Field key={`${templateId}-${i}`} label={t('param', { n: i + 1 })} required>
                  {(p) => (
                    <Input
                      {...p}
                      value={v}
                      maxLength={500}
                      onChange={(e) => {
                        const next = [...values];
                        next[i] = e.target.value;
                        setParams(next);
                      }}
                      data-testid={`whatsapp-param-${i + 1}`}
                    />
                  )}
                </Field>
              ))}
              {template ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{t('preview')}</p>
                  <div
                    className="rounded-lg rounded-ss-none bg-success-soft px-3 py-2 text-sm whitespace-pre-line text-foreground"
                    dir={template.language === 'ar' ? 'rtl' : 'ltr'}
                    data-testid="whatsapp-preview"
                  >
                    {renderTemplateBody(template.body, values)}
                  </div>
                </div>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={send.pending} disabled={!ready} data-testid="whatsapp-send">
                <DirIcon icon={Send} />
                {t('send')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
