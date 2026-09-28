import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const alias = {
  '@': path.resolve(__dirname, 'src'),
  '@messages': path.resolve(__dirname, 'messages'),
  '@emails': path.resolve(__dirname, 'emails'),
  'server-only': path.resolve(__dirname, 'tests/support/server-only.ts'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      { resolve: { alias }, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' } },
      {
        resolve: { alias },
        test: {
          name: 'db',
          include: ['tests/db/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
