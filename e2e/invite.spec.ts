import { expect, test } from '@playwright/test';

import { completeOnboarding, linkFrom, login, unique, waitForEmail } from './support';

test('team invite → accept → onboarding → dashboard with assigned role', async ({ page, browser }) => {
  const email = `${unique('new')}@ofoq.test`;
  const since = new Date();

  await login(page, 'faisal@ofoq.test');
  await page.goto('/admin/users');
  await page.getByTestId('invite-team-open').click();
  await page.getByTestId('invite-email').fill(email);
  await page.locator('[data-testid^="invite-role-"]').nth(4).click(); // Specialist
  await page.getByTestId('invite-submit').click();
  await expect(page.getByText('أُرسلت الدعوة.')).toBeVisible();

  const mail = await waitForEmail(email, /فريق|team/i, since);
  const link = linkFrom(mail.html, /\/invite\//);

  const guest = await browser.newContext();
  const invitee = await guest.newPage();
  await invitee.goto(link);
  await expect(invitee.getByTestId('invite-valid')).toBeVisible();
  await invitee.getByTestId('accept-name').fill('Yousef Test');
  await invitee.getByTestId('accept-password').fill('Welcome123');
  await invitee.getByTestId('accept-confirm').fill('Welcome123');
  await invitee.getByTestId('accept-submit').click();
  await completeOnboarding(invitee, 'يوسف الاختبار');
  await expect(invitee).toHaveURL(/\/dashboard$/);
  await expect(invitee.getByText('أخصائي').first()).toBeVisible();

  // The link is single-use.
  await invitee.goto(link);
  await expect(invitee.getByTestId('invite-invalid')).toBeVisible();

  // The inviter is notified in-app.
  await page.reload();
  await expect(page.getByTestId('notification-count')).toBeVisible();
  await guest.close();
});

test('expired invitations explain what to do', async ({ page }) => {
  // Seeded expired invitation token (see scripts/seed.ts).
  await page.goto('/invite/seed-expired-team-invitation-token-00000000002');
  await expect(page.getByTestId('invite-invalid')).toContainText('انتهت صلاحية الدعوة');
});
