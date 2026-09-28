import { expect, test } from '@playwright/test';

import { expectDir, login } from './support';

test('language switch flips direction and persists across sessions', async ({ page }) => {
  await login(page, 'lama@ofoq.test');
  await expectDir(page, 'rtl', 'ar');
  await expect(page.getByRole('link', { name: 'لوحة التحكم' }).first()).toBeVisible();

  await page.getByTestId('language-switcher').click();
  await page.getByTestId('locale-en').click();
  await expectDir(page, 'ltr', 'en');
  await expect(page.getByRole('link', { name: 'Dashboard' }).first()).toBeVisible();

  // Persisted to the profile: a fresh session comes back in English.
  await page.context().clearCookies();
  await login(page, 'lama@ofoq.test');
  await expectDir(page, 'ltr', 'en');

  // Restore Arabic for other tests.
  await page.getByTestId('language-switcher').click();
  await page.getByTestId('locale-ar').click();
  await expectDir(page, 'rtl', 'ar');
});

test('the login page can be switched before signing in', async ({ page }) => {
  await page.goto('/login');
  await expectDir(page, 'rtl', 'ar');
  await page.getByTestId('language-switcher').click();
  await page.getByTestId('locale-en').click();
  await expectDir(page, 'ltr', 'en');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
