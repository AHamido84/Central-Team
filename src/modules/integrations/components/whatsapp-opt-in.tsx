'use client';

import { MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Card, Checkbox } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { whatsappOptInAction, whatsappOptOutAction } from '@/modules/integrations/server/actions';
import type { WhatsAppChannel } from '@/modules/integrations/server/queries';

/** Consent for WhatsApp notifications (agency users): phone + explicit agreement, revocable anytime. */
export function WhatsAppOptIn({ channel }: { channel: WhatsAppChannel }) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const format = useFormat();
  const [phone, setPhone] = useState(channel.phone ?? channel.suggestedPhone ?? '');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const optIn = useAction(whatsappOptInAction, { successMessage: tc('saved') });
  const optOut = useAction(whatsappOptOutAction, { successMessage: tc('saved') });
  return (
    <Card className="mb-4 p-5" data-testid="whatsapp-opt-in">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-success-soft text-success">
          <MessageCircle className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">{t('whatsappSection')}</h2>
            <p className="text-xs text-muted-foreground">{t('whatsappSectionHint')}</p>
          </div>
          {!channel.available ? (
            <p className="text-xs text-subtle-foreground">{t('whatsappUnavailable')}</p>
          ) : channel.optedIn ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                {t('whatsappOn', {
                  phone: channel.phone ?? '',
                  date: channel.optedInAt ? format.date(channel.optedInAt) : '',
                })}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void optOut.run({})}
                loading={optOut.pending}
                data-testid="whatsapp-opt-out"
              >
                {t('whatsappOptOut')}
              </Button>
            </div>
          ) : (
            <form
              className="grid gap-3 sm:max-w-md"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!consent) return setError('consent');
                setError(undefined);
                const res = await optIn.run({ phone, consent: true });
                if (!res.ok && res.error.fieldErrors?.phone) setError('phone');
              }}
            >
              <Field label={t('whatsappPhone')} error={error === 'phone' ? 'invalid_phone' : undefined}>
                {(p) => (
                  <Input
                    {...p}
                    dir="ltr"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    data-testid="whatsapp-phone"
                  />
                )}
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={consent}
                  onCheckedChange={(v) => setConsent(v === true)}
                  className="mt-0.5"
                  data-testid="whatsapp-consent"
                />
                <span>{t('whatsappConsent')}</span>
              </label>
              {error === 'consent' ? (
                <p role="alert" className="text-xs font-medium text-danger">
                  {t('whatsappConsentRequired')}
                </p>
              ) : null}
              <div>
                <Button type="submit" size="sm" loading={optIn.pending} data-testid="whatsapp-opt-in-submit">
                  {t('whatsappOptIn')}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </Card>
  );
}
