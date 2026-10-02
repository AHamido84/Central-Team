import { expect, test } from '@playwright/test';
import postgres from 'postgres';

import { login, waitForEmail } from './support';

const db = () => postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });

/**
 * FR2.1 — Settings → Mail: an admin sets up a custom SMTP sender (Mailpit locally), the connection test explains a
 * blocked port and passes on the right one, the secret never comes back, a test email arrives with the branded template
 * and shows in the email log. Non-admins can't open the screen.
 */
test('configure a sender, test it, send a test email, see it in the log', async ({ page }) => {
  const sql = db();
  await sql`delete from public.mail_settings where organization_id = (select organization_id from public.organization_members m
    join auth.users u on u.id = m.user_id and u.email = 'sara@ofoq.test' limit 1)`;
  const bodies: string[] = [];
  page.on('response', async (res) => {
    if (res.request().method() === 'POST') bodies.push(await res.text().catch(() => ''));
  });
  try {
    await login(page, 'sara@ofoq.test');
    await page.goto('/admin/mail');
    await expect(page.getByTestId('mail-dev-notice')).toBeVisible();
    await page.getByTestId('mail-preset-gmail').click();
    await expect(page.getByTestId('mail-gmail-steps')).toBeVisible();
    await expect(page.getByTestId('mail-host')).toHaveValue('smtp.gmail.com');
    // Gmail sends only as the signed-in account.
    await page.getByTestId('mail-username').fill('agency@gmail.com');
    await page.getByTestId('mail-from').fill('no-reply@ofoq.sa');
    await expect(page.getByTestId('mail-from-mismatch')).toBeVisible();

    await page.getByTestId('mail-preset-smtp').click();
    await page.getByTestId('mail-host').fill('127.0.0.1');
    await page.getByTestId('mail-port').fill('1');
    await page.getByTestId('mail-security').selectOption('none');
    await page.getByTestId('mail-username').fill('');
    await page.getByTestId('mail-secret').fill('super-secret-value-123');
    await page.getByTestId('mail-from').fill('mailer@ofoq.test');
    await page.getByTestId('mail-test').click();
    await expect(page.getByTestId('mail-test-result')).toContainText(/المنفذ|port/i);

    await page.getByTestId('mail-port').fill('54325');
    await page.getByTestId('mail-test').click();
    await expect(page.getByTestId('mail-test-result')).toContainText(/تم الاتصال|Connected/);
    await page.getByTestId('mail-save').click();
    await expect(page.getByText(/حُفظت إعدادات البريد|Mail settings saved/)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('mail-secret')).toHaveValue('');
    await expect(page.locator('body')).not.toContainText('super-secret-value-123');
    expect(bodies.some((b) => b.includes('super-secret-value-123'))).toBe(false);

    const since = new Date();
    await page.getByTestId('mail-test-to').fill('mail-test@ofoq.test');
    await page.getByTestId('mail-test-send').click();
    await expect(page.getByText(/Mailpit/).first()).toBeVisible();
    const mail = await waitForEmail('mail-test@ofoq.test', /رسالة تجريبية|Test email/, since);
    expect(mail.html).toContain('/admin/mail');

    await page.getByTestId('mail-tab-log').click();
    const row = page.getByTestId('email-log-row').filter({ hasText: 'mail-test@ofoq.test' }).first();
    await expect(row.getByTestId('email-log-status-badge')).toContainText(/أُرسلت|Sent/);
    await page.getByTestId('email-log-status').selectOption('failed');
    await expect(page).toHaveURL(/status=failed/);
  } finally {
    await sql`delete from public.mail_settings where from_email = 'mailer@ofoq.test'`;
    await sql.end();
  }
});

test('non-admins cannot open Settings → Mail', async ({ page }) => {
  await login(page, 'khalid@ofoq.test');
  await page.goto('/admin/mail');
  await expect(page.getByText(/لا تملك صلاحية الوصول|don't have access/)).toBeVisible();
  await expect(page.getByTestId('mail-settings')).toHaveCount(0);
});
