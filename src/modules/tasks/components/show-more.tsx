'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Board columns and list/table groups mount their first rows only and grow on demand (ADR-082): mounting hundreds of
 * cards (each with drag & drop handlers) is what made switching views slow with 1,000 tasks.
 */
export const RENDER_STEP = 40;

export function useRenderLimit(step = RENDER_STEP) {
  const [limit, setLimit] = useState(step);
  return { limit, more: () => setLimit((l) => l + step * 2) };
}

export function ShowMore({ hidden, onMore, className }: { hidden: number; onMore: () => void; className?: string }) {
  const t = useTranslations('tasks');
  if (hidden <= 0) return null;
  return (
    <Button variant="ghost" size="sm" onClick={onMore} className={className} data-testid="show-more">
      {t('showMore', { count: hidden })}
    </Button>
  );
}

/** Renders the first rows of `items` and hands back a "show more" control for the rest. */
export function Limited<T>({
  items,
  step,
  children,
}: {
  items: T[];
  step?: number;
  children: (shown: T[], showMore: (hidden: number, onMore: () => void) => ReactNode) => ReactNode;
}) {
  const { limit, more } = useRenderLimit(step);
  const shown = items.length > limit ? items.slice(0, limit) : items;
  return <>{children(shown, (hidden) => (hidden > 0 ? <ShowMore hidden={hidden} onMore={more} /> : null))}</>;
}
