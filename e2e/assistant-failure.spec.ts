import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

import { login } from './support';

/**
 * FR3.2 / ADR-089: an AI failure never takes the page down. The browser behaves like current Chrome, whose scroll
 * methods return a Promise (the production crash: an effect returned it and React called it as the cleanup). A fake
 * Anthropic key makes the provider fail (rejected key, or unreachable without network); the thread shows the specific
 * reason with "Fix in AI settings" for the admin, and the composer, the conversation list and the menu keep working.
 */
const db = () => postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });

const KEY_NAME = 'e2e failing key';

/** Types a question once the composer is hydrated (a fill before hydration is lost and Send stays disabled). */
async function ask(page: Page, question: string) {
  const input = page.getByTestId('assistant-input');
  const send = page.getByTestId('assistant-send');
  await expect(async () => {
    await input.fill(question);
    await expect(send).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await send.click();
}

test('a provider failure shows an inline reason and the page stays usable', async ({ browser }) => {
  test.setTimeout(180_000);
  const sql = db();
  const started = new Date();
  // The profile language decides the UI (gotcha 45): the checks below use test ids or both languages.
  const context = await browser.newContext({ locale: 'en-US' });
  await context.addInitScript(() => {
    for (const m of ['scrollIntoView', 'scrollTo', 'scrollBy', 'scroll'] as const) {
      const original = Element.prototype[m] as (...args: unknown[]) => void;
      Object.defineProperty(Element.prototype, m, {
        configurable: true,
        value(this: Element, ...args: unknown[]) {
          original.apply(this, args);
          return Promise.resolve();
        },
      });
    }
  });
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3000' }]);
  const page = await context.newPage();
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  try {
    await sql`update public.ai_settings set enabled = true`;
    // Faisal (Admin, ai:manage): Sara already signs in often across the suite and the login limit is per email (gotcha 20).
    await login(page, 'faisal@ofoq.test');

    // A key Anthropic will reject (through the UI, so the server's cached client is invalidated).
    await page.goto('/admin/ai');
    await page.getByTestId('ai-key-add').click();
    const form = page.getByTestId('ai-key-form');
    await form.getByTestId('ai-key-name').fill(KEY_NAME);
    await form.getByTestId('ai-key-secret').fill('sk-ant-api03-e2e-not-a-real-key-0000');
    await form.getByTestId('ai-key-model').fill('claude-opus-5-5');
    await form.getByTestId('ai-key-save').click();
    await expect(page.getByTestId('ai-key-row').filter({ hasText: KEY_NAME })).toBeVisible({ timeout: 60_000 });

    await page.goto('/assistant');
    await ask(page, 'Which client requests are still open?');
    await page.waitForURL(/\/assistant\/[0-9a-f-]{36}$/, { timeout: 90_000 });

    const reply = page.getByTestId('message-assistant').last();
    await expect(reply).toHaveAttribute('data-status', 'failed', { timeout: 90_000 });
    const failure = reply.getByTestId('assistant-failure');
    await expect(failure).toHaveAttribute('data-reason', /^ai_(key_invalid|unavailable|timeout)$/);
    if ((await failure.getAttribute('data-reason')) === 'ai_key_invalid') {
      await expect(failure).toContainText(/Anthropic rejected the API key|رفضت Anthropic مفتاح API/);
      await expect(reply.getByTestId('assistant-fix-settings')).toHaveAttribute('href', '/admin/ai');
    }

    // The page is still the assistant: no error screen, the panel and composer work, a follow-up gets its own reply.
    await expect(page.getByText(/Something went wrong|حدث خطأ غير متوقع/)).toHaveCount(0);
    await expect(page.getByTestId('assistant-panel-error')).toHaveCount(0);
    await expect(page.getByTestId('conversation-list')).toBeVisible();
    await ask(page, 'And the overdue tasks?');
    await expect(page.getByTestId('message-assistant')).toHaveCount(2, { timeout: 90_000 });
    await expect(page.getByTestId('assistant-input')).toBeEditable();
    expect(crashes, crashes.join('\n')).toEqual([]);
  } finally {
    // Remove the key through the UI as well (invalidates the cached client for the next specs), then by SQL.
    try {
      await page.goto('/admin/ai');
      const row = page.getByTestId('ai-key-row').filter({ hasText: KEY_NAME });
      if (await row.count()) {
        await row.getByTestId('ai-key-delete').click();
        await page
          .getByRole('alertdialog')
          .getByRole('button', { name: /Delete key|حذف المفتاح/ })
          .click();
        await expect(row).toHaveCount(0);
      }
    } finally {
      await sql`delete from public.ai_credentials where display_name = ${KEY_NAME}`;
      await sql`delete from public.ai_conversations where created_at >= ${started}`;
      await sql.end();
      await context.close();
    }
  }
});
