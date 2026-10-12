import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Server Function arguments (API keys, passwords on the data reset screen) must never reach the dev terminal log.
  logging: { serverFunctions: false },
  poweredByHeader: false,
  // Board report PDFs (FR7, ADR-097): Next keeps puppeteer-core and @sparticuz/chromium external by default; their
  // Chromium binary and the embedded PDF fonts are traced only into the functions that render board reports.
  outputFileTracingIncludes: Object.fromEntries(
    ['/api/executive/export', '/api/cron/dispatch-events', '/executive/reports'].map((route) => [
      route,
      [
        './node_modules/@sparticuz/chromium/bin/**/*',
        './node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-{arabic,latin}-{400,600}-normal.woff2',
      ],
    ]),
  ),
  typedRoutes: false,
  experimental: {
    // Enables forbidden() + app/forbidden.tsx for permission failures.
    authInterrupts: true,
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default withNextIntl(nextConfig);
