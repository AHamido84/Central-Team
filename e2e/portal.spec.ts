import path from 'node:path';

import { expect, test } from '@playwright/test';

import { completeOnboarding, linkFrom, login, unique, waitForEmail } from './support';

/**
 * Phase 1 acceptance: invite client → accept → upload file → agency replies in messages → client notified.
 */
test('client portal round trip', async ({ browser }) => {
  const email = `${unique('client')}@najd.test`;
  const question = `وصلكم الشعار الجديد؟ ${unique('m')}`;
  const since = new Date();

  // 1. The account manager invites a client user from the client page.
  const agencyCtx = await browser.newContext();
  const agency = await agencyCtx.newPage();
  await login(agency, 'noura@ofoq.test');
  await agency.goto('/clients');
  await agency.getByTestId('clients-table').locator('table').getByText('مطاعم نجد الأصيلة').click();
  await agency.getByTestId('client-tab-users').click();
  await agency.getByTestId('invite-client-user').click();
  await agency.getByTestId('client-invite-email').fill(email);
  await agency.getByTestId('client-role-client_member').check();
  await agency.getByTestId('client-invite-submit').click();
  await expect(agency.getByTestId('client-invitation-row').filter({ hasText: email })).toBeVisible();

  // 2. The client accepts and onboards.
  const mail = await waitForEmail(email, /بوابة|portal/i, since);
  const clientCtx = await browser.newContext();
  const client = await clientCtx.newPage();
  await client.goto(linkFrom(mail.html, /\/invite\//));
  await client.getByTestId('accept-name').fill('Test Client');
  await client.getByTestId('accept-password').fill('Welcome123');
  await client.getByTestId('accept-confirm').fill('Welcome123');
  await client.getByTestId('accept-submit').click();
  await completeOnboarding(client, 'عميل تجريبي');
  await expect(client).toHaveURL(/\/portal$/);
  await expect(client.getByTestId('account-manager-card').filter({ visible: true })).toContainText('نورة العتيبي');
  await expect(client.getByTestId('slot-approvals')).toBeVisible();
  await expect(client.getByTestId('slot-requests')).toBeVisible();

  // 3. The client uploads a brand asset.
  await client.goto('/portal/files');
  await client.getByTestId('file-upload-input').setInputFiles(path.resolve(__dirname, 'fixtures/brand-logo.png'));
  await expect(client.getByTestId('upload-item').first()).toHaveAttribute('data-status', 'done');
  await expect(client.getByTestId('file-card').filter({ hasText: 'brand-logo.png' }).first()).toBeVisible();
  // Internal files are never listed in the portal.
  await expect(client.getByText('pricing-notes.pdf')).toHaveCount(0);

  // 4. The client writes in the general thread; the agency replies.
  await client.goto('/portal/messages');
  await client.getByTestId('thread-item').filter({ hasText: 'General' }).first().click();
  await client.getByTestId('composer-input').fill(question);
  await client.getByTestId('composer-send').click();
  await expect(client.getByTestId('message').filter({ hasText: question })).toBeVisible();

  await agency.goto('/messages');
  await agency.getByTestId('thread-item').filter({ hasText: 'مطاعم نجد الأصيلة' }).filter({ hasText: 'General' }).first().click();
  await expect(agency.getByTestId('message').filter({ hasText: question })).toBeVisible();
  const replySince = new Date();
  await agency.getByTestId('composer-input').fill('نعم وصلنا، شكرًا لك! سنستخدمه في تصاميم هذا الأسبوع.');
  await agency.getByTestId('composer-send').click();
  await expect(agency.getByTestId('message').filter({ hasText: 'سنستخدمه' })).toBeVisible();

  // 5. The client is notified: realtime message in the open thread, bell badge, and email.
  await expect(client.getByTestId('message').filter({ hasText: 'سنستخدمه' })).toBeVisible();
  await expect(client.getByTestId('notification-count')).toBeVisible();
  const notice = await waitForEmail(email, /رسالة|message/i, replySince);
  expect(notice.text).toContain('سنستخدمه');

  // Read receipt: the agency sees the client has read the reply.
  await agency.reload();
  await expect(agency.getByTestId('read-receipt')).toBeVisible();

  await agencyCtx.close();
  await clientCtx.close();
});

test('a Client Viewer can read but not write', async ({ page }) => {
  await login(page, 'saad@najd.test');
  await page.goto('/portal/messages');
  await page.getByTestId('thread-item').first().click();
  await expect(page.getByTestId('composer-input')).toHaveCount(0);
  await page.goto('/portal/files');
  await expect(page.getByTestId('file-upload')).toHaveCount(0);
  await expect(page.getByTestId('file-card').first()).toBeVisible();
});

test('mobile portal uses bottom navigation', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await login(page, 'yasser@darb.test');
  await expect(page.getByTestId('portal-bottom-nav')).toBeVisible();
  await page.getByTestId('portal-bottom-nav').getByRole('link', { name: 'الملفات' }).click();
  await expect(page).toHaveURL(/\/portal\/files$/);
  await ctx.close();
});
