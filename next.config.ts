import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Server Function arguments (API keys, passwords on the data reset screen) must never reach the dev terminal log.
  logging: { serverFunctions: false },
  poweredByHeader: false,
  typedRoutes: false,
  experimental: {
    // Enables forbidden() + app/forbidden.tsx for permission failures.
    authInterrupts: true,
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default withNextIntl(nextConfig);
