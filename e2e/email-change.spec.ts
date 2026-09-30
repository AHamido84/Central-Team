import { expect, test } from '@playwright/test';
import postgres from 'postgres';

import { linkFrom, login, unique, waitForEmail } from './support';

/**
 * FR1.7 / ADR-087 — email change. Self-service needs both links (old and new address); the first one lands on
 * "one more confirmation", the second completes it and the user signs in with the new address. Errors are specific.
 * An admin can set a member's email directly; the old address gets a security notice.
 */
const db = () => postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });

async function restore(from: string, to: string) {
  const sql = db();
  try {
    // Repeated local runs would otherwise hit the per-user email-change limit (5 per 10 minutes).
    await sql`delete from public.rate_limits where key like 'email_change:%' or key like 'admin_email_change:%'`;
    await sql`update auth.users set email = ${to}, email_change = '', email_change_token_new = '', email_change_token_current = '',
      email_change_confirm_status = 0 where email = ${from} or email = ${to}`;
  } finally {
    await sql.end();
  }
}

test('self-service change: pending state, both confirmations, sign in with the new address', async ({ page }) => {
  const original = 'turki@ofoq.test';
  const next = `${unique('turki')}@ofoq.test`;
  const since = new Date();
  await restore(original, original);
  try {
    await login(page, original);
    await page.goto('/settings/profile');

    // Errors are specific (not a generic "conflict").
    await page.getByTestId('email-change-input').fill(original);
    await page.getByTestId('email-change-submit').click();
    await expect(page.getByText(/هذا هو بريدك الحالي|already your email/).first()).toBeVisible();
    await page.getByTestId('email-change-input').fill('sara@ofoq.test');
    await page.getByTestId('email-change-submit').click();
    await expect(page.getByText(/مستخدم في حساب آخر|already uses this email/).first()).toBeVisible();

    await page.getByTestId('email-change-input').fill(next);
    await page.getByTestId('email-change-submit').click();
    const pending = page.getByTestId('email-change-pending');
    await expect(pending).toBeVisible();
    await expect(pending.getByTestId('email-change-pending-address')).toHaveText(next);
    await expect(page.getByTestId('email-change-dev-hint')).toBeVisible();
    // Survives a reload (read from auth.users).
    await page.reload();
    await expect(page.getByTestId('email-change-pending')).toBeVisible();

    const toOld = await waitForEmail(original, /Confirm your new email/, since);
    const toNew = await waitForEmail(next, /Confirm your new email/, since);
    await page.goto(linkFrom(toOld.html, /\/auth\/confirm/));
    await expect(page.getByTestId('email-change-landing')).toHaveAttribute('data-status', 'pending');
    await page.goto(linkFrom(toNew.html, /\/auth\/confirm/));
    await expect(page.getByTestId('email-change-landing')).toHaveAttribute('data-status', 'done');
    // A used link doesn't work twice.
    await page.goto(linkFrom(toNew.html, /\/auth\/confirm/));
    await expect(page.getByTestId('email-change-landing')).toHaveAttribute('data-status', 'invalid');

    // The old address is told, and the new one works for signing in.
    await waitForEmail(original, /تم تغيير بريد تسجيل الدخول|sign-in email was changed/, since);
    await page.goto('/auth/signout');
    await login(page, next);
    await page.goto('/settings/profile');
    await expect(page.getByText(next).first()).toBeVisible();
    await expect(page.getByTestId('email-change-pending')).toHaveCount(0);
  } finally {
    await restore(next, original);
  }
});

test('cancel and resend a pending change', async ({ page }) => {
  const original = 'omar@ofoq.test';
  const next = `${unique('omar')}@ofoq.test`;
  await restore(original, original);
  try {
    await login(page, original);
    await page.goto('/settings/profile');
    await page.getByTestId('email-change-input').fill(next);
    await page.getByTestId('email-change-submit').click();
    await expect(page.getByTestId('email-change-pending')).toBeVisible();
    const first = await waitForEmail(next, /Confirm your new email/);

    // GoTrue refuses a new email within `max_frequency` (1s locally) of the last one.
    await page.waitForTimeout(1_500);
    const since = new Date();
    await page.getByTestId('email-change-resend').click();
    await expect(page.getByText(/أعدنا إرسال|sent the links again/)).toBeVisible();
    await waitForEmail(next, /Confirm your new email/, since);

    await page.getByTestId('email-change-cancel').click();
    await expect(page.getByTestId('email-change-pending')).toHaveCount(0);
    await page.goto(linkFrom(first.html, /\/auth\/confirm/));
    await expect(page.getByTestId('email-change-landing')).toHaveAttribute('data-status', 'invalid');
  } finally {
    await restore(next, original);
  }
});

test('an admin changes a member email directly; the old address gets a notice', async ({ page }) => {
  const original = 'hind@ofoq.test';
  const next = `${unique('hind')}@ofoq.test`;
  const since = new Date();
  try {
    await login(page, 'sara@ofoq.test');
    await page.goto('/admin/users');
    await page.getByText(original).first().click();
    const sheet = page.getByTestId('member-sheet');
    await sheet.getByTestId('member-email-input').fill(next);
    await sheet.getByTestId('member-email-change').click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /تغيير البريد|Change email/ })
      .click();
    await expect(page.getByText(/تم تغيير البريد|Email changed/).first()).toBeVisible();

    await waitForEmail(original, /تم تغيير بريد تسجيل الدخول|sign-in email was changed/, since);
    await page.goto('/auth/signout');
    await login(page, next);
    await expect(page).not.toHaveURL(/\/login/);
  } finally {
    await restore(next, original);
  }
});
