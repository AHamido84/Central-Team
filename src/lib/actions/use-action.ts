'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import type { ActionResult } from '@/lib/actions/errors';

/**
 * Calls a server action, shows a translated toast on failure (and optionally on success),
 * refreshes server components on success.
 */
export function useAction<I, O>(
  action: (input: I) => Promise<ActionResult<O>>,
  options: { successMessage?: string; refresh?: boolean; onSuccess?: (data: O) => void } = {},
) {
  const t = useTranslations('errors');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const run = async (input: I): Promise<ActionResult<O>> => {
    setPending(true);
    try {
      const res = await action(input);
      if (res.ok) {
        if (options.successMessage) toast.success(options.successMessage);
        options.onSuccess?.(res.data);
        if (options.refresh !== false) router.refresh();
      } else {
        toast.error(t(res.error.code));
      }
      return res;
    } catch {
      toast.error(t('unknown'));
      return { ok: false, error: { code: 'unknown' } };
    } finally {
      setPending(false);
    }
  };
  return { run, pending };
}
