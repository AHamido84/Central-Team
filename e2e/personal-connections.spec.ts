import { expect, test } from '@playwright/test';

import { login, unique } from './support';

/**
 * FR1.6 — a specialist connects their own Meta account (sandbox) with a pasted token: it shows masked, "Test
 * connection" lists the ad accounts, "Fetch campaigns" lists campaigns, and an account maps to a client. An admin then
 * sees it (masked) on /admin/integrations and reassigns it; the specialist disconnects nothing they no longer own.
 */
test('connect, test, fetch campaigns, map; admin sees and reassigns', async ({ browser }) => {
  const name = unique('Meta شخصي');
  const token = `EAAB${unique('tok').replace(/\W/g, '')}wxyz`;

  const khalid = await browser.newPage();
  await login(khalid, 'khalid@ofoq.test');
  await khalid.goto('/settings/connections');
  await khalid.getByTestId('personal-connect').click();
  const form = khalid.getByTestId('personal-connect-form');
  await form.getByTestId('personal-provider').selectOption('meta');
  await form.getByTestId('personal-mode').selectOption('sandbox');
  await form.getByTestId('personal-name').fill(name);
  await form.getByTestId('personal-token').fill(token);
  await form.getByTestId('personal-save').click();

  const row = khalid.getByTestId('personal-connection').filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByTestId('personal-token-hint')).toHaveText(`${token.slice(0, 4)}…${token.slice(-4)}`);
  await expect(khalid.locator('body')).not.toContainText(token);

  await row.getByTestId('personal-test').click();
  const account = row.getByTestId('personal-account').first();
  await expect(account).toBeVisible({ timeout: 20_000 });
  await account.getByTestId('personal-fetch-campaigns').click();
  await expect(account.getByTestId('personal-campaigns')).toBeVisible({ timeout: 20_000 });

  const select = account.getByTestId('personal-account-client');
  // Re-runs reuse the same sandbox identity (and its mapping): pick a client other than the current one.
  const current = await select.inputValue();
  const values = await select.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  const value = values.find((v) => v && v !== current);
  await select.selectOption(value!);
  await expect(khalid.getByText(/تم حفظ الربط|Mapping saved/)).toBeVisible();
  await khalid.reload();
  await expect(
    khalid
      .getByTestId('personal-connection')
      .filter({ hasText: name })
      .getByTestId('personal-account')
      .first()
      .getByTestId('personal-account-client'),
  ).toHaveValue(value!);

  const sara = await browser.newPage();
  await login(sara, 'sara@ofoq.test');
  await sara.goto('/admin/integrations');
  const adminRow = sara.getByTestId('people-connection').filter({ hasText: name });
  await expect(adminRow).toBeVisible();
  await expect(sara.locator('body')).not.toContainText(token);
  await adminRow.getByTestId('people-connection-reassign').click();
  const owner = sara.getByTestId('people-connection-owner-select');
  await owner.selectOption({ index: 1 });
  await sara.getByTestId('people-connection-reassign-save').click();
  await expect(sara.locator('[data-sonner-toast]')).toContainText(/تم نقل الاتصال|Connection reassigned/);
  await expect(adminRow.getByTestId('people-connection-owner')).not.toHaveText(/خالد|Khalid/);

  // No longer the owner: it disappears from Khalid's list.
  await khalid.reload();
  await expect(khalid.getByTestId('personal-connection').filter({ hasText: name })).toHaveCount(0);
});
