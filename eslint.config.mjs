import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * Physical direction utilities break RTL. Use logical ones instead (CLAUDE.md §7):
 * ms/me, ps/pe, start/end, text-start/end, border-s/e, rounded-s/e.
 */
const PHYSICAL_CLASS =
  /(?:^|\s|:)-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|text-left|text-right|float-left|float-right|scroll-ml|scroll-mr)(?:-|\s|$)/;

/** Local rules kept inside the repo (no extra plugin package). */
const local = {
  rules: {
    'no-physical-direction-classes': {
      meta: {
        type: 'problem',
        messages: { physical: 'Use logical direction classes (ms/me, ps/pe, start/end, text-start/end) — "{{cls}}" breaks RTL.' },
      },
      create(context) {
        const check = (node, value) => {
          if (typeof value !== 'string') return;
          const match = value.match(PHYSICAL_CLASS);
          if (match) context.report({ node, messageId: 'physical', data: { cls: match[0].trim() } });
        };
        return {
          JSXAttribute(node) {
            if (node.name.name !== 'className' || !node.value) return;
            if (node.value.type === 'Literal') check(node, node.value.value);
          },
          Literal(node) {
            const parent = node.parent;
            if (parent?.type === 'CallExpression' && ['cn', 'cva', 'clsx'].includes(parent.callee?.name)) check(node, node.value);
          },
          TemplateElement(node) {
            const call = node.parent?.parent;
            if (call?.type === 'CallExpression' && ['cn', 'cva', 'clsx'].includes(call.callee?.name)) check(node, node.value.raw);
          },
        };
      },
    },
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: { local },
    rules: {
      'local/no-physical-direction-classes': 'error',
      // React Hook Form and TanStack Table are the chosen stack; the compiler simply skips memoizing those components.
      'react-hooks/incompatible-library': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
      'react/jsx-no-literals': [
        'error',
        {
          noStrings: false,
          ignoreProps: true,
          allowedStrings: ['·', '—', '–', '−', '+', '-', '/', '*', ':', '%', '@', '(', ')', '⌘K', '%)', '|', '‹', '›'],
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/modules/*/db/*'], message: 'Import tables from "@/lib/db/schema", not from another module\'s db folder.' },
            { group: ['../../*'], message: 'Use the "@/..." alias for imports outside the current folder tree.' },
          ],
        },
      ],
    },
  },
  {
    // Schema barrel and module schemas may reference each other.
    files: ['src/lib/db/**', 'src/modules/*/db/**', 'scripts/**', 'tests/**', 'e2e/**', 'drizzle.config.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Emails get their copy from messages/ via props; scripts and tests are not user-facing.
    files: ['emails/**', 'scripts/**', 'tests/**', 'e2e/**'],
    rules: { 'react/jsx-no-literals': 'off', 'no-console': 'off' },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'supabase/**', 'playwright-report/**', 'test-results/**']),
]);

export default eslintConfig;
