import { expect, test } from '@playwright/test';

import { login, unique } from './support';

/**
 * FR1.5 — an admin adds a provider key in /admin/ai: it is shown masked, never comes back to the browser (not in the
 * page, not in any response), can be tested (a fake key fails with a clear message) and deleted.
 */
test('add a key: masked, never returned to the browser, test fails cleanly, delete', async ({ page }) => {
  const secret = `sk-ant-api03-${unique('e2e')}-zz9x`;
  const bodies: string[] = [];
  page.on('response', async (res) => {
    if (res.request().method() === 'POST' || res.url().includes('/admin/ai')) {
      try {
        bodies.push(await res.text());
      } catch {
        // Redirects and aborted requests have no body.
      }
    }
  });

  await login(page, 'sara@ofoq.test');
  await page.goto('/admin/ai');
  await page.getByTestId('ai-key-add').click();
  const form = page.getByTestId('ai-key-form');
  await form.getByTestId('ai-key-name').fill('مفتاح الاختبار');
  await form.getByTestId('ai-key-secret').fill(secret);
  await form.getByTestId('ai-key-model').fill('claude-opus-5-5');
  await form.getByTestId('ai-key-save').click();

  const row = page.getByTestId('ai-key-row').filter({ hasText: 'مفتاح الاختبار' });
  await expect(row).toBeVisible();
  await expect(row.getByTestId('ai-key-hint')).toHaveText('sk-…zz9x');
  await expect(page.getByTestId('ai-source-anthropic')).toContainText(/مفتاح هذه المؤسسة|this organization/);

  // A fake key: the test reports a failure (rejected, or the provider unreachable from here) — never success.
  await row.getByTestId('ai-key-test').click();
  await expect(row.getByText(/فشل الاتصال|Connection failed/)).toBeVisible({ timeout: 30_000 });

  await page.reload();
  expect(await page.content()).not.toContain(secret);
  expect(bodies.some((b) => b.includes(secret))).toBe(false);

  await page.getByTestId('ai-key-row').filter({ hasText: 'مفتاح الاختبار' }).getByTestId('ai-key-delete').click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /حذف المفتاح|Delete key/ })
    .click();
  await expect(page.getByTestId('ai-key-row').filter({ hasText: 'مفتاح الاختبار' })).toHaveCount(0);
});
