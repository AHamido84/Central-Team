'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from 'next-themes';
import { Direction } from 'radix-ui';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { z } from 'zod';

import { TooltipProvider } from '@/components/ui/primitives';
import { createFormatters, type CalendarPreference, type Formatters } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/localized';

// The CSP has no 'unsafe-eval': Zod's JIT probe (`new Function`) is blocked and reported as a console issue. Its
// interpreter is just as correct, so skip the probe in the browser (ADR-089).
z.config({ jitless: true });

const FormatContext = createContext<Formatters | null>(null);

export function useFormat(): Formatters {
  const value = useContext(FormatContext);
  if (!value) throw new Error('useFormat must be used inside <Providers>');
  return value;
}

function ThemedToaster({ dir }: { dir: 'rtl' | 'ltr' }) {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      dir={dir}
      position={dir === 'rtl' ? 'bottom-left' : 'bottom-right'}
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      richColors
      closeButton
      toastOptions={{ className: 'font-sans' }}
    />
  );
}

export function Providers({
  children,
  locale,
  timeZone,
  calendar,
  theme,
  nonce,
}: {
  children: ReactNode;
  nonce?: string;
  locale: Locale;
  timeZone: string;
  calendar: CalendarPreference;
  theme?: 'system' | 'light' | 'dark';
}) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } }),
  );
  const formatters = useMemo(() => createFormatters({ locale, timeZone, calendar }), [locale, timeZone, calendar]);
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return (
    <ThemeProvider nonce={nonce} attribute="class" defaultTheme={theme ?? 'system'} enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <Direction.Provider dir={dir}>
          <FormatContext.Provider value={formatters}>
            <TooltipProvider>
              {children}
              <ThemedToaster dir={dir} />
            </TooltipProvider>
          </FormatContext.Provider>
        </Direction.Provider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
