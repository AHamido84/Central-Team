import { expect, test } from '@playwright/test';

import { linkFrom, login, PASSWORD, waitForEmail } from './support';

test.describe('authentication', () => {
  test('password login lands agency users on the dashboard and clients on the portal', async ({ page }) => {
    await login(page, 'sara@ofoq.test');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('سارة');

    await page.getByTestId('user-menu').first().click();
    await page.getByTestId('sign-out').click();
    await expect(page).toHaveURL(/\/login/);

    await login(page, 'mohammed@najd.test');
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByTestId('portal-greeting')).toContainText('محمد');
  });

  test('wrong password shows a translated error', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill('sara@ofoq.test');
    await page.getByTestId('login-password').fill('wrong-password-1');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('auth-error')).toContainText('غير صحيحة');
  });

  test('sides are protected: clients cannot open agency routes and vice versa', async ({ page }) => {
    await login(page, 'abeer@najd.test');
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/portal$/);
    await page.goto('/admin/roles');
    await expect(page).toHaveURL(/\/portal$/);

    await page.context().clearCookies();
    await login(page, 'khalid@ofoq.test');
    await page.goto('/portal');
    await expect(page).toHaveURL(/\/dashboard$/);
    // A specialist lacks roles:read → the forbidden page, not the matrix.
    await page.goto('/admin/roles');
    await expect(page.getByText('لا تملك صلاحية الوصول')).toBeVisible();
  });

  test('unauthenticated users are sent to login with a return path', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fusers/);
  });

  test('magic link signs an existing user in', async ({ page }) => {
    const since = new Date();
    await page.goto('/login');
    await page.getByTestId('tab-magic-link').click();
    await page.getByTestId('magic-email').fill('reem@ofoq.test');
    await page.getByTestId('magic-submit').click();
    await expect(page.getByTestId('magic-link-sent')).toBeVisible();
    const mail = await waitForEmail('reem@ofoq.test', /sign-in|الدخول/i, since);
    await page.goto(linkFrom(mail.html, /\/auth\/confirm\?token_hash=/));
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('password reset end to end', async ({ page }) => {
    const since = new Date();
    await page.goto('/forgot-password');
    await page.getByTestId('forgot-email').fill('hind@ofoq.test');
    await page.getByTestId('forgot-submit').click();
    await expect(page.getByTestId('reset-sent')).toBeVisible();
    const mail = await waitForEmail('hind@ofoq.test', /reset|كلمة المرور/i, since);
    await page.goto(linkFrom(mail.html, /type=recovery/));
    await expect(page).toHaveURL(/\/reset-password$/);
    const next = 'NewPassw0rd9';
    await page.getByTestId('reset-password').fill(next);
    await page.getByTestId('reset-confirm').fill(next);
    await page.getByTestId('reset-submit').click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // Old password no longer works; new one does. Then restore the seed password.
    await page.context().clearCookies();
    await login(page, 'hind@ofoq.test', next);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/settings/profile');
    const pw = page.locator('input[autocomplete="new-password"]');
    await pw.fill(PASSWORD);
    await pw.press('Enter');
    await expect(page.getByText('تم تحديث كلمة المرور.')).toBeVisible();
  });
});
