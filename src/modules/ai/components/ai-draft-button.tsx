'use client';

import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/overlays';
import { useAction } from '@/lib/actions/use-action';
import { draftReportSectionAction } from '@/modules/ai/server/actions';

/**
 * "Draft with AI" for a report's commentary / next-steps section (ADR-077). The text lands in the editor unsaved;
 * existing text is replaced only after a confirmation.
 */
export function AiDraftButton({
  reportId,
  section,
  hasText,
  disabled,
  disabledReason,
  onDraft,
}: {
  reportId: string;
  section: 'commentary' | 'next_steps';
  hasText: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onDraft: (text: string) => void;
}) {
  const t = useTranslations('ai.draft');
  const tc = useTranslations('common');
  const [confirm, setConfirm] = useState(false);
  const draft = useAction(draftReportSectionAction, { successMessage: t('drafted'), refresh: false, onSuccess: (r) => onDraft(r.text) });
  const run = () => void draft.run({ reportId, section });
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        loading={draft.pending}
        disabled={disabled}
        title={disabled ? disabledReason : t('hint')}
        onClick={() => (hasText ? setConfirm(true) : run())}
        data-testid="ai-draft"
      >
        <Sparkles aria-hidden />
        {draft.pending ? t('drafting') : t('button')}
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('replaceTitle')}
        description={t('replaceBody')}
        confirmLabel={t('replace')}
        cancelLabel={tc('cancel')}
        onConfirm={run}
      />
    </>
  );
}
