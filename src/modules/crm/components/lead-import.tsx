'use client';

import { FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Checkbox, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { parseCsv } from '@/modules/campaigns/csv';
import { leadSources, type LeadSource } from '@/modules/crm/constants';
import { normalizeEmail, normalizePhone } from '@/modules/crm/leads';
import { importLeadsAction } from '@/modules/crm/server/actions';

const fields = ['fullName', 'company', 'phone', 'email', 'city', 'services', 'notes'] as const;
type ImportField = (typeof fields)[number];

/** Header names we recognise (English, Arabic, common CRM exports). */
const synonyms: Record<ImportField, RegExp> = {
  fullName: /^(full ?name|name|contact( name)?|الاسم( الكامل)?|اسم العميل)$/i,
  company: /^(company|organization|business|brand|الشركة|المنشأة|العلامة التجارية)$/i,
  phone: /^(phone|mobile|phone number|mobile number|whatsapp|الجوال|رقم الجوال|الهاتف|واتساب)$/i,
  email: /^(e-?mail|email address|البريد|البريد الإلكتروني|الإيميل)$/i,
  city: /^(city|المدينة)$/i,
  services: /^(services?|interest|interested in|الخدمات|الخدمة|الاهتمام)$/i,
  notes: /^(notes?|message|comments?|ملاحظات|الرسالة)$/i,
};

export function LeadImportDialog({
  open,
  onOpenChange,
  owners,
  canManageAll,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  owners: { id: string; name: string }[];
  canManageAll: boolean;
}) {
  const t = useTranslations('crm');
  const tc = useTranslations('common');
  const [table, setTable] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, number>>>({});
  const [source, setSource] = useState<LeadSource>('other');
  const [ownerId, setOwnerId] = useState('');
  const [useRules, setUseRules] = useState(true);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const run = useAction(importLeadsAction);

  const headers = table?.[0] ?? [];
  const rows = useMemo(() => {
    if (!table) return [];
    const cell = (r: string[], f: ImportField) => (mapping[f] !== undefined ? (r[mapping[f]!] ?? '').trim() : '');
    return table
      .slice(1)
      .filter((r) => r.some((c) => c.trim()))
      .map((r) => ({
        fullName: cell(r, 'fullName'),
        company: cell(r, 'company') || null,
        phone: cell(r, 'phone') || null,
        email: cell(r, 'email') || null,
        city: cell(r, 'city') || null,
        services: cell(r, 'services') || null,
        notes: cell(r, 'notes') || null,
      }));
  }, [table, mapping]);
  const valid = rows.filter((r) => r.fullName && (normalizePhone(r.phone) || normalizeEmail(r.email)));

  const load = async (file: File) => {
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) return toast.error(t('import.empty'));
    setTable(parsed);
    const auto: Partial<Record<ImportField, number>> = {};
    parsed[0]!.forEach((h, i) => {
      for (const f of fields) if (auto[f] === undefined && synonyms[f].test(h.trim())) auto[f] = i;
    });
    setMapping(auto);
  };

  const reset = () => {
    setTable(null);
    setMapping({});
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent closeLabel={tc('close')} size="lg">
        <DialogHeader>
          <DialogTitle>{t('import.title')}</DialogTitle>
          <DialogDescription>{t('import.description')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4" data-testid="lead-import">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring hover:bg-surface-muted">
            <FileUp className="size-6" aria-hidden />
            <span>{t('import.choose')}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
              data-testid="lead-import-file"
            />
          </label>
          {table ? (
            <>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">{t('import.mapping')}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {fields.map((f) => (
                    <label key={f} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 text-sm">
                      <span className="text-muted-foreground">{t(`import.fields.${f}`)}</span>
                      <NativeSelect
                        value={mapping[f] ?? ''}
                        onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        data-testid={`map-${f}`}
                      >
                        <option value="">{t('import.ignore')}</option>
                        {headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h || `#${i + 1}`}
                          </option>
                        ))}
                      </NativeSelect>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('leads.source')}>
                  {(p) => (
                    <NativeSelect {...p} value={source} onChange={(e) => setSource(e.target.value as LeadSource)}>
                      {leadSources.map((s) => (
                        <option key={s} value={s}>
                          {t(`sources.${s}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                {canManageAll ? (
                  <Field label={t('leads.owner')}>
                    {(p) => (
                      <NativeSelect {...p} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                        <option value="">{useRules ? t('leads.autoAssign') : t('leads.unassigned')}</option>
                        {owners.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                ) : null}
              </div>
              <div className="grid gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <Checkbox checked={skipDuplicates} onCheckedChange={(v) => setSkipDuplicates(v === true)} />
                  {t('import.skipDuplicates')}
                </label>
                {canManageAll ? (
                  <label className="flex items-center gap-2">
                    <Checkbox checked={useRules} onCheckedChange={(v) => setUseRules(v === true)} />
                    {t('import.useRules')}
                  </label>
                ) : null}
              </div>
              <p className="text-sm" role="status" data-testid="lead-import-preview">
                <span className="font-medium">{t('import.preview', { count: valid.length })}</span>
                {rows.length - valid.length ? (
                  <span className="ms-2 text-warning">{t('import.invalid', { count: rows.length - valid.length })}</span>
                ) : null}
              </p>
              {mapping.fullName === undefined || (mapping.phone === undefined && mapping.email === undefined) ? (
                <p className="text-sm text-danger">{t('import.needName')}</p>
              ) : null}
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            disabled={!valid.length}
            loading={run.pending}
            data-testid="lead-import-run"
            onClick={async () => {
              const res = await run.run({ source, ownerId: ownerId || null, useRules, skipDuplicates, rows: valid });
              if (res.ok) {
                toast.success(t('import.done', { created: res.data.created, skipped: res.data.skipped }));
                reset();
                onOpenChange(false);
              }
            }}
          >
            {t('import.run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
