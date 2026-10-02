import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

import { linkFrom, login, PASSWORD, unique, waitForEmail } from './support';

/** Feedback Round 4: portal email change (FR4.1) and one portal user in several clients (FR4.2 / FR4.3). */

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LUJAIN = 'lujain@lujain.test';

async function sql<T extends postgres.Row>(fn: (db: postgres.Sql) => Promise<T[]>): Promise<T[]> {
  const db = postgres(DB_URL, { max: 1 });
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

async function clientId(slug: string) {
  const [row] = await sql((db) => db<{ id: string }[]>`select id from public.clients where slug = ${slug}`);
  return row!.id;
}

async function openUsersTab(page: Page, slug: string) {
  await page.goto(`/clients/${await clientId(slug)}?tab=users`);
  await expect(page.getByTestId('client-users')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  // Leave the seed as it was for the rest of the suite (and for a re-run): Lujain only in Lujain Fashion, no last-used
  // client, the original address.
  await sql(
    (db) => db`
    delete from public.client_users
    where user_id = (select id from public.profiles where email = ${LUJAIN})
      and client_id = (select id from public.clients where slug = 'gulf-vision')`,
  );
  await sql((db) => db`delete from public.portal_client_visits where user_id = (select id from public.profiles where email = ${LUJAIN})`);
});

test('pending invitation: change its email → old link stops, new address gets the invite', async ({ page, browser }) => {
  const oldEmail = `${unique('inv-old')}@example.test`;
  const newEmail = `${unique('inv-new')}@example.test`;
  await login(page, 'faisal@ofoq.test');
  await openUsersTab(page, 'najd-heritage');

  await page.getByTestId('invite-client-user').click();
  await page.getByTestId('client-invite-email').fill(oldEmail);
  await page.getByTestId('client-invite-submit').click();
  const first = await waitForEmail(oldEmail, /.+/);
  const oldLink = linkFrom(first.html, /\/invite\//);

  const row = page.getByTestId('client-invitation-row').filter({ hasText: oldEmail });
  await row.getByTestId('invitation-change-email').click();
  await page.getByTestId('change-email-input').fill(newEmail);
  await page.getByTestId('change-email-submit').click();
  await expect(page.getByTestId('client-invitation-row').filter({ hasText: newEmail })).toBeVisible();
  await expect(page.getByTestId('client-invitation-row').filter({ hasText: oldEmail })).toHaveCount(0);

  const second = await waitForEmail(newEmail, /.+/);
  const newLink = linkFrom(second.html, /\/invite\//);
  const guest = await browser.newContext();
  const g = await guest.newPage();
  await g.goto(oldLink);
  await expect(g.getByTestId('invite-invalid')).toBeVisible();
  await g.goto(newLink);
  await expect(g.getByTestId('invite-valid')).toBeVisible();
  await guest.close();
});

test('change email: an agency team member address is refused with a clear reason', async ({ page }) => {
  await login(page, 'faisal@ofoq.test');
  await openUsersTab(page, 'lujain-fashion');
  const row = page.getByTestId('client-user-row').filter({ hasText: LUJAIN });
  await row.getByTestId('client-user-menu').click();
  await page.getByTestId('client-user-change-email').click();
  await page.getByTestId('change-email-input').fill('noura@ofoq.test');
  await page.getByTestId('change-email-submit').click();
  await expect(page.getByTestId('change-email-error')).toBeVisible();
});

test('direct email change → sign in with the new address; the old address is told who changed it', async ({ page, browser }) => {
  const next = 'lujain.new@lujain.test';
  const since = new Date();
  await login(page, 'faisal@ofoq.test');
  await openUsersTab(page, 'lujain-fashion');
  const row = page.getByTestId('client-user-row').filter({ hasText: LUJAIN });
  await row.getByTestId('client-user-menu').click();
  await page.getByTestId('client-user-change-email').click();
  await page.getByTestId('change-email-mode-direct').check();
  await page.getByTestId('change-email-input').fill(next);
  await page.getByTestId('change-email-submit').click();
  await expect(page.getByTestId('client-user-row').filter({ hasText: next })).toBeVisible();

  const notice = await waitForEmail(LUJAIN, /.+/, since);
  expect(notice.text).toContain('فيصل');

  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p, next, PASSWORD);
  await expect(p).toHaveURL(/\/portal/);
  await ctx.close();

  // Change it back (also covers a second change of the same person).
  const back = page.getByTestId('client-user-row').filter({ hasText: next });
  await back.getByTestId('client-user-menu').click();
  await page.getByTestId('client-user-change-email').click();
  await page.getByTestId('change-email-input').fill(LUJAIN);
  await page.getByTestId('change-email-submit').click();
  await expect(page.getByTestId('client-user-row').filter({ hasText: LUJAIN })).toBeVisible();
});

test('add an existing portal user to a second client → choose, switch, separate data; the notification switches client', async ({
  page,
  browser,
}) => {
  await login(page, 'faisal@ofoq.test');
  await openUsersTab(page, 'gulf-vision');
  await page.getByTestId('invite-client-user').click();
  await page.getByTestId('client-invite-email').fill('lujain');
  await page.getByTestId('portal-user-suggestion').filter({ hasText: LUJAIN }).click();
  await expect(page.getByTestId('invite-existing')).toBeVisible();
  await page.getByTestId('client-role-client_member').check();
  await page.getByTestId('client-invite-submit').click();
  await expect(page.getByTestId('client-user-row').filter({ hasText: LUJAIN })).toBeVisible();

  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p, LUJAIN);
  await p.waitForURL('**/portal/choose');
  await expect(p.getByTestId('account-option')).toHaveCount(2);

  // Lujain Fashion first: only LUJAIN- requests.
  await p.getByTestId('account-option').filter({ hasText: 'لُجين' }).click();
  await p.waitForURL((u) => u.pathname === '/portal');
  await p.goto('/portal/requests');
  await expect(p.getByText(/LUJAIN-\d+/).first()).toBeVisible();
  await expect(p.getByText(/GULF-\d+/)).toHaveCount(0);

  // The "you now have access" notification opens Gulf Vision.
  await p.getByTestId('notification-bell').click();
  const item = p
    .getByTestId('notification-item')
    .filter({ has: p.getByTestId('notification-client') })
    .first();
  await expect(item).toBeVisible();
  await item.click();
  await p.waitForURL((u) => u.pathname === '/portal');
  await expect(p.getByTestId('client-switcher')).toContainText(/رؤية|Gulf/);
  await p.goto('/portal/requests');
  await expect(p.getByText(/GULF-\d+/).first()).toBeVisible();
  await expect(p.getByText(/LUJAIN-\d+/)).toHaveCount(0);

  // Removal from Gulf Vision is immediate: the next request already lands back in Lujain Fashion only.
  await sql(
    (db) => db`
    update public.client_users set status = 'deactivated'
    where user_id = (select id from public.profiles where email = ${LUJAIN})
      and client_id = (select id from public.clients where slug = 'gulf-vision')`,
  );
  await p.goto('/portal/requests');
  await expect(p.getByText(/LUJAIN-\d+/).first()).toBeVisible();
  await expect(p.getByText(/GULF-\d+/)).toHaveCount(0);
  await ctx.close();
});

test('ask the user to confirm: nothing changes until the link is opened; then the new address signs in', async ({ page, browser }) => {
  const next = 'lujain.confirm@lujain.test';
  await login(page, 'faisal@ofoq.test');
  await openUsersTab(page, 'lujain-fashion');
  await page.getByTestId('client-user-row').filter({ hasText: LUJAIN }).getByTestId('client-user-menu').click();
  await page.getByTestId('client-user-change-email').click();
  await page.getByTestId('change-email-mode-confirm').check();
  await page.getByTestId('change-email-input').fill(next);
  await page.getByTestId('change-email-submit').click();
  // Still the old address, with a pending indicator.
  const row = page.getByTestId('client-user-row').filter({ hasText: LUJAIN });
  await expect(row.getByTestId('pending-email')).toContainText(next);

  const mail = await waitForEmail(next, /.+/);
  const link = linkFrom(mail.html, /\/email-change\/confirm\?token=/);
  const ctx = await browser.newContext();
  const g = await ctx.newPage();
  await g.goto(link);
  await expect(g.getByTestId('portal-email-confirm')).toHaveAttribute('data-status', 'idle');
  await g.getByTestId('portal-email-confirm-submit').click();
  await expect(g.getByTestId('portal-email-confirm')).toHaveAttribute('data-status', 'done');
  // Single use.
  await g.goto(link);
  await g.getByTestId('portal-email-confirm-submit').click();
  await expect(g.getByTestId('portal-email-confirm')).toHaveAttribute('data-status', 'invalid');
  await login(g, next);
  await expect(g).toHaveURL(/\/portal/);
  await ctx.close();

  // Back to the original address (direct).
  await page.reload();
  await page.getByTestId('client-user-row').filter({ hasText: next }).getByTestId('client-user-menu').click();
  await page.getByTestId('client-user-change-email').click();
  await page.getByTestId('change-email-input').fill(LUJAIN);
  await page.getByTestId('change-email-submit').click();
  await expect(page.getByTestId('client-user-row').filter({ hasText: LUJAIN })).toBeVisible();
});

test('Admin → Users → Portal users: the drawer lists every client membership of a multi-client user', async ({ page }) => {
  await login(page, 'faisal@ofoq.test');
  await page.goto('/admin/users?tab=portal');
  await page.getByTestId('portal-users-table').getByText('hala@group.test').first().click();
  const drawer = page.getByTestId('portal-user-drawer');
  await expect(drawer.getByTestId('portal-user-membership')).toHaveCount(3);
  await expect(drawer.getByTestId('membership-add')).toBeVisible();
  await expect(drawer.getByTestId('account-deactivate')).toBeVisible();
  await page.screenshot({ path: 'test-results/fr4-portal-user-drawer.png' });
});

test("a Client Owner's drawer shows only their own client's membership", async ({ page }) => {
  await login(page, 'yasser@darb.test');
  await page.goto('/portal/company?tab=team');
  await page.getByTestId('client-user-row').filter({ hasText: 'hala@group.test' }).getByTestId('client-user-open').click();
  const drawer = page.getByTestId('portal-user-drawer');
  await expect(drawer.getByTestId('portal-user-membership')).toHaveCount(1);
  await expect(drawer.getByTestId('portal-user-membership')).toHaveAttribute('data-client-id', await clientId('darb-coffee'));
  await expect(drawer.getByTestId('membership-add')).toHaveCount(0);
  await expect(drawer.getByTestId('account-deactivate')).toHaveCount(0);
});
