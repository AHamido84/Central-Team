import { expect, test, type Page } from '@playwright/test';

import { login, PASSWORD, unique } from './support';

/**
 * Feedback Round 1 — delete, Trash and data management (ADR-080/081): a deleted client disappears from the list, comes
 * back from the Trash, and is purged for good; the data reset screen is guarded by the lock, the password and the phrase.
 */

async function confirmDelete(page: Page, name: string) {
  const dialog = page.getByTestId('delete-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('delete-confirm')).toBeDisabled();
  await dialog.getByTestId('delete-type-name').fill(name);
  await dialog.getByTestId('delete-confirm').click();
}

test('delete a client → gone everywhere → restore from the Trash → delete again → purge', async ({ page }) => {
  const name = `عميل للحذف ${unique('e2e')}`;
  await login(page, 'faisal@ofoq.test');
  await page.goto('/clients/new');
  await page.getByTestId('client-name-ar').fill(name);
  await page.getByTestId('client-submit').click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);

  // Delete from the client page: the dialog asks for the name, then the client is gone from the list.
  await page.getByTestId('delete-button').click();
  await confirmDelete(page, name);
  await page.waitForURL(/\/clients$/);
  await expect(page.getByTestId('clients-table')).not.toContainText(name);

  // The Trash lists it; restoring brings it back.
  await page.goto('/admin/trash');
  const item = page.getByTestId('trash-item').filter({ hasText: name });
  await expect(item).toBeVisible();
  await item.getByTestId('trash-restore').click();
  await expect(item).toHaveCount(0);
  await page.goto('/clients');
  await expect(page.getByTestId('clients-table')).toContainText(name);

  // Row actions → delete again, then purge for good.
  await page.getByTestId('clients-table').getByRole('row').filter({ hasText: name }).getByTestId('row-actions').click();
  await page.getByTestId('action-delete').click();
  await confirmDelete(page, name);
  await expect(page.getByTestId('clients-table')).not.toContainText(name);
  await page.goto('/admin/trash');
  await page.getByTestId('trash-item').filter({ hasText: name }).getByTestId('trash-purge').click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /حذف نهائي/ })
    .click();
  await expect(page.getByTestId('trash-item').filter({ hasText: name })).toHaveCount(0);
});

test('a specialist has no Trash and no data management', async ({ page }) => {
  await login(page, 'khalid@ofoq.test');
  await page.goto('/admin/trash');
  await expect(page.getByText('لا تملك صلاحية الوصول')).toBeVisible();
  await page.goto('/admin/data');
  await expect(page.getByText('لا تملك صلاحية الوصول')).toBeVisible();
  await expect(page.getByTestId('reset-start')).toHaveCount(0);
});

test('data management: lock, unlock with the password, and the typed phrase', async ({ page }) => {
  await login(page, 'sara@ofoq.test');
  await page.goto('/admin/data');
  await expect(page.getByTestId('reset-counts')).toBeVisible();
  await expect(page.getByTestId('reset-count-clients')).toHaveText('5');

  // The run button stays disabled until the password and the exact phrase are entered.
  await page.getByTestId('reset-start').click();
  const dialog = page.getByTestId('reset-dialog');
  await dialog.getByTestId('reset-password').fill(PASSWORD);
  await dialog.getByTestId('reset-phrase').fill('delete all data');
  await expect(dialog.getByTestId('reset-run')).toBeDisabled();
  await dialog.getByTestId('reset-phrase').fill('DELETE ALL DATA');
  await expect(dialog.getByTestId('reset-run')).toBeEnabled();
  await page.keyboard.press('Escape');

  // Lock → the reset is disabled; unlocking needs the right password.
  await page.getByTestId('data-lock').click();
  await expect(page.getByTestId('data-lock')).toHaveAttribute('data-state', 'checked');
  await expect(page.getByTestId('reset-start')).toBeDisabled();
  await page.getByTestId('data-lock').click();
  await page.getByTestId('unlock-password').fill('wrong-password');
  await page.getByTestId('unlock-confirm').click();
  await expect(page.getByText('كلمة المرور غير صحيحة')).toBeVisible();
  await page.getByTestId('unlock-password').fill(PASSWORD);
  await page.getByTestId('unlock-confirm').click();
  await expect(page.getByTestId('data-lock')).toHaveAttribute('data-state', 'unchecked');
  await expect(page.getByTestId('reset-start')).toBeEnabled();
});

test('the backup downloads as a ZIP for the Super Admin only', async ({ page, request }) => {
  await login(page, 'sara@ofoq.test');
  await page.goto('/admin/data');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('data-backup').click()]);
  expect(download.suggestedFilename()).toMatch(/^backup-.*\.zip$/);
  // Signed out, the export never answers with a ZIP (the proxy sends the browser to login first).
  const anonymous = await request.get('/api/admin/data-export', { maxRedirects: 0 });
  expect(anonymous.headers()['content-type'] ?? '').not.toContain('zip');
});
