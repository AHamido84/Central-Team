import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

import { login, unique } from './support';

/** Feedback Round 5 (ADR-094): leads go to the Trash — from the list, in bulk, from the lead page — and come back. */

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function createLeads(names: string[]): Promise<string[]> {
  const db = postgres(DB_URL, { max: 1 });
  try {
    const [org] = await db<{ id: string }[]>`select organization_id as id from public.lead_forms where token = 'ofoq-website-contact'`;
    const ids: string[] = [];
    for (const name of names) {
      const [row] = await db<{ id: string }[]>`
        insert into public.leads (organization_id, full_name, email, source)
        values (${org!.id}, ${name}, ${`${unique('lead')}@e2e.test`}, 'manual') returning id`;
      ids.push(row!.id);
    }
    return ids;
  } finally {
    await db.end();
  }
}

/** Types into the table search until it filters (a fill before hydration is lost in dev), so the page is interactive. */
async function search(page: Page, text: string, rows: number) {
  await expect(async () => {
    await page.getByTestId('leads-table-search').fill(text);
    await expect(page.getByTestId('leads-table').locator('tbody tr')).toHaveCount(rows, { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  const db = postgres(DB_URL, { max: 1 });
  try {
    await db`delete from public.trash_items where entity_type = 'lead' and title like 'E2E Lead %'`;
    await db`delete from public.leads where full_name like 'E2E Lead %'`;
  } finally {
    await db.end();
  }
});

test('Sales Manager deletes a lead from the list → Trash → restore', async ({ page }) => {
  const name = `E2E Lead ${unique('row')}`;
  await createLeads([name]);
  await login(page, 'majed@ofoq.test');
  await page.goto('/crm/leads');
  await search(page, name, 1);
  const row = page.getByTestId('leads-table').locator('tr').filter({ hasText: name });
  await row.getByTestId('lead-row-actions').click();
  await page.getByTestId('action-delete').click();
  await expect(page.getByTestId('delete-dialog')).toBeVisible();
  await page.getByTestId('delete-confirm').click();
  await expect(page.getByTestId('delete-dialog')).toBeHidden();
  await expect(page.getByTestId('leads-table').locator('tr').filter({ hasText: name })).toHaveCount(0);

  await page.goto('/admin/trash');
  const item = page.getByTestId('trash-item').filter({ hasText: name });
  await expect(item).toBeVisible();
  // A Sales Manager may delete leads but not purge them.
  await expect(item.getByTestId('trash-purge')).toHaveCount(0);
  await item.getByTestId('trash-restore').click();
  await expect(page.getByTestId('trash-item').filter({ hasText: name })).toHaveCount(0);

  await page.goto('/crm/leads');
  await search(page, name, 1);
});

test('bulk delete of selected leads', async ({ page }) => {
  const tag = unique('bulk');
  const names = [`E2E Lead ${tag} A`, `E2E Lead ${tag} B`];
  const ids = await createLeads(names);
  await login(page, 'majed@ofoq.test');
  await page.goto('/crm/leads');
  await search(page, tag, 2);
  for (const id of ids) await page.getByRole('checkbox', { name: id }).check();
  await page.getByTestId('bulk-delete').click();
  await page.getByTestId('bulk-delete-count').fill('2');
  await page.getByTestId('bulk-delete-confirm').click();
  await expect(page.getByTestId('leads-table').locator('tr').filter({ hasText: tag })).toHaveCount(0);
});

test('Admin deletes from the lead page and undoes it from the toast', async ({ page }) => {
  const name = `E2E Lead ${unique('page')}`;
  const [id] = await createLeads([name]);
  await login(page, 'faisal@ofoq.test');
  await page.goto(`/crm/leads/${id}`);
  await page.getByTestId('lead-delete').click();
  await page.getByTestId('delete-confirm').click();
  // Undo straight from the toast (it lives in the root layout, so it survives the redirect to the list).
  await page.getByRole('button', { name: /تراجع|Undo/ }).click();
  await expect(page.getByText(/تمت الاستعادة|Restored/).first()).toBeVisible();
  await page.goto(`/crm/leads/${id}`);
  await expect(page.getByTestId('lead-detail')).toBeVisible();
});

test('a Sales Rep sees no delete', async ({ page }) => {
  const name = `E2E Lead ${unique('rep')}`;
  const [id] = await createLeads([name]);
  await login(page, 'ruba@ofoq.test');
  await page.goto('/crm/leads');
  await expect(page.getByTestId('leads-table')).toBeVisible();
  await expect(page.getByTestId('lead-row-actions')).toHaveCount(0);
  await page.goto(`/crm/leads/${id}`);
  await expect(page.getByTestId('lead-detail')).toBeVisible();
  await expect(page.getByTestId('lead-delete')).toHaveCount(0);
});
